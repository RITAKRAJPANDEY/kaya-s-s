"""SQLite schema definitions and row-conversion helpers for event logging.

All table definitions live here so the EventLogger can simply execute
``SCHEMA_SQL`` on startup.  Row converters turn dataclass instances into
flat dicts suitable for SQLite INSERT.
"""

from __future__ import annotations

import json
import time
from typing import Any

from core.models import Alert, HazardAssessment

# ── Schema ───────────────────────────────────────────────────

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS hazards (
    id              TEXT PRIMARY KEY,
    frame_number    INTEGER NOT NULL,
    timestamp       REAL    NOT NULL,
    hazard_type     TEXT    NOT NULL,
    severity        TEXT    NOT NULL,
    description     TEXT,
    worker_track_id INTEGER,
    hazard_bbox     TEXT,
    zone_name       TEXT,
    ppe_modifier    INTEGER NOT NULL DEFAULT 0,
    dwell_seconds   REAL    NOT NULL DEFAULT 0.0,
    state           TEXT    NOT NULL,
    is_acknowledged INTEGER NOT NULL DEFAULT 0,
    is_escalated    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY,
    frame_number    INTEGER NOT NULL,
    timestamp       REAL    NOT NULL,
    severity        TEXT    NOT NULL,
    message         TEXT    NOT NULL,
    tts_text        TEXT,
    hazard_id       TEXT,
    is_escalation   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (hazard_id) REFERENCES hazards(id)
);

CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type      TEXT    NOT NULL,
    frame_number    INTEGER NOT NULL,
    timestamp       REAL    NOT NULL,
    data            TEXT
);

CREATE TABLE IF NOT EXISTS reasoning_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    frame_number    INTEGER NOT NULL,
    timestamp       REAL    NOT NULL,
    event_kind      TEXT    NOT NULL,
    summary         TEXT    NOT NULL,
    confidence      REAL,
    worker_id       TEXT,
    zone_name       TEXT,
    hazard_type     TEXT,
    payload         TEXT
);

CREATE INDEX IF NOT EXISTS idx_hazards_frame ON hazards(frame_number);
CREATE INDEX IF NOT EXISTS idx_alerts_frame  ON alerts(frame_number);
CREATE INDEX IF NOT EXISTS idx_events_frame  ON events(frame_number);
CREATE INDEX IF NOT EXISTS idx_events_type   ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_reasoning_frame ON reasoning_events(frame_number);
CREATE INDEX IF NOT EXISTS idx_reasoning_kind  ON reasoning_events(event_kind);
"""


# ── Row converters ───────────────────────────────────────────

def hazard_to_row(hazard: HazardAssessment, frame_number: int) -> dict[str, Any]:
    """Convert a ``HazardAssessment`` to a flat dict for SQLite insertion."""
    return {
        "id": hazard.hazard_id,
        "frame_number": frame_number,
        "timestamp": time.time(),
        "hazard_type": hazard.hazard_type,
        "severity": hazard.severity.value,
        "description": hazard.description,
        "worker_track_id": hazard.worker_track_id,
        "hazard_bbox": json.dumps(hazard.hazard_bbox) if hazard.hazard_bbox else None,
        "zone_name": hazard.zone_name,
        "ppe_modifier": int(hazard.ppe_modifier),
        "dwell_seconds": hazard.dwell_seconds,
        "state": hazard.state.value,
        "is_acknowledged": int(hazard.is_acknowledged),
        "is_escalated": int(hazard.is_escalated),
    }


def alert_to_row(alert: Alert, frame_number: int) -> dict[str, Any]:
    """Convert an ``Alert`` to a flat dict for SQLite insertion."""
    return {
        "id": alert.id,
        "frame_number": frame_number,
        "timestamp": alert.timestamp,
        "severity": alert.severity.value,
        "message": alert.message,
        "tts_text": alert.tts_text,
        "hazard_id": alert.hazard_id,
        "is_escalation": int(alert.is_escalation),
    }
