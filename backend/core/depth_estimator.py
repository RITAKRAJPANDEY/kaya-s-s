import logging
import threading
import time
from typing import Optional, Tuple
import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

logger = logging.getLogger("core.depth_estimator")


class DepthEstimator:
    def __init__(self, config: dict, device_override: Optional[str] = None):
        self.config = config
        self.enabled = config.get("enabled", True)
        self.model_path = config.get("path", "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf")
        self.is_metric = bool(config.get("is_metric", "metric" in self.model_path.lower()))
        self.scale_factor = float(config.get("scale_factor", 1.0 if self.is_metric else 15.0))
        self.run_every_n = int(config.get("run_every_n_frames", 3))

        if not self.enabled:
            logger.info("Depth Estimation is disabled in configuration.")
            return

        # Device selection
        if device_override:
            dev_str = str(device_override).lower()
            if dev_str in ("0", "cuda") or dev_str.startswith("cuda:"):
                self.device = "cuda"
            else:
                self.device = "cpu" if dev_str == "cpu" else str(device_override)
        else:
            from core.device import get_device
            self.device = get_device("auto")

        logger.info(
            "Loading monocular depth estimation model '%s' (metric=%s) on device '%s'...",
            self.model_path,
            self.is_metric,
            self.device
        )
        start_time = time.time()
        try:
            self.processor = AutoImageProcessor.from_pretrained(self.model_path)
            dtype = torch.float16 if self.device == "cuda" else torch.float32
            self.model = AutoModelForDepthEstimation.from_pretrained(
                self.model_path,
                torch_dtype=dtype
            ).to(self.device)
            self.model.eval()
            logger.info("Depth model loaded in %.2fs (dtype=%s)", time.time() - start_time, dtype)
        except Exception as e:
            logger.error("Failed to load depth model: %s. Disabling depth estimation.", e)
            self.enabled = False

        # Async background worker thread
        self._latest_depth_map: Optional[np.ndarray] = None
        self._depth_lock = threading.Lock()
        self._depth_cond = threading.Condition()
        self._pending_frame: Optional[np.ndarray] = None
        self._worker_running = True
        self._worker_thread = threading.Thread(target=self._async_worker_loop, daemon=True)
        self._worker_thread.start()

    def _async_worker_loop(self) -> None:
        while self._worker_running:
            with self._depth_cond:
                while self._pending_frame is None and self._worker_running:
                    self._depth_cond.wait()
                if not self._worker_running:
                    break
                frame = self._pending_frame
                self._pending_frame = None

            dmap = self.estimate(frame)
            if dmap is not None:
                with self._depth_lock:
                    self._latest_depth_map = dmap

    def submit_async(self, frame: np.ndarray) -> None:
        """Submit a frame for non-blocking background depth estimation."""
        if not self.enabled:
            return
        with self._depth_cond:
            self._pending_frame = frame.copy()
            self._depth_cond.notify()

    def get_latest_depth_map(self) -> Optional[np.ndarray]:
        """Fetch the most recent depth map produced by the background thread."""
        with self._depth_lock:
            return self._latest_depth_map

    def estimate(self, frame: np.ndarray) -> Optional[np.ndarray]:
        """Runs depth estimation on a single frame (BGR numpy array).
        Returns a single-channel 2D numpy array representing the predicted depth map,
        resized to match the original frame dimensions.
        """
        if not self.enabled or frame is None:
            return None

        try:
            h_orig, w_orig = frame.shape[:2]

            # Downscale for faster inference — depth maps are resized back anyway
            max_dim = 384
            scale = min(max_dim / w_orig, max_dim / h_orig)
            if scale < 1.0:
                new_w, new_h = int(w_orig * scale), int(h_orig * scale)
                small_frame = cv2.resize(frame, (new_w, new_h))
            else:
                small_frame = frame

            # Convert BGR (OpenCV) to RGB (PIL)
            rgb_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb_frame)

            inputs = self.processor(images=pil_image, return_tensors="pt")
            if self.device == "cuda":
                inputs = {k: v.to(self.device).half() if v.is_floating_point() else v.to(self.device) for k, v in inputs.items()}
            else:
                inputs = {k: v.to(self.device) for k, v in inputs.items()}

            with torch.inference_mode():
                outputs = self.model(**inputs)
                predicted_depth = outputs.predicted_depth

            # Remove batch dimension
            depth_map = predicted_depth.squeeze(0).float().cpu().numpy()

            # Resize depth map back to the original image dimensions
            depth_map_resized = cv2.resize(depth_map, (w_orig, h_orig), interpolation=cv2.INTER_LINEAR)
            return depth_map_resized
        except Exception as e:
            logger.warning("Error during depth estimation: %s", e)
            return None

    def get_distance(self, bbox: Tuple[int, int, int, int], depth_map: np.ndarray) -> Optional[float]:
        """Calculates the estimated metric distance (in meters) to the object in the bbox.

        Uses foreground-focused core sampling (inner 50% box and 25th-35th percentile)
        to isolate the object/person from background walls and clutter.
        """
        if depth_map is None:
            return None

        h, w = depth_map.shape[:2]
        x1, y1, x2, y2 = bbox

        # Clip bbox to depth map boundaries
        x1 = max(0, min(w - 1, int(x1)))
        y1 = max(0, min(h - 1, int(y1)))
        x2 = max(0, min(w - 1, int(x2)))
        y2 = max(0, min(h - 1, int(y2)))

        # Ensure valid area
        if x2 <= x1 or y2 <= y1:
            return None

        # Sample the inner 50% core of the bounding box to avoid background edge bleeding
        cx = (x1 + x2) // 2
        cy = (y1 + y2) // 2
        bw = max(2, int((x2 - x1) * 0.5))
        bh = max(2, int((y2 - y1) * 0.5))

        cx1 = max(0, min(w - 1, cx - bw // 2))
        cx2 = max(0, min(w - 1, cx + bw // 2))
        cy1 = max(0, min(h - 1, cy - bh // 2))
        cy2 = max(0, min(h - 1, cy + bh // 2))

        crop = depth_map[cy1:cy2, cx1:cx2]
        if crop.size == 0:
            crop = depth_map[y1:y2, x1:x2]

        if crop.size == 0:
            return None

        # Filter out invalid / zero / inf values
        valid_mask = (crop > 0.05) & ~np.isnan(crop) & ~np.isinf(crop)
        valid_depths = crop[valid_mask]

        if valid_depths.size == 0:
            return None

        if self.is_metric:
            # For metric depth: lower values = closer (in meters).
            # The 25th-30th percentile represents the closest prominent foreground surface of the object.
            foreground_metric = float(np.percentile(valid_depths, 25))
            distance = foreground_metric * self.scale_factor
        else:
            # For relative disparity: higher values = closer.
            # The 75th percentile represents the closest prominent foreground surface.
            foreground_relative = float(np.percentile(valid_depths, 75))
            if foreground_relative <= 1e-3:
                return None
            distance = self.scale_factor / foreground_relative

        return round(float(distance), 1)
