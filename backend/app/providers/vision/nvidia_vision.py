"""NVIDIA NIM / Integrate API Multimodal Vision Reasoner Provider."""

import base64
import io
from typing import Any, Dict, List, Optional, Tuple
import httpx
from PIL import Image, ImageDraw

from app.interfaces import VisionReasoner
from app.providers.vision.gemini_vision import KAYA_SYSTEM_PROMPT


class NvidiaVisionReasoner(VisionReasoner):
    """Multimodal reasoning using NVIDIA Integrate / NIM API.

    Handles both native single images and temporal frame sequences by assembling
    temporal contact sheet montages when the API enforces a 1-image limit.
    """

    def __init__(
        self,
        api_key: str,
        model: str = "meta/llama-3.2-11b-vision-instruct",
        base_url: str = "https://integrate.api.nvidia.com/v1"
    ):
        if not api_key:
            raise ValueError("NVIDIA API key is required for NvidiaVisionReasoner.")
        self.api_key = api_key
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_url = f"{self.base_url}/chat/completions"

    @property
    def name(self) -> str:
        return "nvidia"

    @property
    def model_name(self) -> str:
        return self.model

    def _prepare_image_b64(self, image_bytes: bytes, max_dim: int = 1280) -> tuple[str, str]:
        """Resize image if needed and return base64 string and mime type."""
        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                img = img.convert("RGB")
                if max(img.width, img.height) > max_dim:
                    img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=85)
                b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
                return b64, "image/jpeg"
        except Exception:
            return base64.b64encode(image_bytes).decode("utf-8"), "image/jpeg"

    def _create_temporal_montage(self, image_list: List[Tuple[bytes, str]]) -> bytes:
        """Combine multiple chronological frames into a single temporal grid montage."""
        num_frames = len(image_list)
        if num_frames == 1:
            return image_list[0][0]

        pil_images = []
        for img_bytes, _ in image_list:
            try:
                im = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                # Scale each tile to a standard size e.g. 480x270
                im = im.resize((480, 270), Image.Resampling.LANCZOS)
                pil_images.append(im)
            except Exception:
                pass

        if not pil_images:
            return image_list[-1][0]
        if len(pil_images) == 1:
            buf = io.BytesIO()
            pil_images[0].save(buf, format="JPEG", quality=85)
            return buf.getvalue()

        # Arrange in a grid: 2 columns if <= 4 frames, or 3 columns if more
        cols = 2 if len(pil_images) <= 4 else 3
        rows = (len(pil_images) + cols - 1) // cols

        tile_w, tile_h = 480, 270
        grid_img = Image.new("RGB", (cols * tile_w, rows * tile_h), color=(10, 15, 25))
        draw = ImageDraw.Draw(grid_img)

        for idx, im in enumerate(pil_images):
            r = idx // cols
            c = idx % cols
            x = c * tile_w
            y = r * tile_h
            grid_img.paste(im, (x, y))
            # Label each tile with chronological indicator
            frame_label = f"T-{len(pil_images)-1-idx}s" if idx < len(pil_images)-1 else "NOW (Latest)"
            draw.rectangle([x + 6, y + 6, x + 120, y + 26], fill=(0, 0, 0, 180))
            draw.text((x + 12, y + 8), f"Frame {idx+1}: {frame_label}", fill=(255, 255, 255))

        buf = io.BytesIO()
        grid_img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

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
        """Answer question based on image(s) using NVIDIA Integrate chat completions endpoint."""

        if not question or not question.strip():
            question = "What am I looking at?"

        image_list = self._normalize_images(images, mime_type)
        if not image_list:
            raise ValueError("No valid image frames provided to NvidiaVisionReasoner.")

        # If multiple frames are provided, create a temporal grid montage to respect NVIDIA 1-image limit
        if len(image_list) > 1:
            composite_bytes = self._create_temporal_montage(image_list)
            b64_image, resolved_mime = self._prepare_image_b64(composite_bytes)
            temporal_instruction = f"[The image is a chronological grid of {len(image_list)} camera frames captured at 1 FPS leading up to the current moment labeled T-Ns to NOW] "
        else:
            b64_image, resolved_mime = self._prepare_image_b64(image_list[0][0])
            temporal_instruction = ""

        image_data_uri = f"data:{resolved_mime};base64,{b64_image}"

        # Build OpenAI/NVIDIA messages format
        messages = [
            {
                "role": "system",
                "content": KAYA_SYSTEM_PROMPT
            }
        ]

        if conversation_history:
            for turn in conversation_history:
                role = "user" if turn.get("role") == "user" else "assistant"
                content = turn.get("content", "")
                if content:
                    messages.append({"role": role, "content": content})

        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"{temporal_instruction}{question}".strip()
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": image_data_uri
                    }
                }
            ]
        })

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "temperature": 0.3,
            "top_p": 0.95
        }

        if "reasoning" in self.model or "nemotron" in self.model:
            payload["max_tokens"] = 4096
            payload["reasoning_budget"] = 1024
        else:
            payload["max_tokens"] = 350

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        async with httpx.AsyncClient(timeout=45.0) as client:
            response = await client.post(
                self.api_url,
                headers=headers,
                json=payload
            )

        if response.status_code != 200:
            raise RuntimeError(f"NVIDIA API error (status {response.status_code}): {response.text}")

        data = response.json()
        try:
            choices = data.get("choices", [])
            if not choices:
                raise RuntimeError("No choices returned from NVIDIA API.")
            message = choices[0].get("message", {})
            content = message.get("content", "")
            
            # Clean up reasoning tags if present
            if isinstance(content, str):
                if "</think>" in content:
                    content = content.split("</think>")[-1].strip()
                return content.strip() or "I was unable to analyze the frame."
            return str(content)
        except Exception as e:
            raise RuntimeError(f"Failed to parse NVIDIA API response: {e}")
