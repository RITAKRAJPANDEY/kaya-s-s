"""Unified frame source for webcam, video file, and image file input.

Provides a single ``FrameSource`` class that normalises all three source
types behind an iterator interface, with thread-based capture to decouple
acquisition FPS from inference FPS.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from typing import Iterator, Optional, Union

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Supported file extensions (lowercase)
_VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


class FrameSource:
    """Unified frame source supporting webcam, video file, and single image.

    Usage::

        with FrameSource(0) as src:            # webcam
            for frame, ts, idx in src:
                ...

        with FrameSource("video.mp4") as src:  # video file
            for frame, ts, idx in src:
                ...

        with FrameSource("photo.jpg") as src:  # single image (repeats)
            for frame, ts, idx in src:
                ...
    """

    def __init__(
        self,
        source: Union[int, str],
        resolution: tuple[int, int] = (1280, 720),
        max_fps: float = 30.0,
    ) -> None:
        self._source = source
        self._resolution = resolution
        self._max_fps = max_fps
        self._min_frame_interval = 1.0 / max_fps if max_fps > 0 else 0.0

        # State
        self._cap: Optional[cv2.VideoCapture] = None
        self._image: Optional[np.ndarray] = None
        self._is_webcam = False
        self._is_video = False
        self._is_image = False
        self._is_stream = False
        self._opened = False

        # Threading
        self._frame_queue: queue.Queue[
            Optional[tuple[np.ndarray, float, int]]
        ] = queue.Queue(maxsize=2)
        self._capture_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._frame_counter = 0

        self._detect_source_type()

    # ── Source type detection ─────────────────────────────────

    def _detect_source_type(self) -> None:
        """Classify the source as webcam, video, image, or network stream."""
        if isinstance(self._source, int):
            self._is_webcam = True
            logger.info("Source type: webcam (device %d)", self._source)
        elif isinstance(self._source, str):
            lower = self._source.lower()
            if lower.startswith(("http://", "https://", "rtsp://")):
                self._is_stream = True
                logger.info("Source type: network stream (%s)", self._source)
            else:
                ext = os.path.splitext(self._source)[1].lower()
                if ext in _VIDEO_EXTS:
                    self._is_video = True
                    logger.info("Source type: video file (%s)", self._source)
                elif ext in _IMAGE_EXTS:
                    self._is_image = True
                    logger.info("Source type: image file (%s)", self._source)
                else:
                    # Best-effort: try as video
                    self._is_video = True
                    logger.warning(
                        "Unknown extension '%s' — treating as video file", ext
                    )
        else:
            raise TypeError(
                f"source must be int (webcam) or str (file path/URL), "
                f"got {type(self._source).__name__}"
            )

    # ── Opening / Closing ─────────────────────────────────────

    def open(self) -> "FrameSource":
        """Open the underlying source and start the capture thread."""
        if self._opened:
            return self

        if self._is_image:
            self._open_image()
        else:
            self._open_capture()

        self._opened = True
        self._stop_event.clear()

        # Start background capture thread
        self._capture_thread = threading.Thread(
            target=self._capture_loop, daemon=True, name="FrameCapture"
        )
        self._capture_thread.start()
        return self

    def _open_image(self) -> None:
        """Load a single image from disk."""
        img = cv2.imread(str(self._source))
        if img is None:
            raise FileNotFoundError(
                f"Cannot read image: {self._source}"
            )
        # Resize to target resolution
        h, w = img.shape[:2]
        target_w, target_h = self._resolution
        if (w, h) != (target_w, target_h):
            img = cv2.resize(img, (target_w, target_h))
        self._image = img
        logger.info(
            "Image loaded: %s — resolution %dx%d",
            self._source,
            self._image.shape[1],
            self._image.shape[0],
        )

    def _open_capture(self) -> None:
        """Open a VideoCapture for webcam, video file, or network stream."""
        if self._is_stream:
            # For MJPEG streams: use FFMPEG backend with low-latency flags
            self._cap = cv2.VideoCapture(self._source, cv2.CAP_FFMPEG)
            # Minimise internal buffering for lower latency
            self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        else:
            self._cap = cv2.VideoCapture(self._source)

        if not self._cap.isOpened():
            raise IOError(f"Cannot open video source: {self._source}")

        if self._is_webcam:
            target_w, target_h = self._resolution
            self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, target_w)
            self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, target_h)
        # Note: for streams, resolution is controlled by the server

        actual_w = int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        actual_fps = self._cap.get(cv2.CAP_PROP_FPS) or 0.0
        total_frames = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT))

        if self._is_stream:
            source_label = "stream"
        elif self._is_webcam:
            source_label = "webcam"
        else:
            source_label = "video"
        logger.info(
            "%s opened: %dx%d @ %.1f FPS, total frames: %s",
            source_label.capitalize(),
            actual_w,
            actual_h,
            actual_fps,
            total_frames if total_frames > 0 else "N/A (live)",
        )

    def close(self) -> None:
        """Stop capture thread and release resources."""
        self._stop_event.set()

        if self._capture_thread is not None and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=3.0)
            self._capture_thread = None

        if self._cap is not None:
            self._cap.release()
            self._cap = None

        self._image = None
        self._opened = False

        # Drain the queue
        while not self._frame_queue.empty():
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                break

        logger.info("FrameSource closed")

    # ── Context manager ───────────────────────────────────────

    def __enter__(self) -> "FrameSource":
        return self.open()

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def __del__(self) -> None:
        if self._opened:
            self.close()

    # ── Capture thread ────────────────────────────────────────

    def _capture_loop(self) -> None:
        """Background thread that reads frames and pushes to the queue."""
        last_frame_time = 0.0

        while not self._stop_event.is_set():
            try:
                if self._is_image:
                    self._capture_image_frame(last_frame_time)
                else:
                    self._capture_video_frame()
                last_frame_time = time.monotonic()
            except Exception:
                logger.exception("Error in capture loop")
                break

        # Signal consumer that capture has ended
        try:
            self._frame_queue.put(None, timeout=1.0)
        except queue.Full:
            pass

    def _capture_image_frame(self, last_frame_time: float) -> None:
        """Push the cached image as a frame, respecting max_fps."""
        elapsed = time.monotonic() - last_frame_time
        sleep_time = self._min_frame_interval - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)

        self._frame_counter += 1
        frame_data = (self._image.copy(), time.time(), self._frame_counter)
        try:
            self._frame_queue.put(frame_data, timeout=0.5)
        except queue.Full:
            # Drop frame — consumer is slower than producer
            pass

    def _capture_video_frame(self) -> None:
        """Read a frame from VideoCapture, respecting max_fps for files."""
        t_start = time.monotonic()

        ret, frame = self._cap.read()
        if not ret:
            if self._is_stream:
                # Network stream: attempt reconnection
                logger.warning("Stream read failed, reconnecting in 1s…")
                time.sleep(1.0)
                try:
                    self._cap.release()
                    self._cap = cv2.VideoCapture(
                        self._source, cv2.CAP_FFMPEG
                    )
                    self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    if self._cap.isOpened():
                        logger.info("Stream reconnected")
                    else:
                        logger.warning("Stream reconnect failed")
                except Exception:
                    logger.exception("Error during stream reconnect")
                return
            elif self._is_video:
                logger.info("End of video file reached")
                self._stop_event.set()
                return
            else:
                # Webcam: transient read failure
                logger.warning("Webcam read failed, retrying…")
                time.sleep(0.01)
                return

        self._frame_counter += 1
        frame_data = (frame, time.time(), self._frame_counter)

        try:
            self._frame_queue.put_nowait(frame_data)
        except queue.Full:
            # Queue full — drop oldest frame to ensure real-time live stream
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self._frame_queue.put_nowait(frame_data)
            except queue.Full:
                pass

        # Throttle video files to max_fps (not streams — they self-throttle)
        if self._is_video and self._min_frame_interval > 0:
            elapsed = time.monotonic() - t_start
            sleep_time = self._min_frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    # ── Iterator protocol ─────────────────────────────────────

    def __iter__(self) -> Iterator[tuple[np.ndarray, float, int]]:
        if not self._opened:
            self.open()
        return self

    def __next__(self) -> tuple[np.ndarray, float, int]:
        try:
            item = self._frame_queue.get(timeout=10.0)
        except queue.Empty:
            raise StopIteration("Frame queue timeout — source may have ended")

        if item is None:
            raise StopIteration
        return item
