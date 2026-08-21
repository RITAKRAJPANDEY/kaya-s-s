"""Multi-model Detection Engine for Safety Copilot.

Runs unified detection and tracking across:
1. General COCO Model (e.g. YOLO11n) for persons, vehicles, workplace objects, and general items.
2. PPE-Specific Model for job-site compliance (Hardhat, Vest, Mask, Gloves, Boots, etc.).
3. Open-Vocabulary Tool Model (YOLO-World) for construction tools (hammers, drills, saws, wrenches, etc.).

Features ByteTrack/Spatial tracking, intelligent multi-model deduplication, and appearance embeddings.
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np

# Suppress misleading ultralytics warning when ReID initializes
try:
    from ultralytics.utils import LOGGER as ULTRALYTICS_LOGGER

    class _UltralyticsSourceFilter(logging.Filter):
        def filter(self, record):
            msg = record.getMessage()
            return "'source' is missing" not in msg and "'half' is deprecated" not in msg

    ULTRALYTICS_LOGGER.addFilter(_UltralyticsSourceFilter())
except ImportError:
    pass

from core.models import Detection

logger = logging.getLogger(__name__)

# ── PPE name normalisation ───────────────────────────────────

# Regex patterns → canonical name
_PPE_NAME_MAP: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(?i)^no[_\-\s]*hard[_\-\s]*hat"), "no_hardhat"),
    (re.compile(r"(?i)^no[_\-\s]*safety[_\-\s]*vest"), "no_vest"),
    (re.compile(r"(?i)^no[_\-\s]*vest"), "no_vest"),
    (re.compile(r"(?i)^no[_\-\s]*goggle"), "no_goggles"),
    (re.compile(r"(?i)^no[_\-\s]*glove"), "no_gloves"),
    (re.compile(r"(?i)^no[_\-\s]*boot"), "no_boots"),
    (re.compile(r"(?i)^no[_\-\s]*mask"), "no_mask"),
    (re.compile(r"(?i)hard[_\-\s]*hat"), "hardhat"),
    (re.compile(r"(?i)^helmet"), "hardhat"),
    (re.compile(r"(?i)safety[_\-\s]*vest"), "vest"),
    (re.compile(r"(?i)^vest"), "vest"),
    (re.compile(r"(?i)^goggle"), "goggles"),
    (re.compile(r"(?i)^glove"), "gloves"),
    (re.compile(r"(?i)^boot"), "boots"),
    (re.compile(r"(?i)^mask"), "mask"),
]

# Set of canonical PPE gear names (used to set is_ppe flag)
_PPE_GEAR_CLASSES = frozenset({
    "hardhat", "no_hardhat", "vest", "no_vest", "goggles", "no_goggles",
    "gloves", "no_gloves", "boots", "no_boots", "mask", "no_mask",
})

# ── Tool name normalisation ──────────────────────────────────

_TOOL_NAME_MAP: list[tuple[re.Pattern, str]] = [
    (re.compile(r"(?i)power[_\-\s]*drill"), "drill"),
    (re.compile(r"(?i)drill"), "drill"),
    (re.compile(r"(?i)circular[_\-\s]*saw"), "saw"),
    (re.compile(r"(?i)hand[_\-\s]*saw"), "saw"),
    (re.compile(r"(?i)chainsaw"), "saw"),
    (re.compile(r"(?i)saw"), "saw"),
    (re.compile(r"(?i)measuring[_\-\s]*tape"), "measuring_tape"),
    (re.compile(r"(?i)tape[_\-\s]*measure"), "measuring_tape"),
    (re.compile(r"(?i)screwdriver"), "screwdriver"),
    (re.compile(r"(?i)adjustable[_\-\s]*wrench"), "wrench"),
    (re.compile(r"(?i)wrench"), "wrench"),
    (re.compile(r"(?i)pliers"), "pliers"),
    (re.compile(r"(?i)hammer"), "hammer"),
    (re.compile(r"(?i)scissors"), "scissors"),
    (re.compile(r"(?i)box[_\-\s]*cutter"), "knife"),
    (re.compile(r"(?i)utility[_\-\s]*knife"), "knife"),
    (re.compile(r"(?i)knife"), "knife"),
    (re.compile(r"(?i)spirit[_\-\s]*level"), "level"),
    (re.compile(r"(?i)level"), "level"),
    (re.compile(r"(?i)flashlight"), "flashlight"),
    (re.compile(r"(?i)shovel"), "shovel"),
    (re.compile(r"(?i)ladder"), "ladder"),
    (re.compile(r"(?i)toolbox"), "toolbox"),
    (re.compile(r"(?i)power[_\-\s]*tool"), "tool"),
    (re.compile(r"(?i)tool"), "tool"),
    (re.compile(r"(?i)fire[_\-\s]*extinguisher"), "fire_extinguisher"),
]


def _normalise_ppe_name(raw: str) -> str:
    """Map a raw PPE class name to a canonical name."""
    for pattern, canonical in _PPE_NAME_MAP:
        if pattern.search(raw):
            return canonical
    return raw.strip().lower().replace(" ", "_").replace("-", "_")


def _normalise_tool_name(raw: str) -> str:
    """Map a raw tool class name to a canonical name."""
    for pattern, canonical in _TOOL_NAME_MAP:
        if pattern.search(raw):
            return canonical
    return raw.strip().lower().replace(" ", "_").replace("-", "_")


def _box_iou(box1: tuple[int, int, int, int], box2: tuple[int, int, int, int]) -> float:
    """Calculate Intersection-over-Union (IoU) between two bounding boxes."""
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2

    xi1 = max(x1_1, x1_2)
    yi1 = max(y1_1, y1_2)
    xi2 = min(x2_1, x2_2)
    yi2 = min(y2_1, y2_2)

    inter_area = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    box1_area = max(0, x2_1 - x1_1) * max(0, y2_1 - y1_1)
    box2_area = max(0, x2_2 - x1_2) * max(0, y2_2 - y1_2)
    union_area = box1_area + box2_area - inter_area

    if union_area <= 0:
        return 0.0
    return float(inter_area) / float(union_area)


class _SpatialTracker:
    """Fast spatial IoU tracker for auxiliary detections (tools, custom objects)."""

    def __init__(self, start_id: int = 200, max_stale_frames: int = 20, iou_thresh: float = 0.20):
        self._next_id = start_id
        self._tracks: dict[int, dict[str, Any]] = {}
        self._max_stale_frames = max_stale_frames
        self._iou_thresh = iou_thresh

    def update(self, detections: list[Detection], frame_number: int) -> list[Detection]:
        # Expire stale tracks
        dead = [
            tid for tid, t in self._tracks.items()
            if frame_number - t["last_frame"] > self._max_stale_frames
        ]
        for tid in dead:
            del self._tracks[tid]

        unmatched = list(range(len(detections)))
        for tid, t in list(self._tracks.items()):
            best_iou = 0.0
            best_idx = -1
            for idx in unmatched:
                det = detections[idx]
                if det.class_name == t["class_name"]:
                    iou = _box_iou(det.bbox, t["bbox"])
                    if iou > best_iou and iou >= self._iou_thresh:
                        best_iou = iou
                        best_idx = idx
            if best_idx != -1:
                detections[best_idx].track_id = tid
                self._tracks[tid]["bbox"] = detections[best_idx].bbox
                self._tracks[tid]["last_frame"] = frame_number
                unmatched.remove(best_idx)

        # Assign new IDs for remaining detections
        for idx in unmatched:
            tid = self._next_id
            self._next_id += 1
            detections[idx].track_id = tid
            self._tracks[tid] = {
                "bbox": detections[idx].bbox,
                "class_name": detections[idx].class_name,
                "last_frame": frame_number,
            }

        return detections


class Detector:
    """Multi-model unified detector (General COCO + PPE + YOLO-World Tools).

    Args:
        general_model_path: Path or name for the COCO-pretrained model
            (e.g. ``"yolo11n.pt"`` or ``"yolo26n.pt"``).
        ppe_model_path: Path to a PPE-specific model, or ``None`` to skip.
        device: Compute device string (``"cpu"``, ``"mps"``, etc.).
        tracker_config: Tracking configuration file for ByteTrack.
        general_conf: Confidence threshold for the general model.
        general_iou: IoU threshold for NMS on the general model.
        general_classes: Optional list of class names or IDs to filter. None = all classes.
        ppe_conf: Confidence threshold for the PPE model.
        ppe_iou: IoU threshold for NMS on the PPE model.
        ppe_api_key: Roboflow API key if using a Roboflow model.
        tool_model_path: Path to YOLO-World model (e.g. ``"yolov8s-worldv2.pt"``).
        tool_conf: Confidence threshold for the tool model.
        tool_iou: IoU threshold for NMS on the tool model.
        tool_classes: List of open-vocabulary tool classes for YOLO-World.
    """

    def __init__(
        self,
        general_model_path: Optional[str] = "yolo11n.pt",
        ppe_model_path: Optional[str] = None,
        device: str = "cpu",
        tracker_config: str = "bytetrack.yaml",
        general_conf: float = 0.30,
        general_iou: float = 0.45,
        general_classes: Optional[list[str] | list[int]] = None,
        ppe_conf: float = 0.30,
        ppe_iou: float = 0.45,
        ppe_api_key: Optional[str] = None,
        tool_model_path: Optional[str] = None,
        tool_conf: float = 0.20,
        tool_iou: float = 0.45,
        tool_classes: Optional[list[str]] = None,
    ) -> None:
        from ultralytics import YOLO

        self._device = device
        self._is_cuda = str(self._device) in ("0", "cuda") or str(self._device).startswith("cuda")
        self._tracker_config = tracker_config
        self._general_conf = general_conf
        self._general_iou = general_iou
        self._ppe_conf = ppe_conf
        self._ppe_iou = ppe_iou
        self._tool_conf = tool_conf
        self._tool_iou = tool_iou
        self._tool_classes = tool_classes or []
        self._cached_tool_detections: list[Detection] = []
        self._tool_tracker = _SpatialTracker(start_id=200)

        # ── Load general (COCO) model ─────────────────────────
        self._general_model = None
        self._allowed_coco_ids: Optional[list[int]] = None
        self._coco_names: dict[int, str] = {}

        if general_model_path is not None and general_model_path.lower() not in ("none", "null", ""):
            logger.info(
                "Loading general model '%s' on device '%s'…",
                general_model_path,
                device,
            )
            self._general_model = YOLO(general_model_path)
            self._coco_names = {i: name for i, name in self._general_model.names.items()}
            logger.info("General model loaded — %d classes available", len(self._coco_names))

            if general_classes:
                name_to_id = {v.lower(): k for k, v in self._coco_names.items()}
                resolved_ids = []
                for c in general_classes:
                    if isinstance(c, int):
                        resolved_ids.append(c)
                    elif isinstance(c, str) and c.lower() in name_to_id:
                        resolved_ids.append(name_to_id[c.lower()])
                self._allowed_coco_ids = resolved_ids if resolved_ids else None
                logger.info("Filtering general model to classes: %s", self._allowed_coco_ids)
        else:
            logger.info("General model disabled")

        # ── Load tool model (optional YOLO-World) ─────────────
        self._tool_model = None
        if tool_model_path is not None and self._tool_classes:
            logger.info(
                "Loading YOLO-World tool model '%s' on device '%s'…",
                tool_model_path,
                device,
            )
            from ultralytics import YOLOWorld
            self._tool_model = YOLOWorld(tool_model_path)
            self._tool_model.set_classes(self._tool_classes)
            logger.info("YOLO-World tool model loaded with %d classes: %s", len(self._tool_classes), self._tool_classes)

        # ── Load PPE model (optional) ─────────────────────────
        self._ppe_model = None
        self._ppe_model_is_roboflow = False
        if ppe_model_path is not None:
            logger.info(
                "Loading PPE model '%s' on device '%s'…",
                ppe_model_path,
                device,
            )
            if "/" in ppe_model_path and not ppe_model_path.endswith(".pt") and not ppe_model_path.startswith("hf:"):
                import os
                import sys
                if ppe_api_key:
                    os.environ["ROBOFLOW_API_KEY"] = ppe_api_key
                try:
                    from inference import get_model
                    self._ppe_model = get_model(model_id=ppe_model_path)
                    self._ppe_model_is_roboflow = True
                    logger.info("PPE model loaded via Roboflow Inference API")
                except Exception as e:
                    logger.error("Failed to load Roboflow PPE model: %s", e)
            elif ppe_model_path.startswith("hf:"):
                try:
                    parts = ppe_model_path.split(":", 2)
                    repo_id = parts[1]
                    filename = parts[2]
                    logger.info("Downloading model '%s' from Hugging Face repo '%s'…", filename, repo_id)
                    from huggingface_hub import hf_hub_download
                    downloaded_path = hf_hub_download(repo_id=repo_id, filename=filename)
                    self._ppe_model = YOLO(downloaded_path)
                    logger.info(
                        "PPE model loaded from Hugging Face — classes: %s",
                        {i: n for i, n in self._ppe_model.names.items()},
                    )
                except Exception as e:
                    logger.critical("Failed to download model from Hugging Face: %s", e)
            else:
                self._ppe_model = YOLO(ppe_model_path)
                logger.info(
                    "PPE model loaded — classes: %s",
                    {i: n for i, n in self._ppe_model.names.items()},
                )
        else:
            logger.info("No PPE model specified — PPE detection disabled")

    # ── Public API ────────────────────────────────────────────

    def detect(self, frame: np.ndarray) -> list[Detection]:
        """Run all active models on *frame* without tracking and return merged detections."""
        detections: list[Detection] = []

        if self._general_model is not None:
            detections.extend(self._run_general(frame))

        if self._ppe_model is not None:
            detections.extend(self._run_ppe(frame))

        if self._tool_model is not None:
            tool_results = self._tool_model.predict(
                source=frame,
                device=self._device,
                conf=self._tool_conf,
                iou=self._tool_iou,
                verbose=False,
            )
            detections.extend(self._parse_tool_results(tool_results, with_tracking=False))

        return self._deduplicate(detections)

    def detect_general_tracked(self, frame: np.ndarray) -> list[Detection]:
        """Run general COCO model with ByteTrack tracking."""
        if self._general_model is not None:
            return self._run_general_tracked(frame)
        return []

    def detect_ppe(self, frame: np.ndarray) -> list[Detection]:
        """Run PPE detection model."""
        if self._ppe_model is not None:
            return self._run_ppe(frame)
        return []

    def deduplicate(self, detections: list[Detection]) -> list[Detection]:
        """Deduplicate detections across models."""
        return self._deduplicate(detections)

    def detect_tools(
        self,
        frame: np.ndarray,
        frame_number: int,
        run_every_n: int = 2,
        downscale: bool = True,
    ) -> list[Detection]:
        """Run YOLO-World tool detection with spatial tracking and caching.

        Runs asynchronously in parallel with pose and depth estimation.
        """
        if self._tool_model is None:
            return []

        # Return cached results on frame-skipped frames
        if run_every_n > 1 and (frame_number % run_every_n != 0) and self._cached_tool_detections:
            return list(self._cached_tool_detections)

        inference_frame = frame
        scale_x, scale_y = 1.0, 1.0
        if downscale:
            h, w = frame.shape[:2]
            target_w = 640
            if w > target_w:
                target_h = int(h * (target_w / w))
                inference_frame = cv2.resize(frame, (target_w, target_h))
                scale_x = w / target_w
                scale_y = h / target_h

        tool_results = self._tool_model.predict(
            source=inference_frame,
            device=self._device,
            conf=self._tool_conf,
            iou=self._tool_iou,
            verbose=False,
            half=self._is_cuda,
        )
        raw_detections = self._parse_tool_results(tool_results, with_tracking=False)

        # Scale bboxes back to original frame coordinates
        if downscale and (scale_x != 1.0 or scale_y != 1.0):
            for det in raw_detections:
                x1, y1, x2, y2 = det.bbox
                det.bbox = (
                    int(x1 * scale_x), int(y1 * scale_y),
                    int(x2 * scale_x), int(y2 * scale_y),
                )

        # Assign stable track IDs to tools across frames
        tracked_tools = self._tool_tracker.update(raw_detections, frame_number)
        self._cached_tool_detections = tracked_tools
        return list(tracked_tools)

    def _deduplicate(self, detections: list[Detection]) -> list[Detection]:
        """Remove duplicate detections across models while preserving PPE items on workers."""
        if not detections:
            return []

        # Sort: prefer general/tool models, then higher confidence
        sorted_dets = sorted(
            detections,
            key=lambda d: (1 if d.model_source in ("coco", "tool") else 0, d.confidence),
            reverse=True,
        )
        kept: list[Detection] = []

        for det in sorted_dets:
            overlap = False
            for existing in kept:
                # Do NOT suppress if one is PPE and the other is not (e.g. hardhat on person)
                if det.is_ppe != existing.is_ppe:
                    continue

                # Do NOT suppress if one is a tool and the other is a person
                if (det.model_source == "tool" and existing.class_name == "person") or (
                    existing.model_source == "tool" and det.class_name == "person"
                ):
                    continue

                # Check if classes are compatible or identical
                if self._is_compatible(det.class_name, existing.class_name):
                    if _box_iou(det.bbox, existing.bbox) > 0.45:
                        overlap = True
                        break

            if not overlap:
                kept.append(det)

        return kept

    @staticmethod
    def _is_compatible(cls1: str, cls2: str) -> bool:
        if cls1 == cls2:
            return True
        vehicles = {"car", "truck", "bus", "motorcycle", "forklift", "machinery", "vehicle"}
        if cls1 in vehicles and cls2 in vehicles:
            return True
        tools = {"tool", "drill", "saw", "hammer", "wrench", "screwdriver", "pliers", "knife"}
        if cls1 in tools and cls2 in tools:
            return True
        return False

    # ── Internal: General model ───────────────────────────────

    def _run_general(self, frame: np.ndarray) -> list[Detection]:
        """Run the general COCO model (predict, no tracking)."""
        results = self._general_model.predict(
            source=frame,
            device=self._device,
            conf=self._general_conf,
            iou=self._general_iou,
            verbose=False,
            classes=self._allowed_coco_ids,
            half=self._is_cuda,
        )
        return self._parse_general_results(results, with_tracking=False)

    def _run_general_tracked(self, frame: np.ndarray) -> list[Detection]:
        """Run the general COCO model with configured tracking."""
        results = self._general_model.track(
            source=frame,
            device=self._device,
            conf=self._general_conf,
            iou=self._general_iou,
            verbose=False,
            classes=self._allowed_coco_ids,
            persist=True,
            tracker=self._tracker_config,
            half=self._is_cuda,
        )
        return self._parse_general_results(results, with_tracking=True)

    def _parse_general_results(
        self, results, *, with_tracking: bool = False
    ) -> list[Detection]:
        """Extract ``Detection`` objects from Ultralytics general results."""
        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                continue

            for i in range(len(boxes)):
                cls_id = int(boxes.cls[i].item())
                class_name = self._coco_names.get(cls_id, f"class_{cls_id}").lower().replace(" ", "_")
                conf = float(boxes.conf[i].item())
                x1, y1, x2, y2 = boxes.xyxy[i].tolist()
                bbox = (int(x1), int(y1), int(x2), int(y2))

                track_id: Optional[int] = None
                if with_tracking and boxes.id is not None:
                    track_id = int(boxes.id[i].item())

                appearance_embedding = self._extract_embedding(result, i)

                detections.append(
                    Detection(
                        class_name=class_name,
                        confidence=conf,
                        bbox=bbox,
                        track_id=track_id,
                        is_ppe=False,
                        model_source="coco",
                        appearance_embedding=appearance_embedding,
                    )
                )
        return detections

    @staticmethod
    def _extract_embedding(result, index: int) -> Optional[list[float]]:
        """Best-effort extraction of tracker appearance features."""
        candidates = (
            getattr(result, "embeddings", None),
            getattr(result, "feats", None),
            getattr(result, "features", None),
            getattr(result, "reid_features", None),
            getattr(getattr(result, "boxes", None), "embeddings", None),
            getattr(getattr(result, "boxes", None), "feats", None),
            getattr(getattr(result, "boxes", None), "features", None),
        )
        for candidate in candidates:
            if candidate is None:
                continue
            try:
                vector = candidate[index]
                if hasattr(vector, "detach"):
                    vector = vector.detach().cpu().float().tolist()
                elif hasattr(vector, "tolist"):
                    vector = vector.tolist()
                return [float(v) for v in vector]
            except Exception:
                continue
        return None

    # ── Internal: PPE model ───────────────────────────────────

    def _run_ppe(self, frame: np.ndarray) -> list[Detection]:
        """Run the PPE model and return normalised detections."""
        if self._ppe_model is None:
            return []

        if self._ppe_model_is_roboflow:
            results = self._ppe_model.infer(frame)
            detections: list[Detection] = []
            for res in results:
                for pred in res.predictions:
                    if pred.confidence < self._ppe_conf:
                        continue
                    cx, cy = pred.x, pred.y
                    w, h = pred.width, pred.height
                    x1 = int(cx - w / 2)
                    y1 = int(cy - h / 2)
                    x2 = int(cx + w / 2)
                    y2 = int(cy + h / 2)
                    bbox = (x1, y1, x2, y2)
                    canonical = _normalise_ppe_name(pred.class_name)
                    is_gear = canonical in _PPE_GEAR_CLASSES
                    detections.append(
                        Detection(
                            class_name=canonical,
                            confidence=pred.confidence,
                            bbox=bbox,
                            track_id=None,
                            is_ppe=is_gear,
                            model_source="ppe",
                        )
                    )
            return detections

        results = self._ppe_model.predict(
            source=frame,
            device=self._device,
            conf=self._ppe_conf,
            iou=self._ppe_iou,
            verbose=False,
            half=self._is_cuda,
        )

        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                continue

            for i in range(len(boxes)):
                cls_id = int(boxes.cls[i].item())
                raw_name = self._ppe_model.names.get(cls_id, f"class_{cls_id}")
                canonical = _normalise_ppe_name(raw_name)
                conf = float(boxes.conf[i].item())
                x1, y1, x2, y2 = boxes.xyxy[i].tolist()
                bbox = (int(x1), int(y1), int(x2), int(y2))

                is_gear = canonical in _PPE_GEAR_CLASSES

                detections.append(
                    Detection(
                        class_name=canonical,
                        confidence=conf,
                        bbox=bbox,
                        track_id=None,
                        is_ppe=is_gear,
                        model_source="ppe",
                    )
                )
        return detections

    def _parse_consolidated_results(
        self, results, *, with_tracking: bool = False
    ) -> list[Detection]:
        """Extract detections from a consolidated PPE run with tracking."""
        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                continue

            for i in range(len(boxes)):
                cls_id = int(boxes.cls[i].item())
                raw_name = self._ppe_model.names.get(cls_id, f"class_{cls_id}")
                canonical = _normalise_ppe_name(raw_name)
                conf = float(boxes.conf[i].item())
                x1, y1, x2, y2 = boxes.xyxy[i].tolist()
                bbox = (int(x1), int(y1), int(x2), int(y2))

                track_id: Optional[int] = None
                if with_tracking and boxes.id is not None:
                    track_id = int(boxes.id[i].item())

                is_gear = canonical in _PPE_GEAR_CLASSES
                appearance_embedding = self._extract_embedding(result, i) if not is_gear else None

                detections.append(
                    Detection(
                        class_name=canonical,
                        confidence=conf,
                        bbox=bbox,
                        track_id=track_id if not is_gear else None,
                        is_ppe=is_gear,
                        model_source="ppe" if is_gear else "coco",
                        appearance_embedding=appearance_embedding,
                    )
                )
        return detections

    def _parse_tool_results(self, results, *, with_tracking: bool = False) -> list[Detection]:
        """Extract tool detections from YOLOWorld results."""
        detections: list[Detection] = []
        for result in results:
            boxes = result.boxes
            if boxes is None or len(boxes) == 0:
                continue

            for i in range(len(boxes)):
                cls_id = int(boxes.cls[i].item())
                if cls_id < len(self._tool_classes):
                    raw_name = self._tool_classes[cls_id]
                else:
                    raw_name = "tool"

                canonical = _normalise_tool_name(raw_name)
                conf = float(boxes.conf[i].item())
                x1, y1, x2, y2 = boxes.xyxy[i].tolist()
                bbox = (int(x1), int(y1), int(x2), int(y2))

                track_id: Optional[int] = None
                if with_tracking and boxes.id is not None:
                    track_id = int(boxes.id[i].item())

                detections.append(
                    Detection(
                        class_name=canonical,
                        confidence=conf,
                        bbox=bbox,
                        track_id=track_id,
                        is_ppe=False,
                        model_source="tool",
                    )
                )
        return detections

    def warmup(self) -> None:
        """Run a single dummy inference to initialize CUDA context / kernels."""
        dummy = np.zeros((384, 640, 3), dtype=np.uint8)
        try:
            if self._general_model is not None:
                self._run_general(dummy)
            if self._ppe_model is not None and not self._ppe_model_is_roboflow:
                self._run_ppe(dummy)
            if self._tool_model is not None:
                self._tool_model.predict(
                    source=dummy,
                    device=self._device,
                    conf=self._tool_conf,
                    verbose=False,
                    half=self._is_cuda,
                )
            logger.info("✅ Detector models warmed up successfully on device '%s'", self._device)
        except Exception as e:
            logger.debug("Detector warmup exception (non-fatal): %s", e)

