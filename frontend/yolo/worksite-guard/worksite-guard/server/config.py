"""Central configuration. Tune these values to trade off speed vs. accuracy."""
from pydantic import BaseModel


class Settings(BaseModel):
    # --- Models ---
    GENERAL_MODEL_PATH: str = "yolov8n.pt"      # auto-downloaded by ultralytics on first run
    PPE_MODEL_PATH: str = "models/ppe.pt"        # optional — see README for how to add one

    # --- Inference ---
    INFER_WIDTH: int = 320        # ultra-fast 320px inference for real-time tracking
    CONF_THRESHOLD: float = 0.40  # detection confidence

    # --- Threat geometry (fractions of the frame diagonal) ---
    PROXIMITY_DANGER_RATIO: float = 0.15
    PROXIMITY_CAUTION_RATIO: float = 0.30

    # --- Debouncing: kills single-frame misclassifications ---
    FRAME_HISTORY: int = 4
    DEBOUNCE_HITS: int = 2

    # --- Streaming ---
    VIDEO_RELAY_FPS: int = 15
    DETECT_INTERVAL: float = 0.3


settings = Settings()
