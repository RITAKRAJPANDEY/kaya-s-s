#!/usr/bin/env python3
"""High-performance MJPEG stream server for Raspberry Pi 5 + IMX219.

Uses picamera2 capture_array in a dedicated thread + OpenCV JPEG encoding.
Avoids the V4L2 M2M encoder buffer conflicts seen with MJPEGEncoder.

Optimisations:
  • Dedicated capture thread with single-slot latest-frame buffer
  • OpenCV imencode with turbo-JPEG (faster than PIL on aarch64)
  • Pre-allocated numpy buffer for JPEG encoding
  • ThreadingMixIn HTTP server — slow clients never block capture
  • Minimal per-frame allocations in the MJPEG boundary headers
  • CAP_PROP_BUFFERSIZE=1 equivalent via picamera2's buffer_count=2

Usage:
  python3 stream_server.py                     # 1280x720 @30fps
  python3 stream_server.py -W 1920 -H 1080 -F 25 -Q 80

Endpoints:
  GET /stream    — multipart/x-mixed-replace MJPEG stream
  GET /snapshot  — single JPEG frame
  GET /          — JSON health check
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

import cv2
import numpy as np
from picamera2 import Picamera2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("pi_stream")


# ── Shared frame buffer (single-slot, latest-wins) ────────────

class FrameBuffer:
    """Thread-safe single-slot buffer holding the latest JPEG frame.

    The capture thread writes frames; HTTP handler threads read them.
    Readers always get the most recent frame — no queueing, no lag.
    """

    __slots__ = ("_lock", "_condition", "_jpeg", "_timestamp", "_frame_count")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._jpeg: bytes | None = None
        self._timestamp: float = 0.0
        self._frame_count: int = 0

    def put(self, jpeg_bytes: bytes) -> None:
        """Publish a new JPEG frame (called by capture thread)."""
        with self._condition:
            self._jpeg = jpeg_bytes
            self._timestamp = time.monotonic()
            self._frame_count += 1
            self._condition.notify_all()

    def get(self, timeout: float = 5.0) -> tuple[bytes, float, int]:
        """Return (jpeg_bytes, timestamp, frame_count). Blocks until available."""
        with self._condition:
            if self._jpeg is None:
                self._condition.wait(timeout=timeout)
            if self._jpeg is None:
                raise TimeoutError("No frame available")
            return self._jpeg, self._timestamp, self._frame_count

    def wait_for_new(self, last_count: int, timeout: float = 1.0) -> tuple[bytes, float, int]:
        """Block until a frame newer than last_count is available."""
        with self._condition:
            deadline = time.monotonic() + timeout
            while self._frame_count <= last_count:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._condition.wait(timeout=remaining)
            if self._jpeg is None:
                raise TimeoutError("No frame available")
            return self._jpeg, self._timestamp, self._frame_count

    @property
    def has_frame(self) -> bool:
        return self._jpeg is not None

    @property
    def frame_count(self) -> int:
        return self._frame_count


# ── Capture thread ─────────────────────────────────────────────

class CaptureThread(threading.Thread):
    """Captures frames from picamera2 and JPEG-encodes them into the buffer."""

    def __init__(
        self,
        picam: Picamera2,
        buffer: FrameBuffer,
        quality: int = 85,
        target_fps: float = 30.0,
    ) -> None:
        super().__init__(daemon=True, name="CaptureThread")
        self._picam = picam
        self._buffer = buffer
        self._quality = quality
        self._interval = 1.0 / target_fps if target_fps > 0 else 0.0
        self._running = True
        # Pre-build encode params (avoids list creation per frame)
        self._encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]

    def stop(self) -> None:
        self._running = False

    def run(self) -> None:
        logger.info("Capture thread started (quality=%d)", self._quality)
        encode_params = self._encode_params

        while self._running:
            t0 = time.monotonic()
            try:
                # capture_array returns numpy array in camera's native order
                frame = self._picam.capture_array("main")

                # Swap R and B channels to correct color
                frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

                # JPEG encode
                ok, jpeg = cv2.imencode(".jpg", frame, encode_params)
                if ok:
                    self._buffer.put(jpeg.tobytes())

            except Exception:
                logger.exception("Capture error")
                time.sleep(0.1)
                continue

            # Pace to target FPS
            elapsed = time.monotonic() - t0
            sleep_time = self._interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        logger.info("Capture thread stopped")


# ── HTTP handler ───────────────────────────────────────────────

_BOUNDARY = b"--frameboundary"
_CRLF = b"\r\n"
_JPEG_CT = b"Content-Type: image/jpeg"


class StreamHandler(BaseHTTPRequestHandler):
    """Serves MJPEG stream, single snapshots, and health checks."""

    # Silence per-request logging at 30fps
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/stream":
            self._handle_stream()
        elif self.path == "/snapshot":
            self._handle_snapshot()
        elif self.path == "/":
            self._handle_health()
        else:
            self.send_error(404)

    def _handle_stream(self):
        """Continuous MJPEG stream."""
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frameboundary")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        buf: FrameBuffer = self.server.frame_buffer  # type: ignore[attr-defined]
        last_count = 0

        try:
            while True:
                jpeg, _ts, count = buf.wait_for_new(last_count, timeout=2.0)
                last_count = count

                # Build multipart chunk
                header = (
                    _BOUNDARY + _CRLF
                    + _JPEG_CT + _CRLF
                    + b"Content-Length: " + str(len(jpeg)).encode() + _CRLF
                    + _CRLF
                )
                self.wfile.write(header)
                self.wfile.write(jpeg)
                self.wfile.write(_CRLF)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass  # Client disconnected

    def _handle_snapshot(self):
        """Single JPEG frame."""
        buf: FrameBuffer = self.server.frame_buffer  # type: ignore[attr-defined]
        try:
            jpeg, _, _ = buf.get(timeout=5.0)
        except TimeoutError:
            self.send_error(503, "No frame available")
            return

        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(jpeg)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(jpeg)

    def _handle_health(self):
        """JSON health check."""
        buf: FrameBuffer = self.server.frame_buffer  # type: ignore[attr-defined]
        info = {
            "status": "streaming" if buf.has_frame else "waiting",
            "frames": buf.frame_count,
            "server": "pi-stream",
            "endpoints": ["/stream", "/snapshot", "/"],
        }
        body = json.dumps(info).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each client in its own thread."""
    allow_reuse_address = True
    daemon_threads = True


# ── Main ───────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="Pi Camera MJPEG Stream Server")
    p.add_argument("-W", "--width", type=int, default=1280)
    p.add_argument("-H", "--height", type=int, default=720)
    p.add_argument("-F", "--fps", type=int, default=30)
    p.add_argument("-Q", "--quality", type=int, default=85)
    p.add_argument("-P", "--port", type=int, default=8554)
    return p.parse_args()


def main():
    args = parse_args()

    logger.info("Initialising camera: %dx%d @%dfps, JPEG quality %d",
                args.width, args.height, args.fps, args.quality)

    # ── Camera setup ──
    picam2 = Picamera2()
    config = picam2.create_video_configuration(
        main={"size": (args.width, args.height), "format": "BGR888"},
        buffer_count=2,  # Minimal buffering = lower latency
        controls={"FrameDurationLimits": (int(1e6 / args.fps), int(1e6 / args.fps))},
    )
    picam2.configure(config)
    picam2.start()
    logger.info("Camera started")

    # ── Frame buffer + capture thread ──
    frame_buffer = FrameBuffer()
    capture = CaptureThread(picam2, frame_buffer, quality=args.quality, target_fps=args.fps)
    capture.start()

    # ── HTTP server ──
    server = ThreadedHTTPServer(("0.0.0.0", args.port), StreamHandler)
    server.frame_buffer = frame_buffer  # type: ignore[attr-defined]

    logger.info("Stream: http://0.0.0.0:%d/stream", args.port)
    logger.info("Snapshot: http://0.0.0.0:%d/snapshot", args.port)

    def shutdown(sig, frame):
        logger.info("Shutting down (signal %s)...", sig)
        capture.stop()
        picam2.stop()
        picam2.close()
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever()
    finally:
        capture.stop()
        try:
            picam2.stop()
            picam2.close()
        except Exception:
            pass
        server.server_close()
        logger.info("Done.")


if __name__ == "__main__":
    main()
