"""Thread-safe SQLite event logger for the Safety Copilot pipeline.

Persists hazards, alerts, and generic events to a local SQLite database
so they can be reviewed after a session or streamed to a dashboard.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

from core.models import Alert, HazardAssessment
from logging_.schemas import SCHEMA_SQL, alert_to_row, hazard_to_row

logger = logging.getLogger(__name__)


class EventLogger:
    """Append-only SQLite logger — one instance per session.

    Parameters
    ----------
    db_path:
        Path to the SQLite file.  Parent directories are created automatically.
    """

    def __init__(self, db_path: str = "data/events.db") -> None:
        self._db_path = Path(db_path)
        self._lock = threading.Lock()

        # Ensure parent directory exists.
        self._db_path.parent.mkdir(parents=True, exist_ok=True)

        # Connect and initialise schema.
        self._conn = sqlite3.connect(str(self._db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")  # Better concurrent reads
        self._conn.executescript(SCHEMA_SQL)
        self._conn.commit()
        logger.info("EventLogger: database ready at %s", self._db_path)

    # ── Typed log helpers ───────────────────────────────────

    def log_hazard(self, hazard: HazardAssessment, frame_number: int) -> None:
        """Insert or replace a hazard row."""
        row = hazard_to_row(hazard, frame_number)
        cols = ", ".join(row.keys())
        placeholders = ", ".join(f":{k}" for k in row.keys())
        sql = f"INSERT OR REPLACE INTO hazards ({cols}) VALUES ({placeholders})"
        with self._lock:
            self._conn.execute(sql, row)
            self._conn.commit()

    def log_alert(self, alert: Alert, frame_number: int) -> None:
        """Insert an alert row."""
        row = alert_to_row(alert, frame_number)
        cols = ", ".join(row.keys())
        placeholders = ", ".join(f":{k}" for k in row.keys())
        sql = f"INSERT OR REPLACE INTO alerts ({cols}) VALUES ({placeholders})"
        with self._lock:
            self._conn.execute(sql, row)
            self._conn.commit()

    # ── Generic event log ───────────────────────────────────

    def log_event(
        self,
        event_type: str,
        frame_number: int,
        **kwargs: Any,
    ) -> None:
        """Log a generic event with arbitrary JSON payload.

        Parameters
        ----------
        event_type:
            A string tag (e.g. ``"detection"``, ``"fall"``).
        frame_number:
            The video frame this event corresponds to.
        **kwargs:
            Arbitrary key-value pairs serialised as JSON in the ``data`` column.
        """
        data_json = json.dumps(kwargs) if kwargs else None
        sql = (
            "INSERT INTO events (event_type, frame_number, timestamp, data) "
            "VALUES (:event_type, :frame_number, :timestamp, :data)"
        )
        with self._lock:
            self._conn.execute(
                sql,
                {
                    "event_type": event_type,
                    "frame_number": frame_number,
                    "timestamp": time.time(),
                    "data": data_json,
                },
            )
            self._conn.commit()

    # ── Query ───────────────────────────────────────────────

    def get_recent_events(self, limit: int = 100) -> list[dict[str, Any]]:
        """Return the most recent generic events as dicts.

        Parameters
        ----------
        limit:
            Maximum rows to return, ordered newest-first.
        """
        sql = "SELECT * FROM events ORDER BY timestamp DESC LIMIT :limit"
        with self._lock:
            rows = self._conn.execute(sql, {"limit": limit}).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            d = dict(row)
            if d.get("data"):
                try:
                    d["data"] = json.loads(d["data"])
                except json.JSONDecodeError:
                    pass
            results.append(d)
        return results

    def log_reasoning_event(
        self,
        frame_number: int,
        event_kind: str,
        summary: str,
        confidence: Optional[float] = None,
        worker_id: Optional[str] = None,
        zone_name: Optional[str] = None,
        hazard_type: Optional[str] = None,
        payload: Optional[dict[str, Any]] = None,
    ) -> None:
        """Log a structured Tier 2 reasoning event."""
        sql = (
            "INSERT INTO reasoning_events "
            "(frame_number, timestamp, event_kind, summary, confidence, worker_id, zone_name, hazard_type, payload) "
            "VALUES (:frame_number, :timestamp, :event_kind, :summary, :confidence, :worker_id, :zone_name, :hazard_type, :payload)"
        )
        with self._lock:
            self._conn.execute(
                sql,
                {
                    "frame_number": frame_number,
                    "timestamp": time.time(),
                    "event_kind": event_kind,
                    "summary": summary,
                    "confidence": confidence,
                    "worker_id": worker_id,
                    "zone_name": zone_name,
                    "hazard_type": hazard_type,
                    "payload": json.dumps(payload) if payload else None,
                },
            )
            self._conn.commit()

    def get_recent_reasoning_events(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return recent Tier 2 reasoning events."""
        sql = "SELECT * FROM reasoning_events ORDER BY timestamp DESC LIMIT :limit"
        with self._lock:
            rows = self._conn.execute(sql, {"limit": limit}).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            if item.get("payload"):
                try:
                    item["payload"] = json.loads(item["payload"])
                except json.JSONDecodeError:
                    pass
            results.append(item)
        return results

    # ── Lifecycle ───────────────────────────────────────────

    def close(self) -> None:
        """Flush and close the database connection."""
        with self._lock:
            self._conn.close()
        logger.info("EventLogger: closed database at %s", self._db_path)
