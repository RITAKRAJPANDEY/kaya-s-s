"""YOLO26-pose keypoint estimation with tracked-person association.

Runs a YOLO-pose model every Nth frame and associates detected poses
with tracked persons via IoU matching.  Computes head yaw, body angle,
and centre of mass for each detected person.
"""

from __future__ import annotations

import logging
import math
from typing import Optional

import numpy as np

from core.models import (
    KEYPOINT_LEFT_EAR,
    KEYPOINT_LEFT_EYE,
    KEYPOINT_LEFT_HIP,
    KEYPOINT_LEFT_SHOULDER,
    KEYPOINT_NOSE,
    KEYPOINT_RIGHT_EAR,
    KEYPOINT_RIGHT_EYE,
    KEYPOINT_RIGHT_HIP,
    KEYPOINT_RIGHT_SHOULDER,
    PoseData,
    TrackedObject,
)

logger = logging.getLogger(__name__)

# Minimum keypoint confidence to consider a keypoint "visible"
_KP_CONF_THRESHOLD = 0.25


# ── Utility: bounding-box IoU ────────────────────────────────

def _bbox_iou(
    box_a: tuple[int, int, int, int],
    box_b: tuple[int, int, int, int],
) -> float:
    """Compute Intersection-over-Union between two (x1, y1, x2, y2) boxes."""
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)

    inter_w = max(0, inter_x2 - inter_x1)
    inter_h = max(0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union_area = area_a + area_b - inter_area

    if union_area <= 0:
        return 0.0
    return inter_area / union_area


class PoseEstimator:
    """YOLO26-pose keypoint estimator with frame-skip caching.

    Args:
        model_path: Path or name for the YOLO-pose model
            (e.g. ``"yolo26n-pose.pt"``).
        device: Compute device string.
        confidence: Minimum detection confidence for the pose model.
        run_every_n: Run inference every Nth frame; return cached results
            on skipped frames.
    """

    def __init__(
        self,
        model_path: str = "yolo26n-pose.pt",
        device: str = "cpu",
        confidence: float = 0.4,
        run_every_n: int = 3,
    ) -> None:
        from ultralytics import YOLO

        self._device = device
        self._is_cuda = str(self._device) in ("0", "cuda") or str(self._device).startswith("cuda")
        self._confidence = confidence
        self._run_every_n = max(1, run_every_n)

        logger.info(
            "Loading pose model '%s' on device '%s'…", model_path, device
        )
        self._model = YOLO(model_path)
        logger.info(
            "Pose model loaded (run_every_n=%d, confidence=%.2f, cuda=%s)",
            self._run_every_n,
            self._confidence,
            self._is_cuda,
        )

        # Cache for skipped frames
        self._cached_poses: list[PoseData] = []

    def warmup(self) -> None:
        """Run a single dummy inference to initialize CUDA context."""
        dummy = np.zeros((384, 640, 3), dtype=np.uint8)
        try:
            self._model.predict(
                source=dummy,
                device=self._device,
                conf=self._confidence,
                verbose=False,
                half=self._is_cuda,
            )
            logger.info("✅ Pose model warmed up successfully on device '%s'", self._device)
        except Exception as e:
            logger.debug("Pose warmup exception (non-fatal): %s", e)

    # ── Public API ────────────────────────────────────────────

    def estimate(
        self,
        frame: np.ndarray,
        frame_number: int,
        tracked_persons: dict[int, TrackedObject],
    ) -> list[PoseData]:
        """Estimate poses and associate them with tracked persons.

        Args:
            frame: BGR image (numpy array).
            frame_number: Current frame index (1-based).
            tracked_persons: Dict mapping track_id → TrackedObject for
                persons currently visible in the scene.

        Returns:
            List of ``PoseData`` objects, one per detected person.
        """
        # Skip frames for performance
        if frame_number % self._run_every_n != 0:
            return list(self._cached_poses)

        # Run pose model
        results = self._model.predict(
            source=frame,
            device=self._device,
            conf=self._confidence,
            verbose=False,
            half=self._is_cuda,
        )

        poses: list[PoseData] = []
        for result in results:
            if result.keypoints is None or result.boxes is None:
                continue

            keypoints_data = result.keypoints.data  # (N, 17, 3)
            boxes = result.boxes

            for i in range(len(keypoints_data)):
                kps = keypoints_data[i].cpu().numpy()  # (17, 3)

                # Get the pose bounding box
                x1, y1, x2, y2 = boxes.xyxy[i].tolist()
                pose_bbox = (int(x1), int(y1), int(x2), int(y2))

                # Associate with a tracked person via IoU
                person_id = self._match_to_person(pose_bbox, tracked_persons)

                # Compute derived metrics
                head_yaw = self._compute_head_yaw(kps)
                body_angle = self._compute_body_angle(kps)
                center_of_mass = self._compute_center_of_mass(kps)

                poses.append(
                    PoseData(
                        person_track_id=person_id,
                        keypoints=kps,
                        head_yaw=head_yaw,
                        body_angle=body_angle,
                        center_of_mass=center_of_mass,
                    )
                )

        self._cached_poses = poses
        return list(poses)

    # ── Person matching ───────────────────────────────────────

    @staticmethod
    def _match_to_person(
        pose_bbox: tuple[int, int, int, int],
        tracked_persons: dict[int, TrackedObject],
    ) -> int:
        """Find the tracked person with highest IoU to *pose_bbox*.

        Returns the track_id of the best match, or ``-1`` if no match
        exceeds the minimum IoU threshold.
        """
        best_id = -1
        best_iou = 0.2  # Minimum IoU threshold for association

        for track_id, person in tracked_persons.items():
            iou = _bbox_iou(pose_bbox, person.bbox)
            if iou > best_iou:
                best_iou = iou
                best_id = track_id

        return best_id

    # ── Head yaw estimation ───────────────────────────────────

    @staticmethod
    def _compute_head_yaw(kps: np.ndarray) -> Optional[float]:
        """Estimate head yaw angle from ear/eye/nose visibility.

        Returns an angle in degrees:
        - ~0°   → facing right
        - ~90°  → facing the camera
        - ~180° → facing left

        Returns ``None`` if insufficient keypoints are visible.
        """
        left_ear_conf = kps[KEYPOINT_LEFT_EAR][2]
        right_ear_conf = kps[KEYPOINT_RIGHT_EAR][2]
        nose_conf = kps[KEYPOINT_NOSE][2]
        left_eye_conf = kps[KEYPOINT_LEFT_EYE][2]
        right_eye_conf = kps[KEYPOINT_RIGHT_EYE][2]

        # Need at least some facial keypoints
        visible_count = sum(
            1
            for c in [left_ear_conf, right_ear_conf, nose_conf]
            if c > _KP_CONF_THRESHOLD
        )
        if visible_count < 1:
            return None

        # ── Primary signal: ear visibility asymmetry ──────────
        # Both ears visible → likely facing camera
        both_ears = (
            left_ear_conf > _KP_CONF_THRESHOLD
            and right_ear_conf > _KP_CONF_THRESHOLD
        )
        if both_ears:
            # Compute asymmetry ratio
            total = left_ear_conf + right_ear_conf
            if total > 0:
                ratio = left_ear_conf / total  # 0.5 = symmetric = facing camera
            else:
                ratio = 0.5

            # Map ratio to angle: 0.5 → 90°, 0.0 → 180°, 1.0 → 0°
            yaw = 180.0 * (1.0 - ratio)

            # If confidence is very similar, clamp toward 90°
            conf_diff = abs(left_ear_conf - right_ear_conf)
            if conf_diff < 0.15:
                yaw = 90.0 + (yaw - 90.0) * 0.3  # Dampen toward centre
        elif left_ear_conf > _KP_CONF_THRESHOLD:
            # Only left ear visible → facing right (0–45°)
            yaw = 30.0
        elif right_ear_conf > _KP_CONF_THRESHOLD:
            # Only right ear visible → facing left (135–180°)
            yaw = 150.0
        else:
            yaw = 90.0  # Default to facing camera if only nose visible

        # ── Secondary signal: nose vs. eye midpoint ───────────
        if (
            nose_conf > _KP_CONF_THRESHOLD
            and left_eye_conf > _KP_CONF_THRESHOLD
            and right_eye_conf > _KP_CONF_THRESHOLD
        ):
            nose_x = kps[KEYPOINT_NOSE][0]
            eye_mid_x = (kps[KEYPOINT_LEFT_EYE][0] + kps[KEYPOINT_RIGHT_EYE][0]) / 2
            eye_dist = abs(kps[KEYPOINT_LEFT_EYE][0] - kps[KEYPOINT_RIGHT_EYE][0])

            if eye_dist > 1.0:
                offset = (nose_x - eye_mid_x) / eye_dist
                # Positive offset → nose is to the right of eyes → facing right
                # Negative offset → nose is to the left → facing left
                # Blend secondary signal (weight 0.3)
                secondary_yaw = 90.0 - offset * 60.0
                secondary_yaw = max(0.0, min(180.0, secondary_yaw))
                yaw = yaw * 0.7 + secondary_yaw * 0.3

        return max(0.0, min(180.0, yaw))

    # ── Body angle from vertical ──────────────────────────────

    @staticmethod
    def _compute_body_angle(kps: np.ndarray) -> Optional[float]:
        """Compute the torso angle from vertical (0° = upright, 90° = horizontal).

        Uses the line from shoulder midpoint to hip midpoint.
        Returns ``None`` if keypoints are not sufficiently confident.
        """
        ls = kps[KEYPOINT_LEFT_SHOULDER]
        rs = kps[KEYPOINT_RIGHT_SHOULDER]
        lh = kps[KEYPOINT_LEFT_HIP]
        rh = kps[KEYPOINT_RIGHT_HIP]

        # Check confidence
        if not all(
            kp[2] > _KP_CONF_THRESHOLD for kp in [ls, rs, lh, rh]
        ):
            return None

        shoulder_mid_x = (ls[0] + rs[0]) / 2
        shoulder_mid_y = (ls[1] + rs[1]) / 2
        hip_mid_x = (lh[0] + rh[0]) / 2
        hip_mid_y = (lh[1] + rh[1]) / 2

        dx = hip_mid_x - shoulder_mid_x
        dy = hip_mid_y - shoulder_mid_y

        # Angle from vertical: atan2(|dx|, |dy|)
        # Vertical (hips directly below shoulders) → 0°
        # Horizontal (hips beside shoulders) → 90°
        length = math.sqrt(dx * dx + dy * dy)
        if length < 1.0:
            return 0.0

        angle_rad = math.atan2(abs(dx), abs(dy))
        return math.degrees(angle_rad)

    # ── Centre of mass ────────────────────────────────────────

    @staticmethod
    def _compute_center_of_mass(
        kps: np.ndarray,
    ) -> Optional[tuple[float, float]]:
        """Compute a simplified centre of mass (avg of shoulder + hip midpoints).

        Returns ``None`` if keypoints are not sufficiently confident.
        """
        ls = kps[KEYPOINT_LEFT_SHOULDER]
        rs = kps[KEYPOINT_RIGHT_SHOULDER]
        lh = kps[KEYPOINT_LEFT_HIP]
        rh = kps[KEYPOINT_RIGHT_HIP]

        if not all(
            kp[2] > _KP_CONF_THRESHOLD for kp in [ls, rs, lh, rh]
        ):
            return None

        shoulder_mid_x = (ls[0] + rs[0]) / 2
        shoulder_mid_y = (ls[1] + rs[1]) / 2
        hip_mid_x = (lh[0] + rh[0]) / 2
        hip_mid_y = (lh[1] + rh[1]) / 2

        com_x = (shoulder_mid_x + hip_mid_x) / 2
        com_y = (shoulder_mid_y + hip_mid_y) / 2

        return (float(com_x), float(com_y))
