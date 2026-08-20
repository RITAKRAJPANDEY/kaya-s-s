"""Thread-Safe Bridge between Safety Copilot Computer Vision Pipeline and Web API."""

from __future__ import annotations

import asyncio
import io
import logging
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np
from PIL import Image

logger = logging.getLogger("kaya.copilot_bridge")


class CopilotBridge:
    """Singleton bridge managing background SafetyCopilot execution and video streaming."""

    _instance: Optional[CopilotBridge] = None

    def __new__(cls) -> CopilotBridge:
        if cls._instance is None:
            cls._instance = super(CopilotBridge, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return

        self._initialized = True
        self._lock = threading.Lock()
        self._running = False
        self._copilot_thread: Optional[threading.Thread] = None

        # Live Frame State
        self._latest_jpeg: Optional[bytes] = None
        self._latest_raw_frame: Optional[np.ndarray] = None
        self._latest_result: Any = None
        self._latest_depth_map: Optional[np.ndarray] = None
        self._overlay_renderer: Optional[Any] = None
        self._mode_cache: Dict[str, bytes] = {}
        self._latest_timestamp: float = 0.0
        self._fps: float = 0.0
        self._tracked_count: int = 0
        self._hazards_count: int = 0
        self._active_objects_summary: List[str] = []

        # Rolling 1-FPS Temporal Ring Buffer (for VLM questions)
        self._temporal_ring_buffer: List[Tuple[bytes, float]] = []
        self._max_temporal_seconds: float = 8.0
        self._last_temporal_sample_time: float = 0.0

        # Copilot instance reference
        self.copilot_instance = None

    def update_frame(
        self,
        display_frame: np.ndarray,
        raw_frame: Optional[np.ndarray] = None,
        frame_result: Any = None,
        depth_map: Optional[np.ndarray] = None,
        overlay_renderer: Optional[Any] = None,
        fps: float = 0.0
    ) -> None:
        """Called by SafetyCopilot on every processed frame."""
        try:
            # Encode annotated display frame to JPEG
            _, jpeg_buf = cv2.imencode(".jpg", display_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            jpeg_bytes = jpeg_buf.tobytes()

            now = time.time()

            # Extract metrics from FrameResult
            tracked_cnt = 0
            hazards_cnt = 0
            summary_list = []

            if frame_result is not None:
                tracked_objects = getattr(frame_result, "tracked_objects", {})
                tracked_cnt = sum(1 for obj in tracked_objects.values() if getattr(obj, "is_active", True))
                hazards = getattr(frame_result, "hazards", [])
                hazards_cnt = len(hazards)

                for obj in list(tracked_objects.values())[:6]:
                    dist_str = f"{obj.distance_meters:.1f}m" if getattr(obj, "distance_meters", None) else "N/A"
                    status = "Safe"
                    if getattr(obj, "distance_meters", 10.0) < 1.0:
                        status = "Critical"
                    elif getattr(obj, "distance_meters", 10.0) < 2.5:
                        status = "Warning"
                        
                    summary_list.append({
                        "id": str(getattr(obj, "track_id", "unknown")),
                        "type": getattr(obj, "class_name", "unknown"),
                        "distance": dist_str,
                        "status": status,
                        "confidence": getattr(obj, "confidence", 1.0)
                    })

                hazards_list = []
                for hazard in getattr(frame_result, "hazards", []):
                    hazards_list.append({
                        "id": str(getattr(hazard, "id", "unknown")),
                        "type": getattr(hazard, "type", "Unknown Hazard"),
                        "description": getattr(hazard, "description", ""),
                        "severity": getattr(hazard, "severity", "WARNING").upper()
                    })

            with self._lock:
                self._latest_jpeg = jpeg_bytes
                self._latest_raw_frame = raw_frame.copy() if raw_frame is not None else None
                self._latest_result = frame_result
                self._latest_depth_map = depth_map
                if overlay_renderer is not None:
                    self._overlay_renderer = overlay_renderer
                self._mode_cache.clear()
                self._mode_cache["all"] = jpeg_bytes

                self._latest_timestamp = now
                self._fps = fps
                self._tracked_count = tracked_cnt
                self._hazards_count = hazards_cnt
                self._active_objects_summary = summary_list
                self._active_hazards_summary = hazards_list

                # Sample into temporal buffer at ~1 FPS
                if now - self._last_temporal_sample_time >= 1.0:
                    self._temporal_ring_buffer.append((jpeg_bytes, now))
                    self._last_temporal_sample_time = now

                    # Evict frames older than max_temporal_seconds
                    cutoff = now - self._max_temporal_seconds
                    self._temporal_ring_buffer = [
                        (b, t) for b, t in self._temporal_ring_buffer if t >= cutoff
                    ]

        except Exception as e:
            logger.debug(f"Error in CopilotBridge.update_frame: {e}")

    def get_latest_jpeg(self, mode: str = "all") -> Optional[bytes]:
        """Return the latest frame JPEG bytes rendered in the selected view mode."""
        mode_clean = (mode or "all").lower().strip()
        with self._lock:
            if mode_clean in self._mode_cache:
                return self._mode_cache[mode_clean]

            if self._latest_raw_frame is None or self._latest_result is None:
                return self._latest_jpeg

            try:
                # If raw mode requested
                if mode_clean == "raw":
                    _, raw_buf = cv2.imencode(".jpg", self._latest_raw_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    encoded = raw_buf.tobytes()
                    self._mode_cache["raw"] = encoded
                    return encoded

                # Render with OverlayRenderer
                if self._overlay_renderer is not None:
                    rendered = self._overlay_renderer.render(
                        self._latest_raw_frame,
                        self._latest_result,
                        mode=mode_clean
                    )
                    _, buf = cv2.imencode(".jpg", rendered, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    encoded = buf.tobytes()
                    self._mode_cache[mode_clean] = encoded
                    return encoded
            except Exception as ex:
                logger.debug(f"Error generating mode '{mode_clean}' JPEG: {ex}")

            return self._latest_jpeg

    def get_latest_temporal_frames(self, max_frames: int = 8) -> List[Tuple[bytes, str]]:
        """Return recent chronological sequence of frames as (bytes, 'image/jpeg') tuples."""
        with self._lock:
            if not self._temporal_ring_buffer:
                if self._latest_jpeg:
                    return [(self._latest_jpeg, "image/jpeg")]
                return []

            selected = self._temporal_ring_buffer[-max_frames:]
            return [(b, "image/jpeg") for b, _ in selected]

    def get_latest_pose_data(self) -> Dict[str, Any]:
        """Return latest pose keypoints + sampled depth values for the 3D viewer."""
        with self._lock:
            result = self._latest_result
            dmap = self._latest_depth_map

        if result is None:
            return {"poses": [], "frame_width": 1280, "frame_height": 720}

        poses_out = []
        poses = getattr(result, "poses", []) or []
        for pose in poses:
            kps = pose.keypoints
            if kps is None or len(kps) < 17:
                continue
            kp_list = []
            for idx, (x, y, conf) in enumerate(kps):
                # Sample depth at this keypoint if map available
                depth_val = None
                if dmap is not None and isinstance(dmap, np.ndarray):
                    h_d, w_d = dmap.shape[:2]
                    px = int(min(max(x, 0), w_d - 1))
                    py = int(min(max(y, 0), h_d - 1))
                    raw = float(dmap[py, px])
                    if raw > 0.01:
                        depth_val = round(raw, 3)
                kp_list.append({
                    "x": round(float(x), 1),
                    "y": round(float(y), 1),
                    "conf": round(float(conf), 3),
                    "depth": depth_val,
                })
            poses_out.append({
                "track_id": int(pose.person_track_id) if pose.person_track_id is not None else None,
                "keypoints": kp_list,
                "head_yaw":   round(float(pose.head_yaw),  2) if pose.head_yaw  is not None else None,
                "body_angle": round(float(pose.body_angle), 2) if pose.body_angle is not None else None,
            })

        return {
            "poses": poses_out,
            "frame_width": 1280,
            "frame_height": 720,
        }


    def get_status(self) -> Dict[str, Any]:
        """Return current status of the copilot bridge."""
        with self._lock:
            is_active = self._running and (time.time() - self._latest_timestamp < 3.0)
            return {
                "active": is_active,
                "fps": round(self._fps, 1),
                "tracked_count": self._tracked_count,
                "hazards_count": self._hazards_count,
                "objects_summary": self._active_objects_summary,
                "active_hazards": getattr(self, "_active_hazards_summary", []),
                "buffer_frames_count": len(self._temporal_ring_buffer)
            }

    async def get_video_frame_stream(self, mode: str = "all"):
        """Async generator yielding MJPEG multipart stream chunks for a specific view mode."""
        boundary = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n"
        blank_frame = None

        while True:
            jpeg = self.get_latest_jpeg(mode=mode)
            if jpeg is None:
                if blank_frame is None:
                    img = np.zeros((480, 640, 3), dtype=np.uint8)
                    cv2.putText(
                        img, "Initializing Safety Copilot...", (80, 240),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA
                    )
                    _, buf = cv2.imencode(".jpg", img)
                    blank_frame = buf.tobytes()
                jpeg = blank_frame

            yield boundary + jpeg + b"\r\n"
            await asyncio.sleep(0.033)  # ~30 FPS stream

    def start_background_copilot(
        self,
        source: Any = 0,
        config_path: str = "config.yaml"
    ) -> None:
        """Start SafetyCopilot in a dedicated background worker thread."""
        if self._running:
            logger.info("SafetyCopilot background worker is already running.")
            return

        def _worker():
            try:
                from main import load_config, SafetyCopilot
                config = load_config(config_path)
                copilot = SafetyCopilot(config)
                self.copilot_instance = copilot

                # Wire bridge hook into copilot loop
                original_process_frame = copilot._process_frame

                def _hooked_process_frame(frame, timestamp, frame_number):
                    result = original_process_frame(frame, timestamp, frame_number)
                    try:
                        latest_dmap = getattr(result, "depth_map", None)
                        display_frame = copilot.overlay_renderer.render(frame, result, mode="all")
                        self.update_frame(
                            display_frame=display_frame,
                            raw_frame=frame,
                            frame_result=result,
                            depth_map=latest_dmap,
                            overlay_renderer=copilot.overlay_renderer,
                            fps=copilot._current_fps
                        )
                    except Exception as ex:
                        logger.debug(f"Error rendering overlay for bridge: {ex}")
                    return result

                copilot._process_frame = _hooked_process_frame

                self._running = True
                logger.info("SafetyCopilot background engine started successfully.")
                copilot.run(source=source, no_display=True, no_voice=False)

            except Exception as e:
                logger.error(f"Error in SafetyCopilot background worker: {e}")
            finally:
                self._running = False
                logger.info("SafetyCopilot background worker stopped.")

        self._copilot_thread = threading.Thread(
            target=_worker,
            name="SafetyCopilotWorker",
            daemon=True
        )
        self._copilot_thread.start()

    def stop(self) -> None:
        """Stop background worker if active."""
        self._running = False
        if self.copilot_instance:
            try:
                self.copilot_instance.stop()
            except Exception:
                pass


# Global singleton instance
copilot_bridge = CopilotBridge()
