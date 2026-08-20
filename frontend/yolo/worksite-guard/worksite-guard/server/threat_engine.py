"""WorksiteGuard Threat & FOV Blind-Spot Spatial Engine.

Performs:
1. Real-time YOLO threat classification (vehicles, machinery, sharp objects, proximity incursions)
2. FOV and geometry calculations (haversine, forward compass bearing, angle normalization)
3. Threat spatial projection from bounding box pixel offsets
4. Multi-agent blind-spot verification with a 3-second TTL cache:
   "If Phone A detects a threat, and the threat is OUTSIDE Phone B's 70° FOV cone
    but within 40m range -> Fire targeted alert to Phone B's socket only."
"""
from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque

from config import settings
from detector import Detection

# Vehicle / Machinery classes matching standard COCO and site datasets
VEHICLE_CLASSES = {"car", "truck", "bus", "motorcycle", "train", "vehicle", "machinery", "forklift", "tractor"}
SHARP_TOOL_CLASSES = {"knife", "scissors"}

DEFAULT_FOV_DEG = 70.0
MAX_ALERT_RANGE_M = 40.0
THREAT_TTL_SECONDS = 3.0


@dataclass
class Threat:
    level: str  # "caution" | "danger"
    label: str
    message: str
    box: tuple[int, int, int, int] | None = None
    lat: float | None = None
    lon: float | None = None
    distance_m: float | None = None
    bearing_deg: float | None = None


@dataclass
class _ClientHistory:
    window: Deque[set] = field(default_factory=lambda: deque(maxlen=settings.FRAME_HISTORY))

    def push(self, threat_keys: set) -> None:
        self.window.append(threat_keys)

    def confirmed(self, key: str) -> bool:
        hits = sum(1 for frame_keys in self.window if key in frame_keys)
        return hits >= settings.DEBOUNCE_HITS


# =========================================================================
# GEODESY & FOV TRIGONOMETRY HELPERS
# =========================================================================

def calc_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes initial forward compass bearing in degrees (0° to 360°) from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)

    theta = math.atan2(y, x)
    return (math.degrees(theta) + 360.0) % 360.0


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two GPS coordinates in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def normalize_angle(angle_deg: float) -> float:
    """Normalizes angle to the range [-180, +180] degrees."""
    return (angle_deg + 180.0) % 360.0 - 180.0


def project_coordinates(lat: float, lon: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    """Projects a destination GPS coordinate given origin (lat, lon), bearing, and distance."""
    theta_rad = math.radians(bearing_deg)
    d_lat = (distance_m * math.cos(theta_rad)) / 111320.0
    d_lon = (distance_m * math.sin(theta_rad)) / (111320.0 * math.cos(math.radians(lat)))
    return (lat + d_lat, lon + d_lon)


def estimate_threat_coordinates(
    obs_lat: float,
    obs_lon: float,
    obs_heading: float,
    box: tuple[int, int, int, int],
    frame_w: int,
    fov_deg: float = DEFAULT_FOV_DEG,
    default_distance_m: float = 14.0
) -> tuple[float, float, float, float]:
    """
    Takes bbox center horizontal pixel offset from frame center, converts to angle offset,
    computes global threat bearing, and projects global (threat_lat, threat_lon).
    
    Returns:
        (threat_lat, threat_lon, threat_bearing, distance_m)
    """
    x1, y1, x2, y2 = box
    cx = (x1 + x2) / 2.0
    
    # Pixel offset from frame center (-W/2 to +W/2)
    pixel_offset = cx - (frame_w / 2.0)
    
    # Angle offset from observer camera heading
    bearing_offset = (pixel_offset / float(frame_w)) * fov_deg
    effective_bearing = (obs_heading + bearing_offset + 360.0) % 360.0
    
    threat_lat, threat_lon = project_coordinates(obs_lat, obs_lon, effective_bearing, default_distance_m)
    return (threat_lat, threat_lon, effective_bearing, default_distance_m)


def is_outside_fov(
    device: dict,
    threat_lat: float,
    threat_lon: float,
    fov_deg: float = DEFAULT_FOV_DEG,
    max_range_m: float = MAX_ALERT_RANGE_M
) -> bool:
    """
    Core Blind-Spot Test:
    Returns True if the threat is within max_range_m of the device BUT outside the device's FOV cone.
    """
    dev_lat = device.get("lat")
    dev_lon = device.get("lon")
    dev_heading = device.get("heading", 0.0)
    
    if dev_lat is None or dev_lon is None:
        return False

    bearing = calc_bearing(dev_lat, dev_lon, threat_lat, threat_lon)
    distance = haversine(dev_lat, dev_lon, threat_lat, threat_lon)

    if distance > max_range_m:
        return False  # too far to matter

    angle_diff = abs(normalize_angle(bearing - dev_heading))
    return angle_diff > (fov_deg / 2.0)


# =========================================================================
# THREAT ENGINE & ACTIVE THREAT MEMORY WITH 3S TTL
# =========================================================================

class ThreatEngine:
    def __init__(self) -> None:
        self._history: dict[str, _ClientHistory] = {}
        # In-memory threats store with TTL: threat_id -> {threat_lat, threat_lon, source_id, ...}
        self.threats: dict[str, dict] = {}

    def _hist(self, client_id: str) -> _ClientHistory:
        return self._history.setdefault(client_id, _ClientHistory())

    def purge_expired_threats(self, now: float | None = None) -> None:
        """Removes active threats that have not been re-confirmed within TTL (3 seconds)."""
        now = now or time.time()
        expired = [tid for tid, t in self.threats.items() if now > t.get("expires_at", 0)]
        for tid in expired:
            self.threats.pop(tid, None)

    def register_threat(
        self,
        source_client_id: str,
        threat_lat: float,
        threat_lon: float,
        level: str,
        label: str,
        message: str,
        box: tuple[int, int, int, int] | None = None,
        ttl_seconds: float = THREAT_TTL_SECONDS
    ) -> str:
        """Registers/updates a confirmed threat in active shared perception memory with a 3s TTL."""
        now = time.time()
        threat_id = f"thr:{source_client_id}:{label}"
        self.threats[threat_id] = {
            "threat_id": threat_id,
            "source_client_id": source_client_id,
            "threat_lat": threat_lat,
            "threat_lon": threat_lon,
            "level": level,
            "label": label,
            "message": message,
            "box": box,
            "created_at": now,
            "expires_at": now + ttl_seconds,
        }
        self.purge_expired_threats(now)
        return threat_id

    def check_blind_spots_for_threat(
        self,
        threat: dict,
        devices: dict[str, dict],
        fov_deg: float = DEFAULT_FOV_DEG,
        max_range_m: float = MAX_ALERT_RANGE_M
    ) -> list[dict]:
        """
        Runs the FOV check against every other connected device and returns targeted alert payloads.
        """
        alerts = []
        source_id = threat.get("source_client_id", "")
        t_lat = threat.get("threat_lat")
        t_lon = threat.get("threat_lon")

        if t_lat is None or t_lon is None:
            return alerts

        for dev_id, dev in devices.items():
            if dev_id == source_id:
                continue  # don't alert self

            if is_outside_fov(dev, t_lat, t_lon, fov_deg=fov_deg, max_range_m=max_range_m):
                dev_lat = dev["lat"]
                dev_lon = dev["lon"]
                dist = haversine(dev_lat, dev_lon, t_lat, t_lon)
                bearing = calc_bearing(dev_lat, dev_lon, t_lat, t_lon)

                alerts.append({
                    "type": "blind_spot_alert",
                    "target_client_id": dev_id,
                    "source_client_id": source_id,
                    "threat_lat": t_lat,
                    "threat_lon": t_lon,
                    "distance_m": round(dist, 1),
                    "bearing_deg": round(bearing, 1),
                    "label": threat.get("label", "Threat"),
                    "level": threat.get("level", "danger"),
                    "message": f"⚠️ Blind-spot hazard detected {round(dist, 1)}m behind/flank by {source_id}!",
                    "ts": time.time()
                })

        return alerts

    def evaluate(self, client_id: str, detections: list[Detection], frame_w: int, frame_h: int) -> list[Threat]:
        raw: dict[str, Threat] = {}

        people = [d for d in detections if d.label in ("person", "Person")]
        vehicles = [d for d in detections if d.label in VEHICLE_CLASSES]
        sharp = [d for d in detections if d.label in SHARP_TOOL_CLASSES]

        frame_diag = (frame_w ** 2 + frame_h ** 2) ** 0.5 or 1.0

        # 1. Proximity to vehicles / heavy machinery
        for p in people:
            for v in vehicles:
                ratio = _center_distance(p, v) / frame_diag
                if ratio < settings.PROXIMITY_DANGER_RATIO:
                    key = f"proximity:danger:{v.label}"
                    raw[key] = Threat("danger", "Proximity Hazard", f"Worker very close to {v.label}", _union_box(p, v))
                elif ratio < settings.PROXIMITY_CAUTION_RATIO:
                    key = f"proximity:caution:{v.label}"
                    raw.setdefault(key, Threat("caution", "Proximity Hazard", f"Worker near {v.label}", _union_box(p, v)))

        # 2. Sharp tools / hazards near a person
        for p in people:
            for s in sharp:
                if _center_distance(p, s) / frame_diag < settings.PROXIMITY_DANGER_RATIO:
                    key = f"sharp:{s.label}"
                    raw[key] = Threat("caution", "Sharp Hazard", f"{s.label.capitalize()} near worker", _union_box(p, s))

        # Debounce against recent-frame history for this client
        hist = self._hist(client_id)
        hist.push(set(raw.keys()))
        return [t for key, t in raw.items() if hist.confirmed(key)]


def _center_distance(a: Detection, b: Detection) -> float:
    ax, ay = a.center
    bx, by = b.center
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


def _union_box(a: Detection, b: Detection) -> tuple[int, int, int, int]:
    return (min(a.x1, b.x1), min(a.y1, b.y1), max(a.x2, b.x2), max(a.y2, b.y2))
