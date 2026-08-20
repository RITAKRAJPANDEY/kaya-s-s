"""Gaze-aware attention tracker — the novel piece.

Tracks whether workers have *noticed* nearby hazards by estimating their
gaze direction from head-yaw pose data.  Hazards that remain unnoticed
for a configurable dwell time are escalated, creating a human-in-the-loop
awareness feedback channel.

Lifecycle per hazard::

    PASSIVE ──(worker looks toward hazard for ack_gaze_duration)──▶ ACKNOWLEDGED
    PASSIVE ──(dwell > threshold, no gaze)──▶ UNNOTICED
    UNNOTICED ──(escalation cooldown expired)──▶ ESCALATED
    any ──(hazard removed from incoming list for > 5 s)──▶ RESOLVED
"""

from __future__ import annotations

import logging
import math
from typing import Optional

from core.models import (
    HazardAssessment,
    HazardState,
    PoseData,
    Severity,
    TrackedObject,
)

logger = logging.getLogger(__name__)


class AttentionTracker:
    """Gaze-based dwell-time escalation for tracked hazards.

    Parameters
    ----------
    dwell_threshold:
        Seconds a hazard must persist without acknowledgment before it
        transitions to ``UNNOTICED``.  Default **4.0 s**.
    gaze_angle_tolerance:
        Half-angle tolerance (degrees) when comparing head yaw to the
        bearing toward the hazard.  Default **45°**.
    escalation_cooldown:
        Minimum seconds between successive escalations for the same
        hazard.  Default **10.0 s**.
    ack_gaze_duration:
        Continuous seconds a worker must look toward a hazard for it to
        count as acknowledged.  Default **0.5 s**.
    """

    def __init__(
        self,
        dwell_threshold: float = 4.0,
        gaze_angle_tolerance: float = 45.0,
        escalation_cooldown: float = 10.0,
        ack_gaze_duration: float = 0.5,
        perspective: str = "third_person",
        resolution: tuple[int, int] = (1280, 720),
    ) -> None:
        self.dwell_threshold = dwell_threshold
        self.gaze_angle_tolerance = gaze_angle_tolerance
        self.escalation_cooldown = escalation_cooldown
        self.ack_gaze_duration = ack_gaze_duration
        self.perspective = perspective
        self.resolution = resolution

        # hazard_id → internal tracking dict
        self._state: dict[str, dict] = {}

    # ── public API ───────────────────────────────────────────
    def update(
        self,
        hazards: list[HazardAssessment],
        poses: list[PoseData],
        tracked_objects: dict[int, TrackedObject],
        timestamp: float,
    ) -> list[HazardAssessment]:
        """Update attention state for every incoming hazard.

        Parameters
        ----------
        hazards:
            Current-frame hazard list (from :class:`HazardAnalyzer`).
        poses:
            Current-frame :class:`PoseData` list.
        tracked_objects:
            Mapping ``track_id → TrackedObject`` for all visible objects.
        timestamp:
            Current frame timestamp (seconds).

        Returns
        -------
        list[HazardAssessment]
            All *active* hazards with their ``state``, ``dwell_seconds``,
            and acknowledgment flags updated.
        """
        # Build quick pose lookup: track_id → PoseData
        pose_by_id: dict[int, PoseData] = {p.person_track_id: p for p in poses}

        incoming_ids: set[str] = {h.hazard_id for h in hazards}

        # ── Process incoming hazards ─────────────────────────
        for hazard in hazards:
            hid = hazard.hazard_id

            if hid not in self._state:
                # New hazard — register
                self._state[hid] = {
                    "hazard": hazard,
                    "first_seen": timestamp,
                    "gaze_start_time": None,
                    "last_escalation_time": 0.0,
                    "last_incoming": timestamp,
                    "base_severity": hazard.severity,  # remember original for escalation guard
                }
                hazard.state = HazardState.PASSIVE
                hazard.first_seen = timestamp
            else:
                # Existing hazard — carry forward persisted state to the fresh object
                old_hazard = self._state[hid]["hazard"]
                hazard.state = old_hazard.state
                hazard.is_acknowledged = old_hazard.is_acknowledged
                hazard.is_escalated = old_hazard.is_escalated
                hazard.severity = old_hazard.severity
                hazard.first_seen = self._state[hid]["first_seen"]
                self._state[hid]["hazard"] = hazard
                self._state[hid]["last_incoming"] = timestamp

            entry = self._state[hid]

            # ── Dwell time ───────────────────────────────────
            hazard.dwell_seconds = timestamp - entry["first_seen"]

            # Already acknowledged — skip further checks
            if hazard.state == HazardState.ACKNOWLEDGED:
                continue

            # ── Gaze check ───────────────────────────────────
            looking = self._check_gaze(hazard, pose_by_id, tracked_objects)

            if looking:
                if entry["gaze_start_time"] is None:
                    entry["gaze_start_time"] = timestamp

                gaze_duration = timestamp - entry["gaze_start_time"]
                if gaze_duration >= self.ack_gaze_duration:
                    hazard.state = HazardState.ACKNOWLEDGED
                    hazard.is_acknowledged = True
                    hazard.last_gaze_check = timestamp
                    logger.info("Hazard %s acknowledged by worker gaze", hid)
                    continue
            else:
                entry["gaze_start_time"] = None

            # ── Dwell escalation ─────────────────────────────
            if hazard.dwell_seconds > self.dwell_threshold:
                if hazard.state in (HazardState.PASSIVE, HazardState.DETECTED):
                    hazard.state = HazardState.UNNOTICED
                    logger.info(
                        "Hazard %s UNNOTICED (%.1fs dwell)", hid, hazard.dwell_seconds
                    )

                if hazard.state == HazardState.UNNOTICED:
                    time_since = timestamp - entry["last_escalation_time"]
                    if time_since >= self.escalation_cooldown:
                        # Guard: only escalate if not already at max severity
                        base = entry.get("base_severity", Severity.INFO)
                        max_allowed = base.escalate()  # at most one tier above base
                        if hazard.severity < max_allowed:
                            hazard.severity = hazard.severity.escalate()
                        hazard.state = HazardState.ESCALATED
                        hazard.is_escalated = True
                        entry["last_escalation_time"] = timestamp
                        logger.warning(
                            "Hazard %s ESCALATED → %s", hid, hazard.severity.value
                        )

        # ── Resolve vanished hazards ─────────────────────────
        to_remove: list[str] = []
        for hid, entry in self._state.items():
            if hid not in incoming_ids:
                age = timestamp - entry["last_incoming"]
                if age > 5.0:
                    entry["hazard"].state = HazardState.RESOLVED
                    to_remove.append(hid)

        for hid in to_remove:
            del self._state[hid]

        # ── Build output ─────────────────────────────────────
        # Only return hazards active in the current frame to prevent drawing stale boxes
        return [entry["hazard"] for hid, entry in self._state.items() if hid in incoming_ids]

    # ── helpers ──────────────────────────────────────────────
    def _check_gaze(
        self,
        hazard: HazardAssessment,
        pose_by_id: dict[int, PoseData],
        tracked_objects: dict[int, TrackedObject],
    ) -> bool:
        """Return True if the worker associated with *hazard* is looking
        toward the hazard location (or if the hazard is centered in egocentric mode)."""
        
        # Hazard position — use bbox center if available, else bail
        if hazard.hazard_bbox is not None:
            hx1, hy1, hx2, hy2 = hazard.hazard_bbox
            hazard_pt = ((hx1 + hx2) / 2, (hy1 + hy2) / 2)
        elif hazard.zone_name is not None:
            # Fallback: can't determine hazard position from zone name alone
            return False
        else:
            return False

        if self.perspective == "egocentric":
            # In egocentric mode, the camera is the gaze.
            # Tightened to middle 20% of the screen to avoid instant acknowledgment
            # of everything in the forward view.
            frame_w = self.resolution[0]
            cx = hazard_pt[0]
            return (frame_w * 0.4) < cx < (frame_w * 0.6)

        # ── Third-person mode ─────────────────────────────
        if hazard.worker_track_id is None:
            return False

        pose = pose_by_id.get(hazard.worker_track_id)
        if pose is None or pose.head_yaw is None:
            return False

        # Worker position
        worker_obj = tracked_objects.get(hazard.worker_track_id)
        if worker_obj is None:
            return False

        worker_pt = worker_obj.center

        bearing = self._compute_bearing(worker_pt, hazard_pt)
        return self._is_looking_toward(pose.head_yaw, bearing, self.gaze_angle_tolerance)

    @staticmethod
    def _compute_bearing(
        from_pt: tuple[float, float],
        to_pt: tuple[float, float],
    ) -> float:
        """Compute the compass bearing (0–360°) from *from_pt* to *to_pt*.

        0° = right (+x), 90° = down (+y) in image coordinates.
        """
        dx = to_pt[0] - from_pt[0]
        dy = to_pt[1] - from_pt[1]
        angle_deg = math.degrees(math.atan2(dy, dx))
        return angle_deg % 360

    @staticmethod
    def _is_looking_toward(
        head_yaw: float,
        bearing: float,
        tolerance: float,
    ) -> bool:
        """Return True if *head_yaw* is within *tolerance* degrees of
        *bearing*, accounting for wraparound at 0° / 360°.
        """
        diff = abs(head_yaw - bearing)
        if diff > 180:
            diff = 360 - diff
        return diff <= tolerance
