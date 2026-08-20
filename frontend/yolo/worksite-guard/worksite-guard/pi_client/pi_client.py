"""Raspberry Pi (or any USB webcam) client for WorksiteGuard.

Captures frames from a local camera and streams them to the server over a
WebSocket, exactly like the browser client does. In addition, it listens for
site-wide hazard alerts from peer cameras across the worksite.

Usage:
    python pi_client.py --server 192.168.1.42:8000 --name gate-cam-1

By default this connects over wss:// and skips certificate verification,
matching the self-signed certificate setup described in the README. If you
run the server without TLS, add --no-tls.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import ssl
import time

import cv2
import websockets


async def receive_loop(ws: websockets.WebSocketClientProtocol, my_name: str) -> None:
    """Listen for site-wide hazard alerts and shared perception updates from the server."""
    try:
        async for raw_msg in ws:
            if isinstance(raw_msg, str):
                try:
                    msg = json.loads(raw_msg)
                    msg_type = msg.get("type")
                    if msg_type == "site_alert":
                        source = msg.get("source_client_id")
                        level = msg.get("level", "danger").upper()
                        label = msg.get("label", "Threat")
                        text = msg.get("message", "")
                        src_str = "YOUR CAMERA" if source == my_name else source
                        # \a sounds the system terminal bell / buzzer
                        print(f"\a\n🚨 >>> [SITE-WIDE {level} ALERT from {src_str}]: {label} — {text} <<<")
                    elif msg_type == "site_perception":
                        summary = msg.get("summary", {})
                        cams = summary.get("cameras_count", 0)
                        hazards = summary.get("threats_count", 0)
                        if hazards > 0:
                            print(f"⚠️ [Worksite Mesh]: {hazards} active hazard(s) across {cams} camera zones")
                except json.JSONDecodeError:
                    pass
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def stream(server: str, name: str, camera_index: int, fps: float, secure: bool, verify_tls: bool):
    scheme = "wss" if secure else "ws"
    uri = f"{scheme}://{server}/ws/stream/{name}"
    interval = 1.0 / fps

    ssl_context = None
    if secure:
        ssl_context = ssl.create_default_context()
        if not verify_tls:
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

    cap = cv2.VideoCapture(camera_index)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open camera index {camera_index}. For a Pi Camera Module "
            "(CSI ribbon, not USB), enable the legacy camera stack via "
            "`sudo raspi-config`, or run this script with `libcamerify` in front."
        )

    print(f"Connecting to {uri} ...")
    while True:
        try:
            async with websockets.connect(uri, ssl=ssl_context, max_size=None) as ws:
                print(f"Connected as [{name}]. Streaming & monitoring site alerts — Ctrl+C to stop.")
                rx_task = asyncio.create_task(receive_loop(ws, name))
                try:
                    while True:
                        start = time.time()
                        ok, frame = cap.read()
                        if not ok:
                            await asyncio.sleep(0.05)
                            continue
                        
                        # Ensure frame is not oversized
                        h, w = frame.shape[:2]
                        if w > 640 or h > 480:
                            frame = cv2.resize(frame, (640, int(h * 640 / w)), interpolation=cv2.INTER_AREA)

                        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 60])
                        if ok:
                            await ws.send(buf.tobytes())
                        elapsed = time.time() - start
                        await asyncio.sleep(max(0.005, interval - elapsed))
                finally:
                    rx_task.cancel()
        except (websockets.ConnectionClosed, OSError) as exc:
            print(f"Connection lost ({exc}); retrying in 2s...")
            await asyncio.sleep(2)


def main():
    parser = argparse.ArgumentParser(description="Stream a camera and receive site alerts from WorksiteGuard.")
    parser.add_argument("--server", required=True, help="host:port of the server, e.g. 192.168.1.42:8000")
    parser.add_argument("--name", required=True, help="Identifier shown on the dashboard, e.g. gate-cam-1")
    parser.add_argument("--camera-index", type=int, default=0, help="cv2.VideoCapture index (default 0)")
    parser.add_argument("--fps", type=float, default=15.0, help="Target send rate")
    parser.add_argument("--no-tls", action="store_true", help="Use ws:// instead of wss:// (only if the server runs without SSL)")
    parser.add_argument("--verify-tls", action="store_true", help="Verify the server's TLS certificate (leave off for the default self-signed setup)")
    args = parser.parse_args()

    asyncio.run(stream(
        server=args.server,
        name=args.name,
        camera_index=args.camera_index,
        fps=args.fps,
        secure=not args.no_tls,
        verify_tls=args.verify_tls,
    ))


if __name__ == "__main__":
    main()
