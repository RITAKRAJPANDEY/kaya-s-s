"""Pipeline orchestrator for Kaya Voice + Vision Assistant.

Executes: Audio -> STT -> RAG Router -> Multimodal Vision / Knowledge Reasoning -> TTS
Measures latencies and manages short in-memory conversational history without knowledge pollution.
"""

import base64
import logging
import time
from typing import Any, Dict, List, Optional, Tuple, Union

from app.config import Settings, get_settings
from app.factory import get_stt_provider, get_vision_reasoner, get_tts_provider, get_knowledge_retriever
from app.interfaces import STTProvider, VisionReasoner, TTSProvider, KnowledgeRetriever
from app.rag.router import RAGRouter, RAGRoutingDecision

logger = logging.getLogger("kaya.pipeline")


def format_duration(seconds: float) -> str:
    """Format duration in ms or seconds with clean formatting."""
    if seconds < 1.0:
        return f"{int(seconds * 1000)} ms"
    return f"{seconds:.2f} s"


class KayaPipeline:
    """Orchestrates end-to-end voice, vision, and RAG processing loop."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        stt_provider: Optional[STTProvider] = None,
        vision_reasoner: Optional[VisionReasoner] = None,
        tts_provider: Optional[TTSProvider] = None,
        knowledge_retriever: Optional[KnowledgeRetriever] = None,
        rag_router: Optional[RAGRouter] = None,
    ):
        self.settings = settings or get_settings()
        self.stt_provider = stt_provider or get_stt_provider(self.settings)
        self.vision_reasoner = vision_reasoner or get_vision_reasoner(self.settings)
        self.tts_provider = tts_provider or get_tts_provider(self.settings)
        self.knowledge_retriever = knowledge_retriever or get_knowledge_retriever(self.settings)
        self.rag_router = rag_router or RAGRouter(mode=self.settings.rag_router_mode)

        # In-memory short dialogue history: [{'role': 'user'|'assistant', 'content': '...'}]
        self.conversation_history: List[Dict[str, str]] = []

    def reset_history(self) -> None:
        """Clear conversational context."""
        self.conversation_history.clear()
        logger.info("Conversation history reset.")

    def get_history(self) -> List[Dict[str, str]]:
        """Return copy of conversational history."""
        return list(self.conversation_history)

    def _append_history(self, user_question: str, assistant_response: str) -> None:
        """Append turn to history and trim to max allowed turns."""
        self.conversation_history.append({"role": "user", "content": user_question})
        self.conversation_history.append({"role": "assistant", "content": assistant_response})

        max_turns = self.settings.max_history_turns * 2
        if len(self.conversation_history) > max_turns:
            self.conversation_history = self.conversation_history[-max_turns:]

    async def process_turn(
        self,
        audio_bytes: Optional[bytes] = None,
        audio_mime: str = "audio/wav",
        images: Optional[List[Tuple[bytes, str]]] = None,
        image_bytes: Optional[bytes] = None,
        image_mime: str = "image/jpeg",
        direct_question: Optional[str] = None,
        frame_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Execute the voice + vision reasoning turn with optional RAG grounding.

        Args:
            audio_bytes: Recorded microphone audio bytes (optional if direct_question provided).
            audio_mime: MIME type of audio.
            images: List of (image_bytes, mime_type) in chronological order.
            image_bytes: Fallback single captured snapshot frame bytes.
            image_mime: MIME type of fallback single image.
            direct_question: Optional override text question.
            frame_mode: Optional override ('SINGLE_FRAME' or 'TEMPORAL_FRAMES').

        Returns:
            Dictionary containing question, response, audio_base64, timings, and provider metadata.
        """
        # Determine effective frame mode
        active_mode = (frame_mode or self.settings.frame_mode).upper()
        if active_mode not in ["SINGLE_FRAME", "TEMPORAL_FRAMES"]:
            active_mode = "TEMPORAL_FRAMES"

        # Normalize incoming frames
        raw_frames: List[Tuple[bytes, str]] = []
        if images and len(images) > 0:
            raw_frames = list(images)
        elif image_bytes and len(image_bytes) > 0:
            raw_frames = [(image_bytes, image_mime)]

        if not raw_frames:
            raise ValueError("No camera frame image(s) provided for multimodal reasoning.")

        # Filter frames based on mode
        if active_mode == "SINGLE_FRAME":
            selected_frames = raw_frames[-1:]  # Only newest frame
        else:
            max_f = self.settings.temporal_max_frames
            selected_frames = raw_frames[-max_f:]  # Up to temporal_max_frames in chronological order

        t_total_start = time.perf_counter()

        # Step 1: STT Transcription
        stt_duration = 0.0
        if direct_question and direct_question.strip():
            question = direct_question.strip()
        else:
            if not audio_bytes or len(audio_bytes) == 0:
                raise ValueError("No audio payload received and no direct question provided.")
            t_stt_start = time.perf_counter()
            question = await self.stt_provider.transcribe(audio_bytes, mime_type=audio_mime)
            stt_duration = time.perf_counter() - t_stt_start

        if not question or not question.strip():
            question = "What am I looking at?"

        # Step 2: RAG Routing Decision
        t_router_start = time.perf_counter()
        routing_decision: RAGRoutingDecision = self.rag_router.route(question)
        router_duration = time.perf_counter() - t_router_start

        # Step 3: Knowledge Retrieval (Docling structure-aware chunks or legacy File Search)
        retrieved_chunks = []
        active_store_name = None
        retrieval_duration = 0.0

        if routing_decision.requires_rag and self.knowledge_retriever:
            t_retrieval_start = time.perf_counter()
            retrieved_chunks = await self.knowledge_retriever.retrieve(
                question, top_k=self.settings.rag_top_k
            )
            active_store_name = self.knowledge_retriever.get_file_search_store_name()
            retrieval_duration = time.perf_counter() - t_retrieval_start

        # Step 4: Multimodal Vision + RAG Reasoning
        t_vision_start = time.perf_counter()
        raw_answer = await self.vision_reasoner.answer(
            question=question,
            images=selected_frames,
            conversation_history=self.conversation_history,
            mime_type=selected_frames[0][1] if selected_frames else "image/jpeg",
            retrieved_chunks=retrieved_chunks if retrieved_chunks else None,
            file_search_store_name=active_store_name,
        )
        vision_duration = time.perf_counter() - t_vision_start

        if isinstance(raw_answer, dict):
            response_text = raw_answer.get("text", "")
            sources = raw_answer.get("sources", [])
        else:
            response_text = str(raw_answer)
            sources = []

        # Step 5: TTS Synthesis
        t_tts_start = time.perf_counter()
        tts_audio_bytes = await self.tts_provider.synthesize(response_text)
        tts_duration = time.perf_counter() - t_tts_start

        t_total_duration = time.perf_counter() - t_total_start

        # Log detailed execution pipeline latency
        rag_log = f"YES - {routing_decision.reason}" if routing_decision.requires_rag else f"NO - {routing_decision.reason}"
        sources_summary = f", Sources: {len(sources)}" if sources else ""
        print("\n" + "=" * 56)
        print(f"[Pipeline Execution] Query: \"{question}\"")
        print(f"[Mode]       {active_mode} ({len(selected_frames)} frame{'s' if len(selected_frames) != 1 else ''})")
        print(f"[STT]        {format_duration(stt_duration):<10} (Provider: {self.stt_provider.name})")
        print(f"[RAG Router] {format_duration(router_duration):<10} (RAG: {rag_log})")
        if routing_decision.requires_rag:
            print(f"[Retrieval]  {format_duration(retrieval_duration):<10} (Chunks: {len(retrieved_chunks)})")
        print(f"[Reasoning]  {format_duration(vision_duration):<10} (Provider: {self.vision_reasoner.name} / {self.vision_reasoner.model_name}{sources_summary})")
        print(f"[TTS]        {format_duration(tts_duration):<10} (Provider: {self.tts_provider.name})")
        print(f"[Total]      {format_duration(t_total_duration):<10}")
        if sources:
            src_str = ", ".join(f"{s.get('title')}{' (p.' + str(s.get('page')) + ')' if s.get('page') else ''}" for s in sources)
            print(f"[Sources]    {src_str}")
        print("=" * 56 + "\n")

        audio_b64 = base64.b64encode(tts_audio_bytes).decode("utf-8") if tts_audio_bytes else ""
        f_count = len(selected_frames)

        # Update in-memory history (isolate RAG context chunks from permanently polluting history)
        self._append_history(question, response_text)

        return {
            "transcript": question,
            "response": response_text,
            "audio_base64": audio_b64,
            "frame_mode": active_mode,
            "frame_count": f_count,

            "rag": {
                "requires_rag": routing_decision.requires_rag,
                "reason": routing_decision.reason,
                "used": bool(sources),
                "sources": sources,
            },
            "timings": {
                "stt_ms": round(stt_duration * 1000, 1),
                "router_ms": round(router_duration * 1000, 1),
                "retrieval_ms": round(retrieval_duration * 1000, 1),
                "vision_ms": round(vision_duration * 1000, 1),
                "tts_ms": round(tts_duration * 1000, 1),
                "total_ms": round(t_total_duration * 1000, 1),
                "formatted": {
                    "stt": format_duration(stt_duration),
                    "router": format_duration(router_duration),
                    "retrieval": format_duration(retrieval_duration),
                    "vision": format_duration(vision_duration),
                    "tts": format_duration(tts_duration),
                    "total": format_duration(t_total_duration),
                }
            },

            "providers": {
                "stt": self.stt_provider.name,
                "vision": f"{self.vision_reasoner.name}:{self.vision_reasoner.model_name}",
                "tts": self.tts_provider.name,
                "rag": self.knowledge_retriever.name if self.knowledge_retriever else "none",
            }
        }
