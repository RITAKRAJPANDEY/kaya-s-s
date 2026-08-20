"""Mock Multimodal Vision Reasoner for offline testing."""

from typing import Any, Dict, List, Optional, Tuple
from app.interfaces import VisionReasoner


class MockVisionReasoner(VisionReasoner):
    """Mock vision reasoner for local tests and offline development."""

    @property
    def name(self) -> str:
        return "mock"

    @property
    def model_name(self) -> str:
        return "mock-vlm-v1"

    def _normalize_images(self, images: Any, default_mime: str = "image/jpeg") -> List[Tuple[bytes, str]]:
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
        retrieved_chunks: Optional[Any] = None,
        file_search_store_name: Optional[str] = None,
        system_instruction_override: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return a structured mock response referencing question, frame count, and RAG status."""
        image_list = self._normalize_images(images, mime_type)
        frame_count = len(image_list)
        q = question.strip() if question else "What is this?"

        if retrieved_chunks and len(retrieved_chunks) > 0:
            text = f"According to site documentation, here is the verified safety rule for '{q}'. (Observed: {frame_count} frame{'s' if frame_count != 1 else ''})."
            sources = [
                {
                    "title": c.document_name,
                    "page": c.page_number,
                    "section": c.section_title,
                    "score": c.score,
                    "text": c.text[:200]
                }
                for c in retrieved_chunks
            ]
            return {"text": text, "sources": sources, "grounded": True}

        if file_search_store_name:
            text = f"According to site documentation, here is the procedure for '{q}'. (Observed: {frame_count} frame{'s' if frame_count != 1 else ''})."
            sources = [{"title": "site_safety_manual.txt", "page": 1, "text": "Mock safety section snippet"}]
            return {"text": text, "sources": sources, "grounded": True}

        if frame_count > 1:
            return f"I analyzed a temporal sequence of {frame_count} frames. In response to '{q}': The scene shows consistent lighting with subtle movement across the frames."
        return f"I can see the camera frame clearly. In response to '{q}': This appears to be an object in front of the lens."




