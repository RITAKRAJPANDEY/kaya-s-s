"""Abstract base classes and interfaces for Kaya Voice + Vision Assistant."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union


class STTProvider(ABC):
    """Abstract interface for Speech-to-Text transcription providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identification name."""
        pass

    @abstractmethod
    async def transcribe(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> str:
        """Transcribe speech audio bytes to text string.

        Args:
            audio_bytes: Raw audio byte buffer.
            mime_type: MIME type of audio (e.g. 'audio/wav', 'audio/webm').

        Returns:
            Transcribed text.
        """
        pass


from dataclasses import dataclass, field


@dataclass
class RetrievedChunk:
    """Represents a structure-aware knowledge chunk retrieved for RAG."""
    text: str
    document_name: str
    page_number: Optional[int] = None
    section_title: Optional[str] = None
    score: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


class VisionReasoner(ABC):
    """Abstract interface for Multimodal Vision + LLM reasoning providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identification name."""
        pass

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Name of the underlying multimodal model."""
        pass

    @abstractmethod
    async def answer(
        self,
        question: str,
        images: Any,  # Union[List[Tuple[bytes, str]], bytes, List[bytes]]
        conversation_history: Optional[List[Dict[str, Any]]] = None,
        mime_type: str = "image/jpeg",
        retrieved_chunks: Optional[List[RetrievedChunk]] = None,
        file_search_store_name: Optional[str] = None,
        system_instruction_override: Optional[str] = None,
    ) -> Union[str, Dict[str, Any]]:
        """Answer user's question using the captured image(s), conversation context, and optional knowledge retrieval.

        Args:
            question: The user's transcribed or typed question.
            images: Single image bytes, or list of (image_bytes, mime_type) in chronological order.
            conversation_history: List of prior turns [{'role': 'user'|'assistant', 'content': '...'}].
            mime_type: Default MIME type if raw bytes passed.
            retrieved_chunks: Optional list of RetrievedChunk objects for grounded RAG context injection.
            file_search_store_name: Optional Gemini File Search store resource name (legacy fallback).
            system_instruction_override: Optional system prompt override.

        Returns:
            Natural spoken response string or Dict with 'text' and 'sources'.
        """
        pass


class KnowledgeRetriever(ABC):
    """Abstract interface for knowledge base retrieval providers (Docling vector, Qdrant, etc.)."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identification name."""
        pass

    @abstractmethod
    async def is_ready(self) -> bool:
        """Check if knowledge store is configured, indexed, and accessible."""
        pass

    @abstractmethod
    async def retrieve(self, query: str, top_k: int = 4) -> List[RetrievedChunk]:
        """Retrieve the top-k most relevant structure-aware document chunks for the query."""
        pass

    @abstractmethod
    async def get_store_info(self) -> Dict[str, Any]:
        """Return summary metadata of the knowledge store (e.g. document count, chunks count, status)."""
        pass

    @abstractmethod
    def get_file_search_store_name(self) -> Optional[str]:
        """Return the active Gemini File Search store name, if applicable."""
        pass



class TTSProvider(ABC):
    """Abstract interface for Text-to-Speech synthesis providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identification name."""
        pass

    @abstractmethod
    async def synthesize(self, text: str) -> bytes:
        """Synthesize text into speech audio bytes.

        Args:
            text: Text to synthesize.

        Returns:
            Audio bytes (e.g. WAV / MP3 format).
        """
        pass

