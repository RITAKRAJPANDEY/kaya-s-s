"""Compute device selection with macOS 26 Tahoe workaround.

On macOS 26 (Tahoe), PyTorch's MPS backend has a known initialization
regression. This module runs a smoke test on startup and falls back
to CPU automatically if MPS fails.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def get_device(preferred: str = "auto", for_ultralytics: bool = False) -> str:
    """Select the best available compute device.

    Args:
        preferred: "auto" (try CUDA, then MPS, then CPU), "cuda", "mps", or "cpu".
        for_ultralytics: If True and on CUDA, return "0" for Ultralytics device index.

    Returns:
        Device string compatible with Ultralytics or PyTorch.
    """
    import torch

    if preferred not in ("auto", "cuda", "mps", "cpu"):
        logger.warning("Unknown device '%s', falling back to auto", preferred)
        preferred = "auto"

    if preferred == "cpu":
        logger.info("Device forced to CPU by configuration")
        return "cpu"

    # 1. Attempt NVIDIA CUDA GPU
    if preferred in ("auto", "cuda"):
        if torch.cuda.is_available():
            try:
                t = torch.zeros(2, 3, device="cuda")
                _ = (t * 2 + 1).sum().item()
                del t
                gpu_name = torch.cuda.get_device_name(0)
                logger.info("✅ CUDA device passed smoke test — using NVIDIA GPU: %s", gpu_name)
                return "0" if for_ultralytics else "cuda"
            except (RuntimeError, Exception) as e:
                gpu_name = torch.cuda.get_device_name(0) if torch.cuda.device_count() > 0 else "Unknown GPU"
                logger.warning(
                    "CUDA smoke test dispatch failed (%s). GPU '%s' architecture is not supported by installed PyTorch binary — falling back to CPU.",
                    e, gpu_name
                )
                # Fall back instead of returning CUDA device index
        else:
            if preferred == "cuda":
                logger.warning("CUDA explicitly requested but not available")


    # 2. Attempt MPS (Apple Silicon Metal Performance Shaders)
    if preferred in ("auto", "mps"):
        mps_available = (
            hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
        )
        if mps_available:
            try:
                t = torch.zeros(2, 3, device="mps")
                _ = (t * 2 + 1).sum().item()
                del t
                logger.info(
                    "✅ MPS device passed smoke test — using Apple Silicon GPU"
                )
                return "mps"
            except Exception as e:
                logger.warning(
                    "MPS available but smoke test failed: %s — falling back",
                    e,
                )
        else:
            if preferred == "mps":
                logger.warning("MPS explicitly requested but not available")

    logger.info("Using CPU for inference")
    return "cpu"


def log_device_info() -> None:
    """Log detailed device/platform information for debugging."""
    import platform
    import torch

    logger.info("Platform: %s %s", platform.system(), platform.release())
    logger.info("Python: %s", platform.python_version())
    logger.info("PyTorch: %s", torch.__version__)
    logger.info(
        "MPS available: %s",
        getattr(torch.backends, "mps", None)
        and torch.backends.mps.is_available(),
    )
    try:
        import ultralytics
        logger.info("Ultralytics: %s", ultralytics.__version__)
    except ImportError:
        logger.warning("Ultralytics not installed")
