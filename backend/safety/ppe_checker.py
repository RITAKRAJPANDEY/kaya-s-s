"""PPE compliance checking — associate PPE detections with tracked persons.

Determines hard-hat and safety-vest status for each tracked worker by
spatially matching PPE-model detections to person bounding boxes.
"""

from __future__ import annotations

import logging
from typing import Optional

from core.models import Detection, TrackedObject, WorkerPPEState

logger = logging.getLogger(__name__)

# ── Class-name sets for PPE items ────────────────────────────
_HARDHAT_PRESENT = frozenset({"hardhat", "hard_hat"})
_HARDHAT_ABSENT = frozenset({"no_hardhat", "no_hard_hat", "no-hardhat"})
_VEST_PRESENT = frozenset({"vest", "safety_vest", "safety-vest"})
_VEST_ABSENT = frozenset({"no_vest", "no_safety_vest", "no-vest", "no-safety-vest"})
_GOGGLES_PRESENT = frozenset({"goggles", "safety_goggles", "safety-goggles"})
_GOGGLES_ABSENT = frozenset({"no_goggles", "no-goggles"})
_GLOVES_PRESENT = frozenset({"gloves", "safety_gloves", "safety-gloves"})
_GLOVES_ABSENT = frozenset({"no_gloves", "no-gloves"})
_BOOTS_PRESENT = frozenset({"boots", "safety_boots", "safety-boots"})
_BOOTS_ABSENT = frozenset({"no_boots", "no-boots"})
_MASK_PRESENT = frozenset({"mask", "safety_mask", "safety-mask"})
_MASK_ABSENT = frozenset({"no_mask", "no-mask"})


def _bbox_center_inside(
    ppe_det: Detection,
    person_bbox: tuple[int, int, int, int],
    margin: float = 0.20,
) -> bool:
    """Return True if *ppe_det*'s center falls inside the *person_bbox*
    expanded by *margin* (fraction of width/height on each side).
    """
    px1, py1, px2, py2 = person_bbox
    w = px2 - px1
    h = py2 - py1
    ex1 = px1 - w * margin
    ey1 = py1 - h * margin
    ex2 = px2 + w * margin
    ey2 = py2 + h * margin

    cx, cy = ppe_det.center
    return ex1 <= cx <= ex2 and ey1 <= cy <= ey2


class PPEChecker:
    """Stateless PPE compliance evaluator.

    Call :meth:`check` once per frame with the current detections and
    tracked persons to obtain a per-worker PPE state mapping.
    """

    def check(
        self,
        detections: list[Detection],
        tracked_persons: dict[int, TrackedObject],
    ) -> dict[int, WorkerPPEState]:
        """Evaluate PPE compliance for every tracked person.

        Parameters
        ----------
        detections:
            All detections from *both* models (COCO + PPE).  Only PPE-class
            detections are considered for association; person detections
            provide the bounding box.
        tracked_persons:
            Mapping of ``track_id → TrackedObject`` for currently visible
            persons.

        Returns
        -------
        dict[int, WorkerPPEState]
            Mapping ``track_id → WorkerPPEState`` for every person in
            *tracked_persons*.
        """
        # Separate PPE detections for fast iteration
        ppe_detections = [d for d in detections if d.is_ppe or
                          d.class_name.lower() in (
                              _HARDHAT_PRESENT | _HARDHAT_ABSENT |
                              _VEST_PRESENT | _VEST_ABSENT |
                              _GOGGLES_PRESENT | _GOGGLES_ABSENT |
                              _GLOVES_PRESENT | _GLOVES_ABSENT |
                              _BOOTS_PRESENT | _BOOTS_ABSENT |
                              _MASK_PRESENT | _MASK_ABSENT
                          )]

        results: dict[int, WorkerPPEState] = {}

        for track_id, person in tracked_persons.items():
            has_hardhat: Optional[bool] = None
            has_vest: Optional[bool] = None
            has_goggles: Optional[bool] = None
            has_gloves: Optional[bool] = None
            has_boots: Optional[bool] = None
            has_mask: Optional[bool] = None

            for det in ppe_detections:
                if not _bbox_center_inside(det, person.bbox):
                    continue

                cls = det.class_name.lower()

                # ── Hard hat ─────────────────────────────────
                if cls in _HARDHAT_PRESENT:
                    has_hardhat = True
                elif cls in _HARDHAT_ABSENT:
                    # Explicit "no hardhat" overrides a previous positive only
                    # if we haven't already locked in a True (nearest-wins).
                    if has_hardhat is None:
                        has_hardhat = False

                # ── Vest ─────────────────────────────────────
                if cls in _VEST_PRESENT:
                    has_vest = True
                elif cls in _VEST_ABSENT:
                    if has_vest is None:
                        has_vest = False

                # ── Goggles ──────────────────────────────────
                if cls in _GOGGLES_PRESENT:
                    has_goggles = True
                elif cls in _GOGGLES_ABSENT:
                    if has_goggles is None:
                        has_goggles = False

                # ── Gloves ───────────────────────────────────
                if cls in _GLOVES_PRESENT:
                    has_gloves = True
                elif cls in _GLOVES_ABSENT:
                    if has_gloves is None:
                        has_gloves = False

                # ── Boots ────────────────────────────────────
                if cls in _BOOTS_PRESENT:
                    has_boots = True
                elif cls in _BOOTS_ABSENT:
                    if has_boots is None:
                        has_boots = False

                # ── Mask ─────────────────────────────────────
                if cls in _MASK_PRESENT:
                    has_mask = True
                elif cls in _MASK_ABSENT:
                    if has_mask is None:
                        has_mask = False

            results[track_id] = WorkerPPEState(
                track_id=track_id,
                has_hardhat=has_hardhat,
                has_vest=has_vest,
                has_harness=None,  # Tier 1 stub — always None
                has_goggles=has_goggles,
                has_gloves=has_gloves,
                has_boots=has_boots,
                has_mask=has_mask,
            )

        return results
