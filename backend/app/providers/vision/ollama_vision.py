"""Ollama Multimodal Vision Reasoner Provider."""

import base64
import io
from typing import Any, Dict, List, Optional, Tuple
import httpx
from PIL import Image

from app.interfaces import VisionReasoner
from app.providers.vision.gemini_vision import KAYA_SYSTEM_PROMPT


class OllamaVisionReasoner(VisionReasoner):
    """Multimodal reasoning using Ollama local or cloud VLM endpoints."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llava"):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_url = f"{self.base_url}/api/chat"

    @property
    def name(self) -> str:
        return "ollama"

    @property
    def model_name(self) -> str:
        return self.model

    def _prepare_image_b64(self, image_bytes: bytes, max_dim: int = 1024) -> str:
        """Resize image if needed and convert to base64 string for Ollama."""
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                img = img.convert("RGB")
                if max(img.width, img.height) > max_dim:
                    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=80)
                return base64.b64encode(buf.getvalue()).decode("utf-8")
        except Exception:
            return base64.b64encode(image_bytes).decode("utf-8")

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
        file_search_store_name: Optional[str] = None,
        system_instruction_override: Optional[str] = None,
        **kwargs
    ) -> str:
        """Answer question based on image(s) using Ollama /api/chat."""

        if not question or not question.strip():
            question = "What am I looking at?"

        image_list = self._normalize_images(images, mime_type)
        if not image_list:
            raise ValueError("No valid image frames provided to OllamaVisionReasoner.")

        b64_images = [self._prepare_image_b64(b) for b, _ in image_list]

        messages = [
            {"role": "system", "content": KAYA_SYSTEM_PROMPT}
        ]

        if conversation_history:
            for turn in conversation_history:
                role = "user" if turn.get("role") == "user" else "assistant"
                content = turn.get("content", "")
                if content:
                    messages.append({"role": role, "content": content})

        prompt_content = question
        if len(b64_images) > 1:
            prompt_content = f"[Analyzing a sequence of {len(b64_images)} frames at 1 FPS] {question}"

        # Append current user message with images attached
        messages.append({
            "role": "user",
            "content": prompt_content,
            "images": b64_images
        })

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "num_predict": 300
            }
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                self.api_url,
                json=payload
            )

        if response.status_code != 200:
            raise RuntimeError(f"Ollama API error (status {response.status_code}): {response.text}")

        data = response.json()
        answer = data.get("message", {}).get("content", "").strip()
        return answer or "I was unable to analyze the frame."
