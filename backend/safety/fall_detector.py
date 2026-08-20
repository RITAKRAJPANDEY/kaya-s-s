"""Pose-based fall detection with a per-worker state machine.

Uses body angle and vertical velocity of the center of mass to detect falls
through a multi-frame confirmation pipeline, preventing single-frame
false positives.

State machine per tracked worker::

    STANDING ──(angle > threshold AND velocity > threshold)──▶ MAYBE_FALLING
    MAYBE_FALLING ──(confirmed for N frames)──▶ FALLEN
    MAYBE_FALLING ──(angle recovered)──▶ STANDING
    FALLEN ──(alert emitted)──▶ ALERTED
    ALERTED ──(cooldown expired)──▶ STANDING   (can re-trigger)
"""

from __future__ import annotations

import logging
import time
from collections import deque
from enum import Enum, auto

from core.models import HazardAssessment, HazardState, PoseData, Severity

logger = logging.getLogger(__name__)


class _FallState(Enum):
    STANDING = auto()
    MAYBE_FALLING = auto()
    FALLEN = auto()
    ALERTED = auto()


class FallDetector:
    """Detect falls from :class:`PoseData` sequences.

    Parameters
    ----------
    body_angle_threshold:
        Body-angle (degrees from vertical) above which a person is
        considered to be in an abnormal posture.  Default **30°**.
    velocity_threshold:
        Minimum downward velocity (px / s) of the center-of-mass to
        trigger fall suspicion.  Default **15 px/s**.
    confirmation_frames:
        Number of consecutive *suspicious* frames required before
        transitioning from ``MAYBE_FALLING`` to ``FALLEN``.  Default **2**.
    cooldown_seconds:
        After an alert fires, minimum seconds before the same track_id
        can trigger again.  Default **15 s**.
    """

    def __init__(
        self,
        body_angle_threshold: float = 30.0,
        velocity_threshold: float = 15.0,
        confirmation_frames: int = 2,
        cooldown_seconds: float = 15.0,
    ) -> None:
        self.body_angle_threshold = body_angle_threshold
        self.velocity_threshold = velocity_threshold
        self.confirmation_frames = confirmation_frames
        self.cooldown_seconds = cooldown_seconds

        # track_id → internal state dict
        self._tracks: dict[int, dict] = {}

    # ── public API ───────────────────────────────────────────
    def update(
        self,
        poses: list[PoseData],
        timestamp: float,
    ) -> list[HazardAssessment]:
        """Process a frame's worth of poses and return new fall hazards.

        Parameters
        ----------
        poses:
            All :class:`PoseData` objects for the current frame.
        timestamp:
            Current frame timestamp (seconds, monotonic preferred).

        Returns
        -------
        list[HazardAssessment]
            Newly generated fall-hazard assessments (only emitted once
            per fall event, until cooldown resets the worker's state).
        """
        seen_ids: set[int] = set()
        hazards: list[HazardAssessment] = []

        for pose in poses:
            tid = pose.person_track_id
            seen_ids.add(tid)

            # Skip poses without the data we need
            if pose.body_angle is None or pose.center_of_mass is None:
                continue

            # Lazy-init tracker for this person
            if tid not in self._tracks:
                self._tracks[tid] = {
                    "state": _FallState.STANDING,
                    "counter": 0,
                    "last_alert_time": 0.0,
                    "com_history": deque(maxlen=10),
                    "last_seen": timestamp,
                }

            trk = self._tracks[tid]
            trk["last_seen"] = timestamp
            trk["com_history"].append((pose.center_of_mass, timestamp))

            # ── Compute vertical velocity ────────────────────
            vy = self._vertical_velocity(trk["com_history"])

            # ── Evaluate trigger condition ───────────────────
            is_suspicious = (
                pose.body_angle > self.body_angle_threshold
                and vy > self.velocity_threshold
            )

            state = trk["state"]

            if state == _FallState.STANDING:
                if is_suspicious:
                    trk["state"] = _FallState.MAYBE_FALLING
                    trk["counter"] = 1

            elif state == _FallState.MAYBE_FALLING:
                if is_suspicious:
                    trk["counter"] += 1
                    if trk["counter"] >= self.confirmation_frames:
                        trk["state"] = _FallState.FALLEN
                else:
                    # Recovered — reset
                    trk["state"] = _FallState.STANDING
                    trk["counter"] = 0

            elif state == _FallState.FALLEN:
                # Emit hazard and transition to ALERTED
                hazard = HazardAssessment(
                    hazard_id=f"fall_{tid}",
                    hazard_type="fall",
                    severity=Severity.CRITICAL,
                    description=f"Fall detected for worker #{tid}",
                    worker_track_id=tid,
                    state=HazardState.DETECTED,
                    first_seen=timestamp,
                )
                hazards.append(hazard)
                trk["state"] = _FallState.ALERTED
                trk["last_alert_time"] = timestamp
                logger.warning("Fall detected – track_id=%d", tid)

            elif state == _FallState.ALERTED:
                # Continue emitting the fall hazard so it persists in the
                # hazard list (alert_manager cooldown prevents TTS spam).
                if timestamp - trk["last_alert_time"] < self.cooldown_seconds:
                    hazard = HazardAssessment(
                        hazard_id=f"fall_{tid}",
                        hazard_type="fall",
                        severity=Severity.CRITICAL,
                        description=f"Fall detected for worker #{tid}",
                        worker_track_id=tid,
                        state=HazardState.DETECTED,
                        first_seen=trk["last_alert_time"],
                    )
                    hazards.append(hazard)
                else:
                    # After cooldown, allow re-triggering
                    trk["state"] = _FallState.STANDING
                    trk["counter"] = 0

        # ── Cleanup stale tracks ─────────────────────────────
        stale = [
            tid for tid, trk in self._tracks.items()
            if tid not in seen_ids and (timestamp - trk["last_seen"]) > 5.0
        ]
        for tid in stale:
            del self._tracks[tid]

        return hazards

    # ── helpers ──────────────────────────────────────────────
    @staticmethod
    def _vertical_velocity(com_history: deque) -> float:
        """Compute downward velocity (px/s) from recent center-of-mass samples.

        Positive = downward movement (y increases in image space).
        """
        if len(com_history) < 2:
            return 0.0

        (_, y_old), t_old = com_history[0]
        (_, y_new), t_new = com_history[-1]
        dt = t_new - t_old
        if dt <= 0:
            return 0.0

        return max(0.0, (y_new - y_old) / dt)
