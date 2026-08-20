"""Danger zone management — define, persist, and query spatial danger zones.

Zones are user-defined polygonal regions in camera space (e.g. electrical panels,
trench edges, heavy-machinery corridors). ZoneManager loads them from config or
JSON and answers overlap queries used by the HazardAnalyzer.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import cv2
import numpy as np

from core.models import DangerZone, Severity

logger = logging.getLogger(__name__)


class ZoneManager:
    """Manage a collection of :class:`DangerZone` instances."""

    # ── lifecycle ────────────────────────────────────────────
    def __init__(self) -> None:
        self._zones: list[DangerZone] = []

    # ── loading / saving ─────────────────────────────────────
    def load_from_config(self, zones_config: list[dict]) -> None:
        """Populate zones from the ``danger_zones`` list in *config.yaml*.

        Each dict is expected to contain at minimum ``name``, ``zone_type``,
        and ``polygon`` (list of ``[x, y]`` pairs). Optional keys:
        ``severity_base`` (str matching :class:`Severity` values) and
        ``metadata`` (arbitrary dict).
        """
        self._zones.clear()
        for entry in zones_config:
            severity = Severity(entry.get("severity_base", "warning"))
            polygon = [tuple(pt) for pt in entry["polygon"]]
            zone = DangerZone(
                name=entry["name"],
                zone_type=entry.get("zone_type", "custom"),
                polygon=polygon,
                severity_base=severity,
                metadata=entry.get("metadata", {}),
            )
            self._zones.append(zone)
        logger.info("Loaded %d zones from config", len(self._zones))

    def load_from_file(self, path: str) -> None:
        """Load zones from a JSON file on disk."""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        self.load_from_config(data if isinstance(data, list) else data.get("zones", []))

    def save_to_file(self, path: str) -> None:
        """Persist the current zone list as JSON."""
        payload = []
        for z in self._zones:
            payload.append({
                "name": z.name,
                "zone_type": z.zone_type,
                "polygon": [list(pt) for pt in z.polygon],
                "severity_base": z.severity_base.value,
                "metadata": z.metadata,
            })
        Path(path).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        logger.info("Saved %d zones to %s", len(payload), path)

    # ── mutators ─────────────────────────────────────────────
    def add_zone(self, zone: DangerZone) -> None:
        """Append a zone (no duplicate-name check — caller's responsibility)."""
        self._zones.append(zone)

    def remove_zone(self, name: str) -> None:
        """Remove the first zone whose name matches *name*."""
        self._zones = [z for z in self._zones if z.name != name]

    # ── queries ──────────────────────────────────────────────
    def check_overlap(self, bbox: tuple[int, int, int, int]) -> list[DangerZone]:
        """Return every zone whose polygon overlaps with *bbox*.

        Overlap is determined by checking whether the bbox **center** or any
        of its four **corners** lie inside the polygon (via
        ``cv2.pointPolygonTest``).
        """
        x1, y1, x2, y2 = bbox
        center = ((x1 + x2) / 2, (y1 + y2) / 2)
        corners = [
            (float(x1), float(y1)),
            (float(x2), float(y1)),
            (float(x2), float(y2)),
            (float(x1), float(y2)),
        ]
        test_points = [center] + corners

        overlapping: list[DangerZone] = []
        for zone in self._zones:
            contour = np.array(zone.polygon, dtype=np.float32).reshape((-1, 1, 2))
            for pt in test_points:
                # pointPolygonTest returns positive when point is inside
                if cv2.pointPolygonTest(contour, pt, measureDist=False) >= 0:
                    overlapping.append(zone)
                    break  # one hit is enough for this zone

        return overlapping

    def get_all_zones(self) -> list[DangerZone]:
        """Return a shallow copy of the zone list."""
        return list(self._zones)
