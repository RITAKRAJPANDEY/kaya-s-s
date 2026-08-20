"""Tests for Multi-Mode HUD Renderers in OverlayRenderer."""

import numpy as np
import pytest
from core.models import (
    Detection,
    FrameResult,
    PoseData,
    Severity,
    TrackedObject,
    WorkerPPEState,
)
from display.overlay import OverlayRenderer


@pytest.fixture
def mock_frame_result():
    frame_h, frame_w = 480, 640

    # 1. Detections
    dets = [
        Detection(class_name="person", confidence=0.9, bbox=(100, 100, 250, 400), track_id=1, model_source="coco"),
        Detection(class_name="cordless_drill", confidence=0.85, bbox=(220, 240, 280, 300), track_id=200, model_source="tool"),
        Detection(class_name="hard_hat", confidence=0.88, bbox=(140, 95, 200, 145), is_ppe=True, model_source="ppe"),
    ]

    # 2. Keypoints for pose
    keypoints = np.zeros((17, 3), dtype=np.float32)
    keypoints[0] = [170, 130, 0.9]   # Nose
    keypoints[1] = [160, 125, 0.9]   # Left Eye
    keypoints[2] = [180, 125, 0.9]   # Right Eye
    keypoints[5] = [130, 180, 0.9]   # Left Shoulder
    keypoints[6] = [210, 180, 0.9]   # Right Shoulder
    keypoints[9] = [230, 250, 0.9]   # Right Wrist (near drill)
    keypoints[11] = [140, 280, 0.9]  # Left Hip
    keypoints[12] = [190, 280, 0.9]  # Right Hip

    poses = [
        PoseData(
            person_track_id=1,
            keypoints=keypoints,
            head_yaw=105.0,
            body_angle=12.0,
        )
    ]

    tracked = {
        1: TrackedObject(track_id=1, class_name="person", bbox=(100, 100, 250, 400), distance_meters=2.5),
        200: TrackedObject(track_id=200, class_name="cordless_drill", bbox=(220, 240, 280, 300), distance_meters=2.3),
    }

    worker_ppe = {
        1: WorkerPPEState(track_id=1, has_hardhat=True, has_vest=False)
    }

    depth_map = np.full((frame_h, frame_w), 2.5, dtype=np.float32)

    return FrameResult(
        frame_number=1,
        detections=dets,
        poses=poses,
        tracked_objects=tracked,
        worker_ppe_states=worker_ppe,
        fps=30.0,
        depth_map=depth_map,
    )


def test_overlay_render_modes(mock_frame_result):
    renderer = OverlayRenderer()
    frame = np.ones((480, 640, 3), dtype=np.uint8) * 128

    modes = ["all", "raw", "pose", "pose_3d", "depth", "depth_3d", "ppe", "objects"]
    for mode in modes:
        out = renderer.render(frame, mock_frame_result, mode=mode)
        assert isinstance(out, np.ndarray)
        assert out.shape == frame.shape
        assert out.dtype == np.uint8

    # Raw should match original frame exactly
    raw_out = renderer.render(frame, mock_frame_result, mode="raw")
    np.testing.assert_array_equal(raw_out, frame)
