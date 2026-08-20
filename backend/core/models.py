"""Shared data models for the Safety Copilot pipeline.

All pipeline modules import from here to ensure type consistency.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

try:
    import numpy as np
except Exception:  # pragma: no cover - allows lightweight imports before deps are installed
    class _NPStub:
        ndarray = object

    np = _NPStub()


# ── Enums ────────────────────────────────────────────────────

class Severity(str, Enum):
    """Alert severity tiers, from least to most urgent."""
    INFO = "info"
    WARNING = "warning"
    DANGER = "danger"
    CRITICAL = "critical"

    def __gt__(self, other: "Severity") -> bool:
        order = list(Severity)
        return order.index(self) > order.index(other)

    def __ge__(self, other: "Severity") -> bool:
        return self == other or self > other

    def escalate(self) -> "Severity":
        """Return the next severity tier, capping at CRITICAL."""
        order = list(Severity)
        idx = order.index(self)
        return order[min(idx + 1, len(order) - 1)]


class HazardState(str, Enum):
    """Lifecycle state of a tracked hazard instance."""
    DETECTED = "detected"
    PASSIVE = "passive"
    UNNOTICED = "unnoticed"
    ESCALATED = "escalated"
    ACKNOWLEDGED = "acknowledged"
    RESOLVED = "resolved"


class EventType(str, Enum):
    """Types of events logged to the database."""
    DETECTION = "detection"
    ESCALATION = "escalation"
    ACKNOWLEDGMENT = "acknowledgment"
    RESOLUTION = "resolution"
    FALL = "fall"
    PPE_VIOLATION = "ppe_violation"


# ── Detection ────────────────────────────────────────────────

@dataclass
class Detection:
    """A single object detection from a YOLO model."""
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]  # x1, y1, x2, y2
    track_id: Optional[int] = None
    is_ppe: bool = False
    model_source: str = "coco"  # "coco" or "ppe"
    appearance_embedding: Optional[list[float]] = None

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    @property
    def area(self) -> int:
        x1, y1, x2, y2 = self.bbox
        return max(0, x2 - x1) * max(0, y2 - y1)


# ── Pose ─────────────────────────────────────────────────────

# COCO keypoint indices
KEYPOINT_NOSE = 0
KEYPOINT_LEFT_EYE = 1
KEYPOINT_RIGHT_EYE = 2
KEYPOINT_LEFT_EAR = 3
KEYPOINT_RIGHT_EAR = 4
KEYPOINT_LEFT_SHOULDER = 5
KEYPOINT_RIGHT_SHOULDER = 6
KEYPOINT_LEFT_ELBOW = 7
KEYPOINT_RIGHT_ELBOW = 8
KEYPOINT_LEFT_WRIST = 9
KEYPOINT_RIGHT_WRIST = 10
KEYPOINT_LEFT_HIP = 11
KEYPOINT_RIGHT_HIP = 12
KEYPOINT_LEFT_KNEE = 13
KEYPOINT_RIGHT_KNEE = 14
KEYPOINT_LEFT_ANKLE = 15
KEYPOINT_RIGHT_ANKLE = 16


@dataclass
class PoseData:
    """Pose estimation results for a single detected person."""
    person_track_id: int
    keypoints: np.ndarray                       # (17, 3) — x, y, confidence per keypoint
    head_yaw: Optional[float] = None            # Estimated head facing angle in degrees
                                                #   0° = facing right, 90° = facing camera,
                                                #   180° = facing left
    body_angle: Optional[float] = None          # Torso angle from vertical (0° = upright,
                                                #   90° = horizontal)
    center_of_mass: Optional[tuple[float, float]] = None  # Average of hip+shoulder midpoints

    @property
    def is_valid(self) -> bool:
        """Check if enough keypoints are detected for analysis."""
        if self.keypoints is None or len(self.keypoints) < 17:
            return False
        # Need at least shoulders and hips with reasonable confidence
        min_conf = 0.3
        return (self.keypoints[KEYPOINT_LEFT_SHOULDER][2] > min_conf and
                self.keypoints[KEYPOINT_RIGHT_SHOULDER][2] > min_conf and
                self.keypoints[KEYPOINT_LEFT_HIP][2] > min_conf and
                self.keypoints[KEYPOINT_RIGHT_HIP][2] > min_conf)


# ── Tracking ─────────────────────────────────────────────────

@dataclass
class TrackedObject:
    """A persistently tracked object across frames."""
    track_id: int
    class_name: str
    bbox: tuple[int, int, int, int]
    position_history: list[tuple[float, float, float]] = field(default_factory=list)
    first_seen: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    is_active: bool = True
    appearance_embedding: Optional[list[float]] = None
    distance_meters: Optional[float] = None

    def update(
        self,
        bbox: tuple[int, int, int, int],
        timestamp: float,
        appearance_embedding: Optional[list[float]] = None,
    ) -> None:
        """Update the tracked object with a new observation."""
        self.bbox = bbox
        self.last_seen = timestamp
        if appearance_embedding is not None:
            self.appearance_embedding = appearance_embedding
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        self.position_history.append((cx, cy, timestamp))
        # Keep last 90 frames of history (~3 seconds at 30fps)
        if len(self.position_history) > 90:
            self.position_history = self.position_history[-90:]

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)

    @property
    def dwell_seconds(self) -> float:
        return self.last_seen - self.first_seen


# ── PPE ──────────────────────────────────────────────────────

@dataclass
class WorkerPPEState:
    """PPE compliance state for a tracked worker."""
    track_id: int
    has_hardhat: Optional[bool] = None
    has_vest: Optional[bool] = None
    has_harness: Optional[bool] = None  # Always None in Tier 1 — stub
    has_goggles: Optional[bool] = None
    has_gloves: Optional[bool] = None
    has_boots: Optional[bool] = None
    has_mask: Optional[bool] = None

    @property
    def is_compliant(self) -> bool:
        """True if all detected PPE items are present (unknowns count as OK)."""
        checks = [
            self.has_hardhat, 
            self.has_vest, 
            self.has_goggles, 
            self.has_gloves, 
            self.has_boots,
            self.has_mask
        ]
        return all(c is not False for c in checks)

    @property
    def missing_items(self) -> list[str]:
        """List of PPE items explicitly detected as missing."""
        missing = []
        if self.has_hardhat is False:
            missing.append("hard hat")
        if self.has_vest is False:
            missing.append("high-vis vest")
        if self.has_goggles is False:
            missing.append("safety goggles")
        if self.has_gloves is False:
            missing.append("safety gloves")
        if self.has_boots is False:
            missing.append("safety boots")
        if self.has_mask is False:
            missing.append("safety mask")
        return missing

    @property
    def worn_items(self) -> list[str]:
        """List of PPE items explicitly detected as worn."""
        worn = []
        if self.has_hardhat is True:
            worn.append("hard hat")
        if self.has_vest is True:
            worn.append("high-vis vest")
        if self.has_goggles is True:
            worn.append("safety goggles")
        if self.has_gloves is True:
            worn.append("safety gloves")
        if self.has_boots is True:
            worn.append("safety boots")
        if self.has_mask is True:
            worn.append("safety mask")
        return worn


# ── Zones ────────────────────────────────────────────────────

@dataclass
class DangerZone:
    """A user-defined danger zone in the camera view."""
    name: str
    zone_type: str  # "electrical", "trench", "machinery", "custom"
    polygon: list[tuple[int, int]]  # List of (x, y) vertices
    severity_base: Severity = Severity.WARNING
    metadata: dict = field(default_factory=dict)


# ── Hazard Assessment ────────────────────────────────────────

@dataclass
class HazardAssessment:
    """A scored hazard combining detection, zone, PPE, and attention state."""
    hazard_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    hazard_type: str = ""               # "zone_proximity", "fall", "ppe_compound",
                                        #  "vehicle_proximity"
    severity: Severity = Severity.INFO
    description: str = ""
    worker_track_id: Optional[int] = None
    hazard_bbox: Optional[tuple[int, int, int, int]] = None
    zone_name: Optional[str] = None
    ppe_modifier: bool = False          # Whether PPE state modified severity
    dwell_seconds: float = 0.0
    state: HazardState = HazardState.DETECTED
    is_acknowledged: bool = False
    is_escalated: bool = False
    first_seen: float = field(default_factory=time.time)
    last_gaze_check: float = 0.0
    distance_meters: Optional[float] = None


# ── Alerts ───────────────────────────────────────────────────

@dataclass
class Alert:
    """An alert to be spoken and/or displayed."""
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    severity: Severity = Severity.INFO
    message: str = ""                   # Display text
    tts_text: str = ""                  # Text-to-speech string (may differ from display)
    hazard_id: Optional[str] = None
    timestamp: float = field(default_factory=time.time)
    is_escalation: bool = False


# ── Frame Result ─────────────────────────────────────────────

@dataclass
class FrameResult:
    """Complete result for a single processed frame — passed through the pipeline."""
    frame_number: int = 0
    timestamp: float = field(default_factory=time.time)
    detections: list[Detection] = field(default_factory=list)
    poses: list[PoseData] = field(default_factory=list)
    tracked_objects: dict[int, TrackedObject] = field(default_factory=dict)
    worker_ppe_states: dict[int, WorkerPPEState] = field(default_factory=dict)
    hazards: list[HazardAssessment] = field(default_factory=list)
    alerts: list[Alert] = field(default_factory=list)
    active_zones: list[DangerZone] = field(default_factory=list)
    fps: float = 0.0
    depth_map: Optional[Any] = None
