"""Multimodal Vision Reasoning Hook powered by Kaya's Modular VLM Pipeline."""

from __future__ import annotations

import asyncio
import io
import logging
from typing import Any, Dict, List, Optional
import cv2
import numpy as np
from PIL import Image

from app.config import get_settings
from app.factory import get_vision_reasoner
from app.interfaces import VisionReasoner

logger = logging.getLogger("kaya.vlm_hook")


class VLMHook:
    """Multimodal Vision Reasoner wired into the safety copilot."""

    def __init__(self, config: Optional[dict] = None, event_logger=None) -> None:
        self.config = config or {}
        self.settings = get_settings()
        self.event_logger = event_logger
        self._vision_reasoner: Optional[VisionReasoner] = None

        try:
            self._vision_reasoner = get_vision_reasoner(self.settings)
            self._available = True
            logger.info(f"VLMHook initialized with provider: {self._vision_reasoner.name} ({self._vision_reasoner.model_name})")
        except Exception as e:
            logger.warning(f"VLMHook provider initialization warning: {e}. Falling back to mock/offline.")
            self._available = False

    def is_available(self) -> bool:
        return self._available and self._vision_reasoner is not None

    def _frame_to_jpeg_bytes(self, frame: np.ndarray) -> bytes:
        """Convert an OpenCV BGR numpy frame to JPEG bytes."""
        if frame is None or frame.size == 0:
            return b""
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(rgb)
        buf = io.BytesIO()
        pil_img.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    def ask_question(
        self,
        question: str,
        frame_result: Any = None,
        frame: Optional[np.ndarray] = None,
        frames_sequence: Optional[List[np.ndarray]] = None
    ) -> str:
        """Ask a visual question over single or temporal sequence of frames."""
        if not self.is_available():
            return "Vision Reasoner is currently offline."

        images = []
        if frames_sequence and len(frames_sequence) > 0:
            for f in frames_sequence:
                b = self._frame_to_jpeg_bytes(f)
                if b:
                    images.append((b, "image/jpeg"))
        elif frame is not None:
            b = self._frame_to_jpeg_bytes(frame)
            if b:
                images.append((b, "image/jpeg"))

        if not images:
            return "No camera frame available to analyze."

        try:
            loop = None
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(
                        asyncio.run,
                        self._vision_reasoner.answer(
                            question=question,
                            images=images
                        )
                    )
                    return future.result()
            else:
                return loop.run_until_complete(
                    self._vision_reasoner.answer(
                        question=question,
                        images=images
                    )
                )

        except Exception as e:
            logger.exception(f"VLMHook reasoning error: {e}")
            return f"I was unable to analyze the frame: {e}"

    def escalate_to_reasoning(
        self,
        frame: np.ndarray,
        detections: List[Any],
        hazard_context: Dict[str, Any],
        frame_result: Any = None
    ) -> Optional[str]:
        """Assess a detected safety hazard using multimodal vision."""
        hazard = hazard_context.get("hazard")
        hazard_type = getattr(hazard, "hazard_type", "Hazard") if hazard else "Safety Hazard"
        prompt = f"Assess the current visual scene regarding {hazard_type}. State what hazard is present and give a concise 1-2 sentence recommendation."
        return self.ask_question(question=prompt, frame=frame)

    @staticmethod
    def _build_chat_url_candidates(url: str) -> List[str]:
        """Build fallback chat endpoint candidate URLs for Ollama compatibility."""
        candidates = [url]
        if url.endswith("/api/chat"):
            candidates.extend([
                url.replace("/api/chat", "/api/generate"),
                url.replace("/api/chat", "/v1/chat/completions")
            ])
        return candidates

    def stop(self) -> None:
        pass
