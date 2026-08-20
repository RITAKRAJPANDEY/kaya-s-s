"""Google Gemini Multimodal Vision & RAG Reasoner Provider."""

import base64
import io
import logging
import os
from typing import Any, Dict, List, Optional, Tuple, Union
from PIL import Image
from google import genai
from google.genai import types

from app.interfaces import VisionReasoner, RetrievedChunk


logger = logging.getLogger("kaya.providers.vision.gemini")

KAYA_VISION_SYSTEM_PROMPT = (
    "You are Kaya, an on-site voice safety assistant for construction workers.\n"
    "CRITICAL CONCISENESS & VOICE RULES:\n"
    "- Your response will be spoken aloud via headset in noisy conditions.\n"
    "- Keep responses brief, precise, and under 2-3 short sentences (or 2-3 concise bullet points).\n"
    "- State answers immediately. NEVER use filler introductions (e.g. avoid 'Based on the visual input', 'I can see', 'Certainly').\n"
    "- Only claim things directly supported by visual evidence. If unclear, state so in one short sentence."
)

KAYA_SYSTEM_PROMPT = KAYA_VISION_SYSTEM_PROMPT


KAYA_RAG_SYSTEM_PROMPT = (
    "You are Kaya, an on-site voice safety assistant for construction workers.\n"
    "CRITICAL CONCISENESS & CLARITY RULES:\n"
    "- Your response will be spoken aloud to a worker over audio.\n"
    "- Keep responses clear, precise, and brief (maximum 2-3 short sentences or concise bullet points, under 50 words).\n"
    "- State the facts directly. NEVER use boilerplate filler (e.g. avoid 'Based on the safety documentation', 'According to the manual').\n"
    "- Directly state: 1) what the rule requires, and 2) whether the observed worker/setup complies, and 3) what immediate action is needed.\n"
    "- Never invent numbers or rules. If not covered in documentation, state that in one short sentence."
)



class GeminiVisionReasoner(VisionReasoner):
    """Multimodal vision and RAG reasoning using Google Gemini API."""

    def __init__(self, api_key: str, model: str = "gemini-3.1-flash-lite"):

        if not api_key:
            raise ValueError("Gemini API key is required for GeminiVisionReasoner.")
        self.api_key = api_key
        self.model = model
        self.client = genai.Client(api_key=self.api_key)

    @property
    def name(self) -> str:
        return "gemini"

    @property
    def model_name(self) -> str:
        return self.model

    def _prepare_image(self, image_bytes: bytes, max_dim: int = 768) -> Tuple[bytes, str]:
        """Compress and downscale image to reduce network upload latency and VLM token processing time."""
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                if img.mode != "RGB":
                    img = img.convert("RGB")

                if max(img.width, img.height) > max_dim:
                    img.thumbnail((max_dim, max_dim), Image.Resampling.BILINEAR)

                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=75, optimize=True)
                return buf.getvalue(), "image/jpeg"
        except Exception:
            return image_bytes, "image/jpeg"


    def _normalize_images(self, images: Any, default_mime: str = "image/jpeg") -> List[Tuple[bytes, str]]:
        """Normalize input images to a list of (bytes, mime_type) tuples."""
        if isinstance(images, bytes):
            return [(images, default_mime)]
        if isinstance(images, list):
            norm = []
            for item in images:
                if isinstance(item, tuple) and len(item) == 2:
                    norm.append((item[0], item[1]))
                elif isinstance(item, bytes):
                    norm.append((item, default_mime))
            return norm
        return []

    async def answer(
        self,
        question: str,
        images: Any,
        conversation_history: Optional[List[Dict[str, Any]]] = None,
        mime_type: str = "image/jpeg",
        retrieved_chunks: Optional[List[RetrievedChunk]] = None,
        file_search_store_name: Optional[str] = None,
        system_instruction_override: Optional[str] = None,
    ) -> Union[str, Dict[str, Any]]:
        """Answer question based on captured image(s), context, and optional File Search knowledge."""
        if not question or not question.strip():
            question = "What am I looking at?"

        # Normalize images input to list of (bytes, mime)
        image_list = []
        if isinstance(images, bytes):
            image_list = [(images, mime_type)]
        elif isinstance(images, list):
            for item in images:
                if isinstance(item, tuple) and len(item) == 2:
                    image_list.append((item[0], item[1]))
                elif isinstance(item, bytes):
                    image_list.append((item, mime_type))

        if not image_list:
            raise ValueError("No valid image frames provided to GeminiVisionReasoner.")

        # Build prompt contents
        contents = []

        # Include prior conversation history
        if conversation_history:
            for turn in conversation_history:
                role = "user" if turn.get("role") == "user" else "model"
                contents.append(
                    types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=turn.get("content", ""))]
                    )
                )

        # Build user turn parts with image frame(s)
        user_parts = []

        # Subsample chronological frames to at most 4 key frames for rapid reasoning
        if len(image_list) > 4:
            indices = [int(i * (len(image_list) - 1) / 3) for i in range(4)]
            sampled_list = [image_list[idx] for idx in indices]
        else:
            sampled_list = image_list

        if len(image_list) > 1:
            user_parts.append(
                types.Part.from_text(
                    text=f"[Context: Chronological sequence of {len(sampled_list)} camera frames captured leading up to now.]"
                )
            )

        for img_bytes, mime in sampled_list:
            processed_bytes, resolved_mime = self._prepare_image(img_bytes)
            user_parts.append(
                types.Part.from_bytes(
                    data=processed_bytes,
                    mime_type=resolved_mime
                )
            )

        # Structure-aware knowledge context injection from Docling retrieval
        has_docling_rag = bool(retrieved_chunks and len(retrieved_chunks) > 0)
        if has_docling_rag:
            chunk_sections = []
            for i, chunk in enumerate(retrieved_chunks, start=1):
                header_parts = [f"Source {i}: {chunk.document_name}"]
                if chunk.page_number:
                    header_parts.append(f"Page: {chunk.page_number}")
                if chunk.section_title:
                    header_parts.append(f"Section: {chunk.section_title}")
                header = " | ".join(header_parts)
                chunk_sections.append(f"[{header}]\n{chunk.text}")

            context_block = "\n\n".join(chunk_sections)
            user_parts.append(
                types.Part.from_text(
                    text=f"=== RETRIEVED SITE DOCUMENTATION ===\n{context_block}\n==================================="
                )
            )

        user_parts.append(types.Part.from_text(text=f"Question: {question}"))

        contents.append(
            types.Content(
                role="user",
                parts=user_parts
            )
        )

        # Select system instruction
        is_rag_query = has_docling_rag or bool(file_search_store_name)
        if system_instruction_override:
            active_prompt = system_instruction_override
        elif is_rag_query:
            active_prompt = KAYA_RAG_SYSTEM_PROMPT
        else:
            active_prompt = KAYA_VISION_SYSTEM_PROMPT

        # Configure tools (File Search if store_name provided for legacy mode)
        tools = None
        if file_search_store_name and not has_docling_rag:
            tools = [
                types.Tool(
                    file_search=types.FileSearch(
                        file_search_store_names=[file_search_store_name]
                    )
                )
            ]

        config = types.GenerateContentConfig(
            system_instruction=active_prompt,
            temperature=0.2 if is_rag_query else 0.3,
            max_output_tokens=300,
            tools=tools,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True) if not tools else None,
        )



        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=config
            )
        except Exception as e:
            logger.error(f"[GeminiVisionReasoner] API generate_content failed: {e}")
            if is_rag_query:
                # Handle RAG failure fallback gracefully
                logger.warning("[GeminiVisionReasoner] RAG search failed. Attempting fallback.")
                return {
                    "text": "I couldn't access the site knowledge base right now, so I can't reliably verify that requirement.",
                    "sources": [],
                    "rag_failed": True,
                    "error": str(e),
                }
            raise RuntimeError(f"Gemini API error: {e}")

        # Extract answer text and grounding citations
        answer_text = response.text or "I was unable to determine an answer from the available input."
        sources = []

        # If Docling chunks were injected, populate source metadata
        if has_docling_rag:
            seen = set()
            for chunk in retrieved_chunks:
                key = (chunk.document_name, chunk.page_number)
                if key not in seen:
                    seen.add(key)
                    sources.append({
                        "title": chunk.document_name,
                        "page": chunk.page_number,
                        "section": chunk.section_title,
                        "score": chunk.score,
                        "text": chunk.text[:200] if chunk.text else "",
                    })

        # Also parse grounding metadata if Gemini File Search tool was used
        elif response.candidates and response.candidates[0].grounding_metadata:
            gm = response.candidates[0].grounding_metadata
            if gm.grounding_chunks:
                seen_sources = set()
                for chunk in gm.grounding_chunks:
                    rc = getattr(chunk, "retrieved_context", None)
                    if rc:
                        title = getattr(rc, "title", "") or "Document"
                        # Clean up temp file names if present
                        display_title = os.path.basename(title)
                        page = getattr(rc, "page_number", None)
                        text_snippet = getattr(rc, "text", "")
                        source_key = (display_title, page)

                        if source_key not in seen_sources:
                            seen_sources.add(source_key)
                            sources.append({
                                "title": display_title,
                                "page": page,
                                "text": text_snippet[:200] if text_snippet else "",
                                "store": getattr(rc, "file_search_store", ""),
                            })

        return {
            "text": answer_text.strip(),
            "sources": sources,
            "grounded": bool(sources),
        }
