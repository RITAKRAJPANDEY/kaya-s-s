"""Central hazard analysis — fuses PPE, fall, zone, and vehicle signals.

``HazardAnalyzer`` is the single entry-point called once per frame by the
pipeline.  It delegates to :class:`PPEChecker`, :class:`FallDetector`, and
:class:`ZoneManager`, then layers on vehicle-proximity and PPE-severity
modulation before returning the combined hazard list.
"""

from __future__ import annotations

import logging
import math
from typing import Optional

import cv2
import numpy as np

from core.models import (
    DangerZone,
    Detection,
    HazardAssessment,
    HazardState,
    PoseData,
    Severity,
    TrackedObject,
    WorkerPPEState,
)

from safety.fall_detector import FallDetector
from safety.ppe_checker import PPEChecker
from safety.zones import ZoneManager

logger = logging.getLogger(__name__)

# Class names treated as vehicles for proximity checks
_VEHICLE_CLASSES: frozenset[str] = frozenset({
    "truck", "car", "bus", "forklift",
    "excavator", "crane", "machinery", "vehicle",
})

_VEHICLE_PROXIMITY_PX = 200  # pixels


class HazardAnalyzer:
    """Combine all safety signals into a unified hazard list.

    Parameters
    ----------
    zone_manager:
        Loaded :class:`ZoneManager` with danger zones.
    ppe_checker:
        :class:`PPEChecker` instance.
    fall_detector:
        :class:`FallDetector` instance.
    """

    def __init__(
        self,
        zone_manager: ZoneManager,
        ppe_checker: PPEChecker,
        fall_detector: FallDetector,
        perspective: str = "third_person",
        resolution: tuple[int, int] = (1280, 720),
    ) -> None:
        self.zone_manager = zone_manager
        self.ppe_checker = ppe_checker
        self.fall_detector = fall_detector
        self.perspective = perspective
        self.resolution = resolution

    # ── public API ───────────────────────────────────────────
    def analyze(
        self,
        detections: list[Detection],
        poses: list[PoseData],
        tracked_objects: dict[int, TrackedObject],
        timestamp: float,
    ) -> tuple[list[HazardAssessment], dict[int, WorkerPPEState], list[DangerZone]]:
        """Run the full hazard analysis pipeline for one frame.

        Returns
        -------
        tuple[list[HazardAssessment], dict[int, WorkerPPEState], list[DangerZone]]
            ``(hazards, ppe_states, machine_zones)`` — the combined hazard list,
            per-worker PPE compliance mapping, and dynamic machine exclusion zones.
        """
        hazards: list[HazardAssessment] = []
        active_machine_zones: list[DangerZone] = []

        # Partition tracked objects into persons and vehicles
        persons = {
            tid: obj for tid, obj in tracked_objects.items()
            if obj.class_name == "person"
        }
        vehicles = {
            tid: obj for tid, obj in tracked_objects.items()
            if obj.class_name.lower() in _VEHICLE_CLASSES
        }

        # ── Step 1: PPE compliance ───────────────────────────
        ppe_states = self.ppe_checker.check(detections, persons)

        # ── Step 2: Fall detection ───────────────────────────
        if self.perspective == "third_person":
            fall_hazards = self.fall_detector.update(poses, timestamp)
            hazards.extend(fall_hazards)

            # ── Step 3: Zone proximity (Third Person) ────────────
            for tid, person in persons.items():
                overlapping_zones = self.zone_manager.check_overlap(person.bbox)
                for zone in overlapping_zones:
                    hazards.append(HazardAssessment(
                        hazard_id=f"zone_{tid}_{zone.name}",
                        hazard_type="zone_proximity",
                        severity=zone.severity_base,
                        description=(
                            f"Worker #{tid} inside danger zone '{zone.name}' "
                            f"({zone.zone_type})"
                        ),
                        worker_track_id=tid,
                        hazard_bbox=person.bbox,
                        zone_name=zone.name,
                        state=HazardState.DETECTED,
                        first_seen=timestamp,
                    ))

            # ── Step 4: Machine Exclusion Zones (Third Person) ───
            for vid, vehicle in vehicles.items():
                vx1, vy1, vx2, vy2 = vehicle.bbox
                buffer = 150  # Exclusion zone padding around machine in pixels
                polygon = [
                    (max(0, vx1 - buffer), max(0, vy1 - buffer)),
                    (vx2 + buffer, max(0, vy1 - buffer)),
                    (vx2 + buffer, vy2 + buffer),
                    (max(0, vx1 - buffer), vy2 + buffer),
                ]
                zone = DangerZone(
                    name=f"Machine #{vid} exclusion zone",
                    zone_type="machine_exclusion",
                    polygon=polygon,
                    severity_base=Severity.DANGER,
                    metadata={"vehicle_track_id": vid},
                )
                active_machine_zones.append(zone)

                # Check if any worker overlaps with this machine zone
                for tid, person in persons.items():
                    px1, py1, px2, py2 = person.bbox
                    center = ((px1 + px2) / 2.0, (py1 + py2) / 2.0)
                    corners = [
                        (float(px1), float(py1)),
                        (float(px2), float(py1)),
                        (float(px2), float(py2)),
                        (float(px1), float(py2)),
                    ]
                    test_points = [center] + corners
                    contour = np.array(polygon, dtype=np.float32).reshape((-1, 1, 2))
                    overlap = False
                    for pt in test_points:
                        if cv2.pointPolygonTest(contour, pt, measureDist=False) >= 0:
                            overlap = True
                            break
                    if overlap:
                        hazards.append(HazardAssessment(
                            hazard_id=f"machine_zone_{tid}_{vid}",
                            hazard_type="zone_proximity",
                            severity=Severity.DANGER,
                            description=f"Worker #{tid} inside machine #{vid} exclusion zone!",
                            worker_track_id=tid,
                            hazard_bbox=person.bbox,
                            zone_name=zone.name,
                            state=HazardState.DETECTED,
                            first_seen=timestamp,
                        ))
        else:
            # ── Egocentric Mode: Vehicle Proximity ───────────────
            frame_w, frame_h = self.resolution
            frame_area = frame_w * frame_h
            
            for vid, vehicle in vehicles.items():
                dist_m = vehicle.distance_meters
                
                # Check absolute distance first if metric depth is available
                if dist_m is not None:
                    if dist_m <= 3.0:
                        severity = Severity.CRITICAL
                    elif dist_m <= 6.0:
                        severity = Severity.DANGER
                    elif dist_m <= 12.0:
                        severity = Severity.WARNING
                    else:
                        continue
                    description = f"{vehicle.class_name.capitalize()} #{vid} approaching ({dist_m}m away)"
                else:
                    # Bounding-box ratio heuristic fallback
                    x1, y1, x2, y2 = vehicle.bbox
                    v_w = x2 - x1
                    v_h = y2 - y1
                    v_area = v_w * v_h
                    area_ratio = v_area / frame_area
                    
                    if area_ratio > 0.30 or y2 > frame_h * 0.90:
                        severity = Severity.CRITICAL
                    elif area_ratio > 0.15 or y2 > frame_h * 0.80:
                        severity = Severity.DANGER
                    elif area_ratio > 0.05 or y2 > frame_h * 0.60:
                        severity = Severity.WARNING
                    else:
                        continue
                    description = f"{vehicle.class_name.capitalize()} #{vid} approaching"

                hazards.append(HazardAssessment(
                    hazard_id=f"egocentric_vehicle_{vid}",
                    hazard_type="vehicle_proximity_egocentric",
                    severity=severity,
                    description=description,
                    worker_track_id=None,
                    hazard_bbox=vehicle.bbox,
                    state=HazardState.DETECTED,
                    first_seen=timestamp,
                    distance_meters=dist_m,
                ))

        # ── Step 5: PPE severity modulation ──────────────────
        if self.perspective == "third_person":
            self._modulate_ppe_severity(hazards, ppe_states)

        return hazards, ppe_states, active_machine_zones

    # ── helpers ──────────────────────────────────────────────
    @staticmethod
    def _modulate_ppe_severity(
        hazards: list[HazardAssessment],
        ppe_states: dict[int, WorkerPPEState],
    ) -> None:
        """Escalate hazard severity when the involved worker is missing PPE.

        Mutates *hazards* in place: if the worker linked to a hazard is
        non-compliant, the hazard's severity is bumped one tier and
        ``ppe_modifier`` is set to ``True``.
        """
        for hazard in hazards:
            if hazard.worker_track_id is None:
                continue
            ppe = ppe_states.get(hazard.worker_track_id)
            if ppe is None:
                continue
            if not ppe.is_compliant:
                hazard.severity = hazard.severity.escalate()
                hazard.ppe_modifier = True
                missing = ", ".join(ppe.missing_items)
                hazard.description += f" [PPE missing: {missing}]"
