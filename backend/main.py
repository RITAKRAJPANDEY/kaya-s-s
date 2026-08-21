"""Job Site Safety Copilot — Tier 1

Real-time construction-site safety assistant running fully offline on Apple Silicon.
Uses YOLO26 for detection + tracking, YOLO26-pose for keypoint/gaze estimation,
with a novel attention-escalation system.
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import time
import warnings
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Suppress NumPy runtime warnings raised internally by the Ultralytics tracker during ReID matching
warnings.filterwarnings("ignore", message=".*divide by zero encountered in matmul.*")
warnings.filterwarnings("ignore", message=".*overflow encountered in matmul.*")
warnings.filterwarnings("ignore", message=".*invalid value encountered in matmul.*")
warnings.filterwarnings("ignore", message=".*'half' is deprecated.*")

import cv2
import numpy as np
import yaml
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

from core.device import get_device, log_device_info
from core.models import (
    DangerZone,
    Detection,
    FrameResult,
    HazardAssessment,
    HazardState,
    Severity,
    TrackedObject,
)
from core.capture import FrameSource
from core.detector import Detector
from core.pose_estimator import PoseEstimator
from safety.zones import ZoneManager
from safety.ppe_checker import PPEChecker
from safety.fall_detector import FallDetector
from safety.hazard_analyzer import HazardAnalyzer
from safety.attention_tracker import AttentionTracker
from alerts.tts_engine import TTSEngine
from alerts.alert_manager import AlertManager
from logging_.event_logger import EventLogger
from display.overlay import OverlayRenderer
from integration.vlm_hook import VLMHook
from core.depth_estimator import DepthEstimator

logger = logging.getLogger("safety_copilot")


def load_config(config_path: str = "config.yaml") -> dict:
    """Load configuration from YAML file with defaults."""
    default_config = {
        "models": {
            "general": {"path": "yolo26n.pt", "confidence": 0.40, "iou": 0.50},
            "ppe": {"path": None, "confidence": 0.35, "iou": 0.45},
            "pose": {
                "path": "yolo26n-pose.pt",
                "confidence": 0.40,
                "run_every_n_frames": 3,
            },
        },
        "device": {"preferred": "auto"},
        "capture": {"webcam_id": 0, "resolution": [1280, 720], "max_fps": 30},
        "tracking": {"tracker": "models/botsort_reid.yaml", "persist": True},
        "escalation": {
            "dwell_threshold_seconds": 4.0,
            "gaze_angle_tolerance_degrees": 45.0,
            "escalation_cooldown_seconds": 10.0,
            "acknowledgment_gaze_duration_seconds": 0.5,
        },
        "fall_detection": {
            "body_angle_threshold_degrees": 30.0,
            "velocity_threshold_px_per_frame": 15.0,
            "confirmation_frames": 2,
            "alert_cooldown_seconds": 15.0,
        },
        "alerts": {
            "enabled": True,
            "voice": "Samantha",
            "rates": {"calm": 160, "normal": 180, "urgent": 220, "critical": 240},
            "cooldown_seconds": 5.0,
            "max_concurrent": 1,
        },
        "logging": {"database_path": "data/events.db", "log_level": "INFO"},
        "vlm": {
            "enabled": True,
            "backend": "moondream",
            "api_url": "http://localhost:11434/api/chat",
            "model": "gemma4:cloud",
            "background_polling": True,
            "fps": 0.25,
            "prediction_alert_threshold": 0.65,
            "moondream": {
                "model_id": "vikhyatk/moondream2",
                "revision": None,
                "device": "auto",
                "dtype": "float16",
                "max_image_size": 448,
            },
            "system_prompt": (
                "You are a construction safety reasoning assistant. "
                "Use scene graph state first, vision only when necessary, and mark predictions as predictions."
            ),
            "reasoning": {
                "reason_every_seconds": 4.0,
                "state_change_cooldown_seconds": 1.5,
                "memory_items": 200,
                "checklist_hold_frames": 6,
                "expected_items": [],
                "scene_graph": {
                    "tool_labels": [
                        "cell_phone",
                        "drill",
                        "hammer",
                        "saw",
                        "measuring_tape",
                        "tool",
                    ],
                    "structure_labels": [
                        "scaffold",
                        "beam",
                        "column",
                        "wall",
                        "door",
                        "window",
                        "ladder",
                    ],
                },
                "documents": {
                    "directory": "data/documents",
                    "index_path": "data/indexes/documents_index.json",
                    "embedding_model": "nomic-embed-text",
                    "embed_api_url": "http://localhost:11434/api/embed",
                    "force_embeddings": False,
                    "direct_doc_limit": 6,
                    "direct_char_limit": 48000,
                    "top_k": 4,
                },
                "blueprints": {
                    "directory": "data/blueprints",
                    "render_directory": "data/blueprints/rendered",
                    "max_pdf_pages": 2,
                },
                "spatial_memory": {
                    "grid_rows": 3,
                    "grid_cols": 3,
                    "history_limit": 200,
                },
            },
        },
        "display": {
            "show_fps": True,
            "show_keypoints": True,
            "show_gaze_lines": True,
            "show_zones": True,
            "show_alert_banner": True,
            "show_track_ids": True,
            "window_name": "Safety Copilot",
            "bbox_colors": {
                "person": [0, 255, 0],
                "vehicle": [0, 255, 255],
                "ppe_ok": [0, 200, 0],
                "ppe_missing": [0, 0, 255],
                "hazard": [0, 0, 255],
                "zone": [0, 165, 255],
            },
            "zone_alpha": 0.25,
        },
        "zones": {"default": []},
    }

    config_file = Path(config_path)
    if config_file.exists():
        with open(config_file) as f:
            user_config = yaml.safe_load(f) or {}
        # Deep merge user config into defaults
        _deep_merge(default_config, user_config)
        logger.info("Loaded config from %s", config_path)
    else:
        logger.warning("Config file %s not found, using defaults", config_path)

    return default_config


def _deep_merge(base: dict, override: dict) -> None:
    """Recursively merge override into base dict (in-place)."""
    for key, value in override.items():
        if key in base and isinstance(base[key], dict) and isinstance(value, dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


class SafetyCopilot:
    """Main pipeline orchestrator for the Job Site Safety Copilot."""

    def __init__(self, config: dict):
        self.config = config
        self._running = False

        # ── Device Selection ─────────────────────────────────
        log_device_info()
        self.device = get_device(config["device"]["preferred"], for_ultralytics=True)

        # ── Core Pipeline ────────────────────────────────────
        models_cfg = config["models"]
        tool_cfg = models_cfg.get("tool", {})
        general_cfg = models_cfg.get("general", {})
        self.detector = Detector(
            general_model_path=general_cfg.get("path"),
            ppe_model_path=models_cfg["ppe"]["path"],
            device=self.device,
            tracker_config=config["tracking"]["tracker"],
            general_conf=general_cfg.get("confidence", 0.30),
            general_iou=general_cfg.get("iou", 0.45),
            general_classes=general_cfg.get("classes"),
            ppe_conf=models_cfg["ppe"]["confidence"],
            ppe_iou=models_cfg["ppe"]["iou"],
            ppe_api_key=models_cfg["ppe"].get("api_key"),
            tool_model_path=tool_cfg.get("path") if tool_cfg.get("enabled") else None,
            tool_conf=tool_cfg.get("confidence", 0.20),
            tool_iou=tool_cfg.get("iou", 0.45),
            tool_classes=tool_cfg.get("classes"),
        )

        self.pose_estimator = PoseEstimator(
            model_path=models_cfg["pose"]["path"],
            device=self.device,
            confidence=models_cfg["pose"]["confidence"],
            run_every_n=models_cfg["pose"]["run_every_n_frames"],
        )

        # ── Safety Logic ─────────────────────────────────────
        self.zone_manager = ZoneManager()
        if config["zones"].get("default"):
            self.zone_manager.load_from_config(config["zones"]["default"])

        self.ppe_checker = PPEChecker()

        fall_cfg = config["fall_detection"]
        self.fall_detector = FallDetector(
            body_angle_threshold=fall_cfg["body_angle_threshold_degrees"],
            velocity_threshold=fall_cfg["velocity_threshold_px_per_frame"],
            confirmation_frames=fall_cfg["confirmation_frames"],
            cooldown_seconds=fall_cfg["alert_cooldown_seconds"],
        )

        self.hazard_analyzer = HazardAnalyzer(
            zone_manager=self.zone_manager,
            ppe_checker=self.ppe_checker,
            fall_detector=self.fall_detector,
            perspective=config.get("perspective", "third_person"),
            resolution=config["capture"]["resolution"],
        )

        esc_cfg = config["escalation"]
        self.attention_tracker = AttentionTracker(
            dwell_threshold=esc_cfg["dwell_threshold_seconds"],
            gaze_angle_tolerance=esc_cfg["gaze_angle_tolerance_degrees"],
            escalation_cooldown=esc_cfg["escalation_cooldown_seconds"],
            ack_gaze_duration=esc_cfg["acknowledgment_gaze_duration_seconds"],
            perspective=config.get("perspective", "third_person"),
            resolution=config["capture"]["resolution"],
        )

        # ── Alerts ───────────────────────────────────────────
        alert_cfg = config["alerts"]
        self.tts_engine = TTSEngine(
            voice=alert_cfg["voice"],
            rates=alert_cfg["rates"],
            max_concurrent=alert_cfg["max_concurrent"],
            cooldown_seconds=alert_cfg["cooldown_seconds"],
        )

        self.alert_manager = AlertManager(
            tts_engine=self.tts_engine,
            enabled=alert_cfg["enabled"],
            cooldown_seconds=alert_cfg["cooldown_seconds"],
            perspective=config.get("perspective", "third_person"),
            resolution=config["capture"]["resolution"],
        )

        # ── Logging ──────────────────────────────────────────
        self.event_logger = EventLogger(
            db_path=config["logging"]["database_path"],
        )

        # ── Display ──────────────────────────────────────────
        self.overlay_renderer = OverlayRenderer(config["display"])

        # ── VLM Hook (Part 2) ───────────────────────────
        self.vlm_hook = VLMHook(config.get("vlm", {}), event_logger=self.event_logger)

        # ── Depth Estimation ─────────────────────────────────
        self.depth_estimator = DepthEstimator(
            models_cfg.get("depth", {}), device_override=self.device
        )
        self._current_depth_map = None

        # ── Tracking State ───────────────────────────────────
        self._tracked_objects: dict[int, TrackedObject] = {}
        
        # ── VLM State ────────────────────────────────────────
        vlm_fps = config.get("vlm", {}).get("fps", 1.0)
        self.vlm_poll_interval = 1.0 / vlm_fps if vlm_fps > 0 else 1.0
        self.last_vlm_poll = 0.0
        self._frame_count = 0
        self._fps_start_time = time.time()
        self._fps_frame_count = 0
        self._current_fps = 0.0

        # ── Thread Pool for Parallel Inference ────────────────
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="model")

    def run(self, source, no_display: bool = False, no_voice: bool = False) -> None:
        """Run the main processing loop.

        Args:
            source: Webcam ID (int), or path to video/image file (str).
            no_display: If True, skip OpenCV window rendering.
            no_voice: If True, disable TTS alerts.
        """
        if no_voice:
            self.alert_manager.enabled = False

        cap_cfg = self.config["capture"]
        resolution = tuple(cap_cfg["resolution"])

        frame_source = FrameSource(
            source=source,
            resolution=resolution,
            max_fps=cap_cfg["max_fps"],
        )

        self._running = True
        logger.info("Warming up GPU models for low-latency inference...")
        try:
            self.detector.warmup()
            self.pose_estimator.warmup()
        except Exception as e:
            logger.debug("Warmup error: %s", e)

        logger.info("Starting Safety Copilot pipeline...")

        try:
            with frame_source:
                for frame, timestamp, frame_number in frame_source:
                    if not self._running:
                        break

                    result = self._process_frame(frame, timestamp, frame_number)
                    if frame_number % 30 == 0:
                        logger.info("⚡ Frame %d processed | FPS: %.1f | Detections: %d | Hazards: %d", 
                                    frame_number, self._current_fps, len(result.detections), len(result.hazards))

                    # ── Display ───────────────────────────────
                    if not no_display:
                        display_frame = self.overlay_renderer.render(frame, result)
                        cv2.imshow(
                            self.config["display"]["window_name"], display_frame
                        )

                        key = cv2.waitKey(1) & 0xFF
                        if key == ord("q") or key == 27:  # q or ESC
                            logger.info("User quit via keyboard")
                            break
                        elif key == ord("s"):  # Silence alerts
                            self.alert_manager.silence()
                            logger.info("Alerts silenced by user")
                        elif key == ord("v") and self.vlm_hook.is_available():
                            # Interactive VLM question (pauses loop)
                            print("\n" + "="*50)
                            question = input("🎤 Ask the Safety Assistant a question: ")
                            print("Thinking...")
                            answer = self.vlm_hook.ask_question(question, result, frame=frame)
                            print(f"\n🤖 VLM: {answer}")
                            print("="*50 + "\n")
                            if not no_voice:
                                from core.models import Severity
                                self.tts_engine.speak(answer, Severity.INFO)

        except KeyboardInterrupt:
            logger.info("Interrupted by user")
        finally:
            self.vlm_hook.stop()
            self._cleanup(no_display)

    def _process_frame(
        self, frame: np.ndarray, timestamp: float, frame_number: int
    ) -> FrameResult:
        """Process a single frame through the full pipeline."""
        self._frame_count += 1

        # Dynamic resolution update to prevent coordinate/direction calculation issues
        h, w = frame.shape[:2]
        if self.alert_manager.resolution != (w, h):
            self.alert_manager.resolution = (w, h)
            self.hazard_analyzer.resolution = (w, h)
            self.attention_tracker.resolution = (w, h)

        # ── 1. Submit parallel inference across models ──
        # Submit PPE detection, tool detection, and pose estimation in parallel
        ppe_future = self._executor.submit(self.detector.detect_ppe, frame)
        tool_future = self._executor.submit(
            self.detector.detect_tools, frame, frame_number, 4, True
        )

        person_tracks = {
            tid: obj
            for tid, obj in self._tracked_objects.items()
            if obj.class_name == "person" and obj.is_active
        }

        pose_future = self._executor.submit(
            self.pose_estimator.estimate, frame, frame_number, person_tracks
        )

        # Main thread runs general model tracking
        general_detections = self.detector.detect_general_tracked(frame)

        # Non-blocking async depth submission (every 10 frames)
        if self.depth_estimator.enabled and frame_number % 10 == 0:
            self.depth_estimator.submit_async(frame)

        # ── 2. Gather parallel results ──
        poses = pose_future.result()
        ppe_detections = ppe_future.result()
        tool_detections = tool_future.result()

        all_detections = list(general_detections) + list(ppe_detections)
        if tool_detections:
            all_detections.extend(tool_detections)

        detections = self.detector.deduplicate(all_detections)

        # Update tracked objects from all detections (persons, vehicles, tools, objects)
        self._update_tracked_objects(detections, timestamp)

        # Read latest async depth map (instant 0ms fetch)
        latest_dmap = self.depth_estimator.get_latest_depth_map()
        if self.depth_estimator.enabled and latest_dmap is not None:
            for obj in self._tracked_objects.values():
                if obj.is_active:
                    obj.distance_meters = self.depth_estimator.get_distance(
                        obj.bbox, latest_dmap
                    )

        # ── 4. Hazard Analysis ───────────────────────────────
        hazards, worker_ppe, machine_zones = self.hazard_analyzer.analyze(
            detections=detections,
            poses=poses,
            tracked_objects=self._tracked_objects,
            timestamp=timestamp,
        )

        # ── 4. Attention Tracking (novel escalation) ─────────
        hazards = self.attention_tracker.update(
            hazards=hazards,
            poses=poses,
            tracked_objects=self._tracked_objects,
            timestamp=timestamp,
        )

        # ── 5. VLM Hook (Non-Blocking Asynchronous Escalation) ────────
        for hazard in hazards:
            if hazard.is_escalated and self.vlm_hook.is_available():
                self.vlm_hook.escalate_async(
                    hazard=hazard,
                    frame=frame,
                    worker_ppe=worker_ppe.get(hazard.worker_track_id),
                    frame_number=frame_number,
                )

        # ── 6. Alert Generation ──────────────────────────────
        alerts = self.alert_manager.process_hazards(hazards, worker_ppe)

        # ── 7. Event Logging ─────────────────────────────────
        for hazard in hazards:
            if hazard.state in (
                HazardState.UNNOTICED,
                HazardState.ESCALATED,
            ):
                self.event_logger.log_hazard(hazard, frame_number)

        for alert in alerts:
            self.event_logger.log_alert(alert, frame_number)

        # ── 8. FPS Calculation ───────────────────────────────
        self._fps_frame_count += 1
        elapsed = time.time() - self._fps_start_time
        if elapsed >= 1.0:
            self._current_fps = self._fps_frame_count / elapsed
            self._fps_frame_count = 0
            self._fps_start_time = time.time()

        # ── Build Result ─────────────────────────────────────
        result = FrameResult(
            frame_number=frame_number,
            timestamp=timestamp,
            detections=detections,
            poses=list(poses.values()) if isinstance(poses, dict) else poses,
            tracked_objects=self._tracked_objects,
            worker_ppe_states=worker_ppe,
            hazards=hazards,
            alerts=alerts,
            active_zones=self.zone_manager.get_all_zones() + machine_zones,
            fps=self._current_fps,
            depth_map=latest_dmap,
        )

        # ── 9. Update CopilotBridge for Live Web Dashboard ──
        try:
            from app.copilot_bridge import copilot_bridge
            display_frame = self.overlay_renderer.render(frame, result)
            copilot_bridge.update_frame(
                display_frame=display_frame,
                raw_frame=frame,
                frame_result=result,
                depth_map=latest_dmap,
                overlay_renderer=self.overlay_renderer,
                fps=self._current_fps
            )
        except Exception as e:
            logger.exception("BRIDGE ERROR: %s", e)

        return result

    def _update_tracked_objects(
        self, detections: list[Detection], timestamp: float
    ) -> None:
        """Update the internal tracked objects dict from new detections."""
        seen_ids: set[int] = set()

        for det in detections:
            if det.track_id is None or det.is_ppe:
                continue

            seen_ids.add(det.track_id)

            if det.track_id in self._tracked_objects:
                self._tracked_objects[det.track_id].update(
                    det.bbox,
                    timestamp,
                    appearance_embedding=det.appearance_embedding,
                )
            else:
                obj = TrackedObject(
                    track_id=det.track_id,
                    class_name=det.class_name,
                    bbox=det.bbox,
                    first_seen=timestamp,
                    last_seen=timestamp,
                    appearance_embedding=det.appearance_embedding,
                )
                obj.position_history.append(
                    ((det.bbox[0] + det.bbox[2]) / 2,
                     (det.bbox[1] + det.bbox[3]) / 2,
                     timestamp)
                )
                self._tracked_objects[det.track_id] = obj

        # Mark unseen tracks as inactive (but keep for a few seconds)
        stale_threshold = 3.0
        stale_ids = []
        for tid, obj in self._tracked_objects.items():
            if tid not in seen_ids:
                obj.is_active = False
                obj.distance_meters = None  # Clear stale depth values
                if timestamp - obj.last_seen > stale_threshold:
                    stale_ids.append(tid)

        for tid in stale_ids:
            del self._tracked_objects[tid]

    def _cleanup(self, no_display: bool) -> None:
        """Clean up resources on shutdown."""
        logger.info("Cleaning up...")
        self._executor.shutdown(wait=False)
        self.tts_engine.stop()
        self.event_logger.close()
        if not no_display:
            cv2.destroyAllWindows()
        logger.info("Safety Copilot shut down cleanly.")

    def stop(self) -> None:
        """Signal the main loop to stop."""
        self._running = False


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Job Site Safety Copilot — Tier 1",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Examples:
  python main.py --source webcam              # Live webcam
  python main.py --source video.mp4           # Video file
  python main.py --source photo.jpg           # Single image
  python main.py --source webcam --no-voice   # No TTS alerts
  python main.py --source webcam --device cpu  # Force CPU

Keyboard controls (during display):
  q / ESC   Quit
  s         Silence active alerts
  v         Ask VLM a question (pauses video)
""",
    )
    parser.add_argument(
        "--source",
        default="webcam",
        help="Input source: 'webcam' (or int), video file path, or image file path (default: 'webcam')",
    )
    parser.add_argument(
        "--config",
        default="config.yaml",
        help="Path to config.yaml (default: config.yaml)",
    )
    parser.add_argument(
        "--device",
        choices=["auto", "cuda", "mps", "cpu"],
        default=None,
        help="Override compute device (default: from config)",
    )
    parser.add_argument(
        "--no-display",
        action="store_true",
        help="Run headless (no OpenCV window)",
    )
    parser.add_argument(
        "--no-voice",
        action="store_true",
        help="Disable TTS voice alerts",
    )
    parser.add_argument(
        "--web",
        action="store_true",
        default=True,
        help="Launch the web dashboard on http://127.0.0.1:8000 (default: True)",
    )
    parser.add_argument(
        "--no-web",
        dest="web",
        action="store_false",
        help="Disable web dashboard",
    )
    parser.add_argument(
        "--zones",
        default=None,
        help="Path to zones JSON file",
    )
    return parser.parse_args()


def main() -> None:
    """Entry point for the Safety Copilot."""
    args = parse_args()

    # ── Logging Setup ────────────────────────────────────
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )

    # ── Load Config ──────────────────────────────────────
    config = load_config(args.config)

    # Apply CLI overrides
    if args.device:
        config["device"]["preferred"] = args.device

    log_level = config["logging"].get("log_level", "INFO")
    logging.getLogger().setLevel(getattr(logging, log_level))

    # Suppress verbose third-party library logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("huggingface_hub").setLevel(logging.WARNING)

    # ── Resolve Source ───────────────────────────────────
    source = args.source
    if source.lower() == "webcam":
        source = config["capture"]["webcam_id"]
    elif source.lower().startswith(("http://", "https://", "rtsp://")):
        pass  # Network stream URL — pass through as string
    elif source.isdigit():
        source = int(source)
    # else: treat as file path

    # ── Build & Run Pipeline ─────────────────────────────
    copilot = SafetyCopilot(config)

    # Load zones if specified
    if args.zones:
        copilot.zone_manager.load_from_file(args.zones)
        logger.info("Loaded zones from %s", args.zones)

    # Graceful shutdown on SIGINT
    def signal_handler(sig, frame):
        logger.info("Received signal %s, shutting down...", sig)
        copilot.stop()

    signal.signal(signal.SIGINT, signal_handler)

    if args.web:
        import threading
        import uvicorn
        from app.config import get_settings
        from app.copilot_bridge import copilot_bridge
        copilot_bridge._running = True  # Signal that main.py is the active video driver
        app_settings = get_settings()
        from app.main import app as fastapi_app
        def _run_web():
            uvicorn.run(fastapi_app, host=app_settings.host, port=app_settings.port, log_level="warning")
        web_thread = threading.Thread(target=_run_web, name="FastAPIWebThread", daemon=True)
        web_thread.start()
        logger.info(f"\U0001f680 Live Web Dashboard active at http://{app_settings.host}:{app_settings.port}")

    try:
        copilot.run(
            source=source,
            no_display=args.no_display,
            no_voice=args.no_voice,
        )
    except IOError as e:
        logger.error("\u274c Could not open video source: %s", e)
        logger.warning("CV pipeline is offline. Web dashboard is still running — open http://localhost:8001 to check API status.")
        if args.web:
            # Keep process alive so the web server keeps serving
            logger.info("Keeping web server alive. Press Ctrl+C to exit.")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                logger.info("Shutdown requested.")
    except Exception as e:
        logger.error("\u274c Unexpected error in CV pipeline: %s", e)
        if args.web:
            logger.warning("Web server still running. Press Ctrl+C to exit.")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                logger.info("Shutdown requested.")
        else:
            raise


if __name__ == "__main__":
    main()
