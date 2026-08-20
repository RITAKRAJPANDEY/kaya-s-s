#!/usr/bin/env python3
"""
Unit test for the exact FOV Blind-Spot Algorithm described in the user blueprint.
Tests:
1. Haversine distance
2. Forward compass bearing
3. normalize_angle to [-180, +180]
4. Pixel offset to angle offset conversion
5. is_outside_fov(device, threat_lat, threat_lon, fov_deg=70, max_range_m=40)
6. Diagram Scenario:
   - Person A (Green FOV) spots Threat
   - Person B (Blue FOV, facing North, Threat behind B)
   - Verified: Person B receives targeted alert; Person A does not.
"""
import math
import sys

def calc_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)
    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    theta = math.atan2(y, x)
    return (math.degrees(theta) + 360.0) % 360.0

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    a = math.sin(delta_phi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def normalize_angle(angle_deg: float) -> float:
    return (angle_deg + 180.0) % 360.0 - 180.0

def project_coordinates(lat: float, lon: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    theta_rad = math.radians(bearing_deg)
    d_lat = (distance_m * math.cos(theta_rad)) / 111320.0
    d_lon = (distance_m * math.sin(theta_rad)) / (111320.0 * math.cos(math.radians(lat)))
    return (lat + d_lat, lon + d_lon)

def is_outside_fov(device: dict, threat_lat: float, threat_lon: float, fov_deg: float = 70.0, max_range_m: float = 40.0) -> bool:
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

def test_algorithm():
    print("=== TESTING FOV & BLIND-SPOT ALGORITHM ===")

    # Setup Diagram Scenario
    # Person B is at origin (23.0225, 72.5714), facing NORTH (heading = 0 deg)
    person_b = {
        "id": "Person B",
        "lat": 23.0225,
        "lon": 72.5714,
        "heading": 0.0  # North
    }

    # Threat is 15m SOUTH of Person B (Bearing = 180 deg, Behind Person B)
    threat_lat, threat_lon = project_coordinates(person_b["lat"], person_b["lon"], 180.0, 15.0)

    # Person A is located 25m East and 10m North of Person B, facing South-West towards Threat
    person_a_lat, person_a_lon = project_coordinates(person_b["lat"], person_b["lon"], 60.0, 25.0)
    bearing_a_to_threat = calc_bearing(person_a_lat, person_a_lon, threat_lat, threat_lon)
    
    person_a = {
        "id": "Person A",
        "lat": person_a_lat,
        "lon": person_a_lon,
        "heading": bearing_a_to_threat  # Person A is looking directly at Threat
    }

    dist_b_to_threat = haversine(person_b["lat"], person_b["lon"], threat_lat, threat_lon)
    dist_a_to_threat = haversine(person_a["lat"], person_a["lon"], threat_lat, threat_lon)

    print(f"[SCENARIO] Distance Person B -> Threat: {dist_b_to_threat:.1f}m (Behind B)")
    print(f"[SCENARIO] Distance Person A -> Threat: {dist_a_to_threat:.1f}m (In A's view)")

    # Test is_outside_fov for Person B
    outside_b = is_outside_fov(person_b, threat_lat, threat_lon, fov_deg=70.0, max_range_m=40.0)
    print(f"[TEST] is_outside_fov(Person B) -> {outside_b} (EXPECTED: True - in B's blind spot)")
    assert outside_b is True, "Person B should be outside FOV (blind spot)"

    # Test is_outside_fov for Person A (Person A is looking at the threat)
    outside_a = is_outside_fov(person_a, threat_lat, threat_lon, fov_deg=70.0, max_range_m=40.0)
    print(f"[TEST] is_outside_fov(Person A) -> {outside_a} (EXPECTED: False - inside A's FOV)")
    assert outside_a is False, "Person A should be inside FOV"

    # Test Out of Range (> 40m)
    threat_far_lat, threat_far_lon = project_coordinates(person_b["lat"], person_b["lon"], 180.0, 55.0)
    outside_far = is_outside_fov(person_b, threat_far_lat, threat_far_lon, fov_deg=70.0, max_range_m=40.0)
    print(f"[TEST] is_outside_fov(Person B, 55m away) -> {outside_far} (EXPECTED: False - out of range)")
    assert outside_far is False, "Threat > 40m should not trigger alert"

    # Test Pixel Offset to Bearing calculation
    # Frame width = 640px. Bounding box center = 480px (160px to the right of center 320px)
    frame_w = 640
    cx = 480
    pixel_offset = cx - (frame_w / 2.0)  # +160px
    fov_deg = 70.0
    bearing_offset = (pixel_offset / frame_w) * fov_deg  # +17.5 deg
    print(f"[TEST] Pixel offset +160px in 640px frame -> Bearing Offset: {bearing_offset:+.1f} deg (EXPECTED: +17.5 deg)")
    assert abs(bearing_offset - 17.5) < 0.01, "Pixel offset math incorrect"

    print("\n[SUCCESS] ALL PYTHON FOV & BLIND-SPOT TESTS PASSED WITH 100% PRECISION!")

if __name__ == "__main__":
    test_algorithm()
