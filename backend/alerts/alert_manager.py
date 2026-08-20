"""Alert orchestration — decides which hazards deserve spoken/visual alerts.

Converts HazardAssessments into Alerts, deduplicates within a cooldown
window, and dispatches to the TTS engine.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

from core.models import (
    Alert,
    HazardAssessment,
    HazardState,
    Severity,
    WorkerPPEState,
)

logger = logging.getLogger(__name__)

# ── Message templates ────────────────────────────────────────
# Keyed by (hazard_type, severity).  Falls back to a generic message.

_MESSAGE_TEMPLATES: dict[tuple[str, Severity], str] = {
    # Zone proximity
    ("zone_proximity", Severity.INFO): "Worker near {zone}.",
    ("zone_proximity", Severity.WARNING): "Caution: worker entering {zone}.",
    ("zone_proximity", Severity.DANGER): "Warning! Worker in danger zone: {zone}.",
    ("zone_proximity", Severity.CRITICAL): "CRITICAL! Worker inside {zone}! Evacuate immediately!",
    # Fall
    ("fall", Severity.WARNING): "Possible fall detected.",
    ("fall", Severity.DANGER): "Worker down! Possible fall detected!",
    ("fall", Severity.CRITICAL): "CRITICAL! Worker has fallen! Immediate assistance required!",
    # Vehicle proximity
    ("vehicle_proximity", Severity.WARNING): "Vehicle approaching worker.",
    ("vehicle_proximity", Severity.DANGER): "Warning! Vehicle very close to worker!",
    ("vehicle_proximity", Severity.CRITICAL): "CRITICAL! Vehicle collision risk! Move away NOW!",
    ("ppe_compound", Severity.WARNING): "PPE violation detected.",
    ("ppe_compound", Severity.DANGER): "Warning! PPE missing in hazardous area!",
    ("ppe_compound", Severity.CRITICAL): "CRITICAL! No PPE in high-risk zone!",
    # Egocentric Vehicle
    ("vehicle_proximity_egocentric", Severity.WARNING): "Vehicle approaching {direction}.",
    ("vehicle_proximity_egocentric", Severity.DANGER): "Warning! Vehicle approaching closely {direction}!",
    ("vehicle_proximity_egocentric", Severity.CRITICAL): "CRITICAL! Vehicle collision risk {direction}! Move away NOW!",
}

_ESCALATION_PREFIX = "ESCALATED — "


class AlertManager:
    """Orchestrates alert generation, dedup, and TTS dispatch.

    Parameters
    ----------
    tts_engine:
        A ``TTSEngine`` instance (or any object with ``speak(text, severity)``).
    enabled:
        Master switch — when ``False``, no alerts are generated.
    cooldown_seconds:
        Minimum interval between alerts for the *same* hazard_id.
    """

    def __init__(
        self,
        tts_engine,
        enabled: bool = True,
        cooldown_seconds: float = 5.0,
        perspective: str = "third_person",
        resolution: tuple[int, int] = (1280, 720),
    ) -> None:
        self.tts_engine = tts_engine
        self.enabled = enabled
        self.cooldown_seconds = cooldown_seconds
        self.perspective = perspective
        self.resolution = resolution

        # hazard_id → last alert timestamp
        self._last_alert_time: dict[str, float] = {}

        # Global speech throttling & prioritization state
        self._last_speech_time = 0.0
        self._last_speech_severity = Severity.INFO
        self._speech_buffer_seconds = 3.5  # Buffer between consecutive spoken alerts

        # Track hazard IDs that have already spoken their post-acknowledgment alert
        self._ack_spoken_ids: set[str] = set()

    # ── Public API ──────────────────────────────────────────

    def process_hazards(
        self,
        hazards: list[HazardAssessment],
        worker_ppe: dict[int, WorkerPPEState],
    ) -> list[Alert]:
        """Generate alerts for hazards that need attention.

        Only UNNOTICED, ESCALATED, and ``fall``-type hazards trigger alerts.
        PASSIVE and ACKNOWLEDGED hazards are silently skipped.

        Parameters
        ----------
        hazards:
            Current-frame hazard assessments from the processor.
        worker_ppe:
            Mapping of track_id → WorkerPPEState for context augmentation.

        Returns
        -------
        list[Alert]
            Newly generated alerts (spoken alert is prioritized and throttled).
        """
        if not self.enabled:
            return []

        now = time.time()
        new_alerts: list[Alert] = []

        # Clean up stale IDs from acknowledgment memory
        active_ids = {h.hazard_id for h in hazards}
        self._ack_spoken_ids = {hid for hid in self._ack_spoken_ids if hid in active_ids}

        # Find all hazards that warrant an alert in the current frame
        pending_hazards = [h for h in hazards if self._should_alert(h, now)]
        if not pending_hazards:
            return []

        # Sort pending hazards by severity descending (CRITICAL > DANGER > WARNING > INFO)
        pending_hazards.sort(key=lambda h: h.severity, reverse=True)

        # 1. Process the highest priority hazard for speech
        speech_hazard = pending_hazards[0]
        should_speak = False

        time_since_speech = now - self._last_speech_time
        if time_since_speech >= self._speech_buffer_seconds:
            # Buffer cleared — we can speak
            should_speak = True
        else:
            # Buffer active (currently speaking) — only speak if new alert is HIGHER priority
            if speech_hazard.severity > self._last_speech_severity:
                should_speak = True
                logger.info(
                    "Interrupting alert (severity %s > %s)",
                    speech_hazard.severity.value,
                    self._last_speech_severity.value
                )
                self.tts_engine.stop()  # Interrupt the active speech

        # 2. Build and register alerts
        for hazard in pending_hazards:
            message = self._build_message(hazard, worker_ppe)
            tts_text = self._build_tts_text(hazard, message, worker_ppe)

            alert = Alert(
                severity=hazard.severity,
                message=message,
                tts_text=tts_text,
                hazard_id=hazard.hazard_id,
                is_escalation=hazard.is_escalated,
            )

            # Only speak the single highest-priority hazard if determined above
            if hazard == speech_hazard and should_speak:
                self.tts_engine.speak(tts_text, hazard.severity)
                self._last_speech_time = now
                self._last_speech_severity = hazard.severity
                self._last_alert_time[hazard.hazard_id] = now
                
                # Mark as spoken if it is in an acknowledged state
                if hazard.state == HazardState.ACKNOWLEDGED or hazard.is_acknowledged:
                    self._ack_spoken_ids.add(hazard.hazard_id)
                
                logger.info(
                    "Alert Spoken [%s] hazard=%s: %s",
                    hazard.severity.value,
                    hazard.hazard_id,
                    message,
                )
            else:
                # Visual-only alert — do NOT stamp cooldown so this hazard
                # can still get its speech window on the next cycle.
                logger.debug(
                    "Alert Visual-Only [%s] hazard=%s: %s",
                    hazard.severity.value,
                    hazard.hazard_id,
                    message,
                )

            new_alerts.append(alert)

        return new_alerts

    def silence(self) -> None:
        """Stop all in-progress alerts and TTS playback."""
        self.tts_engine.stop()
        logger.info("AlertManager: silenced all alerts")

    # ── Internal helpers ────────────────────────────────────

    def _should_alert(self, hazard: HazardAssessment, now: float) -> bool:
        """Return True if this hazard warrants a new alert right now."""
        # Always alert on falls regardless of state
        if hazard.hazard_type == "fall":
            return self._cooldown_ok(hazard.hazard_id, now)

        # Gaze Acknowledgment alert routing
        if hazard.state == HazardState.ACKNOWLEDGED or hazard.is_acknowledged:
            if hazard.hazard_id in self._ack_spoken_ids:
                return False
            # Allow to speak exactly once post-acknowledgment
            return self._cooldown_ok(hazard.hazard_id, now)

        # Reset acknowledgment spoken memory if it is no longer acknowledged
        if hazard.hazard_id in self._ack_spoken_ids:
            self._ack_spoken_ids.remove(hazard.hazard_id)

        # Emergency Bypass: For DANGER/CRITICAL, alert before dwell threshold
        # expires (skip the UNNOTICED/ESCALATED state requirement), but STILL
        # respect acknowledgment (handled above).
        if hazard.severity in (Severity.DANGER, Severity.CRITICAL):
            return self._cooldown_ok(hazard.hazard_id, now)

        # For lower severities, only alert on actionable attention states
        if hazard.state not in (HazardState.UNNOTICED, HazardState.ESCALATED):
            return False

        return self._cooldown_ok(hazard.hazard_id, now)

    def _cooldown_ok(self, hazard_id: str, now: float) -> bool:
        """Check whether enough time has passed since the last alert for this ID."""
        last = self._last_alert_time.get(hazard_id)
        if last is None:
            return True
        return (now - last) >= self.cooldown_seconds

    def _build_message(
        self,
        hazard: HazardAssessment,
        worker_ppe: dict[int, WorkerPPEState],
    ) -> str:
        """Build the display message for an alert."""
        key = (hazard.hazard_type, hazard.severity)
        template = _MESSAGE_TEMPLATES.get(key)

        if template:
            direction = ""
            if "egocentric" in hazard.hazard_type and hazard.hazard_bbox:
                hx1, _, hx2, _ = hazard.hazard_bbox
                frame_w = self.resolution[0]
                cx = (hx1 + hx2) / 2
                if cx < frame_w * 0.4:
                    direction = "on your left"
                elif cx > frame_w * 0.6:
                    direction = "on your right"
                else:
                    direction = "ahead"

            message = template.format(zone=hazard.zone_name or "restricted area", direction=direction)
            if hazard.distance_meters is not None:
                message += f" {hazard.distance_meters:.1f} meters away"
        else:
            # Generic fallback
            message = f"{hazard.severity.value.upper()}: {hazard.description}"

        # Escalation prefix
        if hazard.is_escalated:
            message = _ESCALATION_PREFIX + message

        # PPE context
        if hazard.ppe_modifier and hazard.worker_track_id is not None:
            ppe_state = worker_ppe.get(hazard.worker_track_id)
            if ppe_state and ppe_state.missing_items:
                missing = ", ".join(ppe_state.missing_items)
                message += f" Missing PPE: {missing}."

        return message

    def _build_tts_text(
        self,
        hazard: HazardAssessment,
        display_message: str,
        worker_ppe: dict[int, WorkerPPEState],
    ) -> str:
        """Build the TTS-specific text (may simplify for clarity)."""
        # For now, TTS matches display.  Future: abbreviate zone names, etc.
        return display_message
