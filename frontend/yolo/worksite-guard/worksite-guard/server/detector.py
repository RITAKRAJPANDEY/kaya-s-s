"""YOLO-based object detector wrapper.

Always loads a general-purpose COCO model (auto-downloaded by ultralytics).
If a PPE-specific model is present at settings.PPE_MODEL_PATH, it is loaded
too and its detections (hard hat / vest / mask compliance) are merged in.
Without a PPE model, compliance checks are simply skipped — proximity and
sharp-object checks still work using the general model alone.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import NamedTuple, Optional

import os
import torch
import numpy as np
from ultralytics import YOLO

from config import settings

# Optimize PyTorch CPU inference threads
if hasattr(torch, "set_num_threads"):
    threads = max(1, min(os.cpu_count() or 4, 8))
    torch.set_num_threads(threads)
torch.set_grad_enabled(False)

logger = logging.getLogger("worksite_guard.detector")


class Detection(NamedTuple):
    label: str
    confidence: float
    x1: int
    y1: int
    x2: int
    y2: int
    source: str  # "general" or "ppe"

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)


class Detector:
    def __init__(self) -> None:
        logger.info("Loading general model: %s", settings.GENERAL_MODEL_PATH)
        self.general_model = YOLO(settings.GENERAL_MODEL_PATH)

        # Warm up general model
        dummy = np.zeros((settings.INFER_WIDTH, settings.INFER_WIDTH, 3), dtype=np.uint8)
        self.general_model.predict(dummy, imgsz=settings.INFER_WIDTH, conf=settings.CONF_THRESHOLD, verbose=False)

        self.ppe_model: Optional[YOLO] = None
        ppe_path = Path(settings.PPE_MODEL_PATH)
        if ppe_path.exists():
            logger.info("Loading PPE model: %s", ppe_path)
            self.ppe_model = YOLO(str(ppe_path))
            self.ppe_model.predict(dummy, imgsz=settings.INFER_WIDTH, conf=settings.CONF_THRESHOLD, verbose=False)
        else:
            logger.warning(
                "No PPE model found at %s -- hard hat / vest compliance checks "
                "are disabled until you add one. See README.md.",
                ppe_path,
            )

    def _run(self, model: YOLO, frame: np.ndarray, source: str) -> list[Detection]:
        with torch.inference_mode():
            results = model.predict(
                frame,
                imgsz=settings.INFER_WIDTH,
                conf=settings.CONF_THRESHOLD,
                verbose=False,
            )
        detections: list[Detection] = []
        for r in results:
            if r.boxes is None:
                continue
            names = r.names
            for box in r.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                detections.append(
                    Detection(
                        label=names[cls_id],
                        confidence=conf,
                        x1=x1, y1=y1, x2=x2, y2=y2,
                        source=source,
                    )
                )
        return detections

    def detect(self, frame: np.ndarray) -> list[Detection]:
        detections = self._run(self.general_model, frame, "general")
        if self.ppe_model is not None:
            detections += self._run(self.ppe_model, frame, "ppe")
        return detections
