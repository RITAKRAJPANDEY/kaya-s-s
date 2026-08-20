"""
Central hub server.

Run with:  python server.py
Then on your WiFi network:
  - Phones open:  http://<server-ip>:8000/phone.html   (sends their GPS + heading)
  - You open:     http://<server-ip>:8000/map.html      (shows everyone live on Google Maps)
  - Raspberry Pi runs pi_tracker.py, which streams to the same server.

All devices must be on the same WiFi network as the machine running this server.
Find the server's LAN IP with `ipconfig` (Windows) or `ifconfig` / `ip a` (Mac/Linux/Pi).
"""

import json
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

STATIC_DIR = Path(__file__).parent if (Path(__file__).parent / "map.html").exists() else Path(__file__).parent / "static"

# device_id -> latest pose dict
latest_state: dict[str, dict] = {}

# currently connected map viewers (they receive broadcasts)
viewers: set[WebSocket] = set()


@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "map.html")


@app.get("/phone.html")
def phone_page():
    return FileResponse(STATIC_DIR / "phone.html")


@app.get("/map.html")
def map_page():
    return FileResponse(STATIC_DIR / "map.html")


async def broadcast(message: dict):
    dead = []
    for ws in viewers:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        viewers.discard(ws)


@app.websocket("/ws/device")
async def device_ws(websocket: WebSocket):
    """Phones and the Pi connect here and stream pose updates."""
    await websocket.accept()
    device_id = None
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            device_id = data.get("device_id", device_id or "unknown")
            data["device_id"] = device_id
            data["server_time"] = time.time()

            latest_state[device_id] = data
            await broadcast({"type": "update", "device": data})
    except WebSocketDisconnect:
        pass
    finally:
        if device_id and device_id in latest_state:
            # mark offline but keep last known position on the map
            latest_state[device_id]["online"] = False
            await broadcast({"type": "offline", "device_id": device_id})


@app.websocket("/ws/viewer")
async def viewer_ws(websocket: WebSocket):
    """Map page connects here to receive live updates."""
    await websocket.accept()
    viewers.add(websocket)
    try:
        # send current snapshot immediately
        await websocket.send_json({"type": "snapshot", "devices": list(latest_state.values())})
        while True:
            # viewers don't send anything meaningful; just keep the socket alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        viewers.discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
