"""WorksiteGuard server with Shared Perception & Blind-Spot Threat Engine.

Features:
1. Real-time Multi-Camera YOLO Stream Relay
2. In-memory pose store for all connected agents (lat, lon, heading)
3. 3-Second TTL active threat cache
4. 70° FOV & Haversine Blind-Spot checking:
   "When Phone A detects a threat, project threat (lat, lon); check every other connected
    Phone B. If threat is within 40m but OUTSIDE Phone B's FOV cone -> Push targeted alert
    specifically to Phone B's socket."
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from detector import Detector
from threat_engine import (
    ThreatEngine, 
    estimate_threat_coordinates, 
    is_outside_fov, 
    calc_bearing, 
    haversine
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worksite_guard.main")

app = FastAPI(title="WorksiteGuard")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

detector = Detector()
threat_engine = ThreatEngine()
executor = ThreadPoolExecutor(max_workers=4)

dashboards: set[WebSocket] = set()
# clients: client_id -> {"lat": float, "lon": float, "heading": float, "last_seen": float}
clients: dict[str, dict] = {}
client_sockets: dict[str, WebSocket] = {}
raw_frame_store: dict[str, bytes] = {}
detection_tasks: dict[str, asyncio.Task] = {}
active_threats_by_client: dict[str, list[dict]] = {}
latest_detections_by_client: dict[str, list[dict]] = {}


@app.get("/")
async def dashboard_page():
    return FileResponse(STATIC_DIR / "dashboard.html")


@app.get("/client")
async def client_page():
    return FileResponse(STATIC_DIR / "client.html")


@app.get("/api/clients")
async def list_clients():
    return {
        cid: {
            "lat": v.get("lat"),
            "lon": v.get("lon"),
            "heading": v.get("heading"),
            "last_seen": v.get("last_seen")
        } 
        for cid, v in clients.items()
    }


@app.get("/api/site-perception")
async def site_perception_api():
    threat_engine.purge_expired_threats()
    all_threats = list(threat_engine.threats.values())
    return {
        "clients": list(clients.keys()),
        "devices": clients,
        "active_threats": all_threats,
        "summary": _build_site_summary(),
        "ts": time.time(),
    }


async def _broadcast(message: dict) -> None:
    """Broadcast to all safety dashboards."""
    if not dashboards:
        return
    dead = []
    payload = json.dumps(message)
    for ws in list(dashboards):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        dashboards.discard(ws)


async def _send_targeted_alert(target_client_id: str, alert_message: dict) -> None:
    """Sends a targeted blind-spot alert directly to the socket of the affected device only."""
    ws = client_sockets.get(target_client_id)
    if ws:
        try:
            await ws.send_text(json.dumps(alert_message))
            logger.info("🚨 TARGETED BLIND-SPOT ALERT SENT TO [%s]: %s", target_client_id, alert_message.get("message"))
        except Exception:
            client_sockets.pop(target_client_id, None)


async def _broadcast_to_clients(message: dict, exclude_client_id: str | None = None) -> None:
    """Broadcast to all streaming camera clients (phones, Pis)."""
    if not client_sockets:
        return
    dead = []
    payload = json.dumps(message)
    for cid, ws in list(client_sockets.items()):
        if exclude_client_id and cid == exclude_client_id:
            continue
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(cid)
    for cid in dead:
        client_sockets.pop(cid, None)


async def _broadcast_site_wide(message: dict, exclude_client_id: str | None = None) -> None:
    """Broadcast to dashboards and all active clients for shared worksite perception."""
    await _broadcast(message)
    await _broadcast_to_clients(message, exclude_client_id=exclude_client_id)


def _build_site_summary() -> dict:
    total_people = 0
    total_vehicles = 0
    total_threats = 0
    danger_threats = 0

    for dets in latest_detections_by_client.values():
        for d in dets:
            lbl = str(d.get("label", "")).lower()
            if lbl in ("person", "people"):
                total_people += 1
            elif lbl in ("car", "truck", "bus", "motorcycle", "train", "vehicle", "machinery", "forklift"):
                total_vehicles += 1

    threat_engine.purge_expired_threats()
    active_thr = list(threat_engine.threats.values())
    total_threats = len(active_thr)
    danger_threats = sum(1 for t in active_thr if t.get("level") == "danger")

    return {
        "cameras_count": len(clients),
        "people_count": total_people,
        "vehicles_count": total_vehicles,
        "threats_count": total_threats,
        "danger_count": danger_threats,
    }


def _run_detection_sync(frame: np.ndarray):
    h, w = frame.shape[:2]
    detections = detector.detect(frame)
    return detections, w, h


async def _detection_loop(client_id: str) -> None:
    loop = asyncio.get_event_loop()
    last_threat_keys: set[str] = set()
    last_perception_sync = 0.0

    try:
        while True:
            await asyncio.sleep(settings.DETECT_INTERVAL)
            data = raw_frame_store.get(client_id)
            if data is None:
                continue
            arr = np.frombuffer(data, dtype=np.uint8)
            frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            detections, w, h = await loop.run_in_executor(executor, _run_detection_sync, frame)
            threats = threat_engine.evaluate(client_id, detections, w, h)
            now_ts = time.time()

            detections_data = [
                {"label": d.label, "confidence": round(d.confidence, 2), "box": [d.x1, d.y1, d.x2, d.y2]}
                for d in detections
            ]
            threats_data = []

            # Get observer device pose if available (default origin if testing without GPS)
            dev_pose = clients.get(client_id, {})
            obs_lat = dev_pose.get("lat", 23.0225)
            obs_lon = dev_pose.get("lon", 72.5714)
            obs_heading = dev_pose.get("heading", 0.0)

            for t in threats:
                t_lat, t_lon, t_bearing, t_dist = None, None, None, None
                if t.box:
                    t_lat, t_lon, t_bearing, t_dist = estimate_threat_coordinates(
                        obs_lat, obs_lon, obs_heading, t.box, w, fov_deg=70.0
                    )
                    # Register in 3-second TTL shared threat store
                    threat_id = threat_engine.register_threat(
                        source_client_id=client_id,
                        threat_lat=t_lat,
                        threat_lon=t_lon,
                        level=t.level,
                        label=t.label,
                        message=t.message,
                        box=t.box,
                        ttl_seconds=3.0
                    )
                    
                    # RUN BLIND-SPOT CHECK AGAINST ALL OTHER CONNECTED DEVICES
                    blind_alerts = threat_engine.check_blind_spots_for_threat(
                        threat_engine.threats[threat_id],
                        clients,
                        fov_deg=70.0,
                        max_range_m=40.0
                    )
                    for alert in blind_alerts:
                        # Send alert to target device socket only
                        await _send_targeted_alert(alert["target_client_id"], alert)
                        # Also broadcast alert line to dashboard
                        await _broadcast({
                            "type": "blind_spot_hazard",
                            "alert": alert,
                            "ts": now_ts
                        })

                threats_data.append({
                    "level": t.level,
                    "label": t.label,
                    "message": t.message,
                    "box": t.box,
                    "lat": t_lat,
                    "lon": t_lon,
                    "distance_m": t_dist,
                    "bearing_deg": t_bearing
                })

            latest_detections_by_client[client_id] = detections_data
            active_threats_by_client[client_id] = threats_data

            # Broadcast detections overlay to dashboard
            await _broadcast({
                "type": "detections",
                "client_id": client_id,
                "frame_w": w,
                "frame_h": h,
                "detections": detections_data,
                "threats": threats_data,
                "ts": now_ts,
            })

            # Check for newly active threats to broadcast site-wide
            current_threat_keys = {f"{t.level}:{t.label}:{t.message}" for t in threats}
            new_keys = current_threat_keys - last_threat_keys
            last_threat_keys = current_threat_keys

            for t in threats:
                key = f"{t.level}:{t.label}:{t.message}"
                if key in new_keys:
                    logger.info("Site hazard spotted by %s: [%s] %s", client_id, t.level, t.message)
                    await _broadcast({
                        "type": "site_alert",
                        "source_client_id": client_id,
                        "level": t.level,
                        "label": t.label,
                        "message": t.message,
                        "box": t.box,
                        "ts": now_ts,
                    })

            # Periodically synchronize shared worksite perception
            if new_keys or (now_ts - last_perception_sync >= 1.5):
                last_perception_sync = now_ts
                threat_engine.purge_expired_threats(now_ts)
                all_threats = list(threat_engine.threats.values())
                await _broadcast_site_wide({
                    "type": "site_perception",
                    "clients": list(clients.keys()),
                    "active_threats": all_threats,
                    "summary": _build_site_summary(),
                    "ts": now_ts,
                })
    except asyncio.CancelledError:
        pass


@app.websocket("/ws/stream/{client_id}")
async def stream_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    # Initialize client state with default pose if not sent
    clients[client_id] = {
        "client_id": client_id,
        "lat": 23.0225,
        "lon": 72.5714,
        "heading": 0.0,
        "last_seen": time.time()
    }
    client_sockets[client_id] = websocket
    detection_tasks[client_id] = asyncio.create_task(_detection_loop(client_id))

    logger.info("Client connected: %s", client_id)
    await _broadcast_site_wide({"type": "client_online", "client_id": client_id})

    min_interval = 1.0 / settings.VIDEO_RELAY_FPS
    last_relay_ts = 0.0

    try:
        while True:
            # Can receive raw video bytes OR JSON telemetry/threat packets
            message = await websocket.receive()
            now = time.time()

            if "bytes" in message and message["bytes"]:
                data = message["bytes"]
                if client_id in clients:
                    clients[client_id]["last_seen"] = now
                raw_frame_store[client_id] = data

                if now - last_relay_ts < min_interval:
                    continue
                last_relay_ts = now

                image_b64 = base64.b64encode(data).decode("ascii")
                await _broadcast({
                    "type": "video_frame",
                    "client_id": client_id,
                    "image": image_b64,
                    "ts": now,
                })

            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    p_type = payload.get("type")

                    # Handle telemetry update (lat, lon, heading from phone GPS/IMU)
                    if p_type in ("telemetry", "pose", "phone_pose"):
                        if client_id not in clients:
                            clients[client_id] = {"client_id": client_id}
                        clients[client_id].update({
                            "lat": payload.get("lat", clients[client_id].get("lat", 23.0225)),
                            "lon": payload.get("lon", clients[client_id].get("lon", 72.5714)),
                            "heading": payload.get("heading", payload.get("heading_deg", 0.0)),
                            "last_seen": now
                        })

                    # Handle explicit threat message from phone client
                    elif p_type == "threat":
                        obs_lat = payload.get("lat", clients.get(client_id, {}).get("lat", 23.0225))
                        obs_lon = payload.get("lon", clients.get(client_id, {}).get("lon", 72.5714))
                        obs_heading = payload.get("heading", clients.get(client_id, {}).get("heading", 0.0))
                        bearing_offset = payload.get("bearing_offset", 0.0)
                        distance_est = payload.get("distance_est", 14.0)
                        threat_label = payload.get("class", payload.get("label", "Threat"))

                        # Compute threat global coordinate
                        t_bearing = (obs_heading + bearing_offset + 360.0) % 360.0
                        t_lat, t_lon = project_coordinates(obs_lat, obs_lon, t_bearing, distance_est)

                        # Register in 3-second TTL store
                        threat_id = threat_engine.register_threat(
                            source_client_id=client_id,
                            threat_lat=t_lat,
                            threat_lon=t_lon,
                            level="danger",
                            label=threat_label,
                            message=f"Threat detected at bearing {round(t_bearing)}° ({distance_est}m)",
                            ttl_seconds=3.0
                        )

                        # Check FOV against all other connected devices
                        blind_alerts = threat_engine.check_blind_spots_for_threat(
                            threat_engine.threats[threat_id],
                            clients,
                            fov_deg=70.0,
                            max_range_m=40.0
                        )
                        for alert in blind_alerts:
                            await _send_targeted_alert(alert["target_client_id"], alert)

                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("Stream error for %s: %s", client_id, e)
    finally:
        task = detection_tasks.pop(client_id, None)
        if task:
            task.cancel()
        raw_frame_store.pop(client_id, None)
        client_sockets.pop(client_id, None)
        clients.pop(client_id, None)
        active_threats_by_client.pop(client_id, None)
        latest_detections_by_client.pop(client_id, None)

        await _broadcast_site_wide({"type": "client_offline", "client_id": client_id})
        logger.info("Client disconnected: %s", client_id)


@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket):
    await websocket.accept()
    dashboards.add(websocket)
    try:
        threat_engine.purge_expired_threats()
        await websocket.send_text(json.dumps({
            "type": "roster",
            "clients": list(clients.keys()),
            "devices": clients,
            "active_threats": list(threat_engine.threats.values()),
            "summary": _build_site_summary(),
        }))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        dashboards.discard(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
