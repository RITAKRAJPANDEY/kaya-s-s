import pytest
from core.models import Detection
from core.detector import (
    _normalise_ppe_name,
    _normalise_tool_name,
    _box_iou,
    _SpatialTracker,
    Detector,
)


def test_ppe_and_tool_name_normalization():
    assert _normalise_ppe_name("Hardhat") == "hardhat"
    assert _normalise_ppe_name("NO-Hardhat") == "no_hardhat"
    assert _normalise_ppe_name("NO-Safety Vest") == "no_vest"
    assert _normalise_ppe_name("Safety Vest") == "vest"
    assert _normalise_ppe_name("Mask") == "mask"

    assert _normalise_tool_name("power drill") == "drill"
    assert _normalise_tool_name("circular saw") == "saw"
    assert _normalise_tool_name("tape measure") == "measuring_tape"
    assert _normalise_tool_name("adjustable wrench") == "wrench"
    assert _normalise_tool_name("box cutter") == "knife"
    assert _normalise_tool_name("spirit level") == "level"
    assert _normalise_tool_name("hammer") == "hammer"


def test_spatial_tracker():
    tracker = _SpatialTracker(start_id=200, max_stale_frames=10, iou_thresh=0.2)

    # Frame 1: new detection
    dets_f1 = [
        Detection(
            class_name="hammer",
            confidence=0.8,
            bbox=(100, 100, 200, 200),
            track_id=None,
            is_ppe=False,
            model_source="tool",
        )
    ]
    res_f1 = tracker.update(dets_f1, frame_number=1)
    assert res_f1[0].track_id == 200

    # Frame 2: slightly moved detection -> should keep same track_id
    dets_f2 = [
        Detection(
            class_name="hammer",
            confidence=0.85,
            bbox=(105, 102, 205, 202),
            track_id=None,
            is_ppe=False,
            model_source="tool",
        )
    ]
    res_f2 = tracker.update(dets_f2, frame_number=2)
    assert res_f2[0].track_id == 200

    # Frame 3: second different tool added
    dets_f3 = [
        Detection(
            class_name="hammer",
            confidence=0.82,
            bbox=(108, 104, 208, 204),
            track_id=None,
            is_ppe=False,
            model_source="tool",
        ),
        Detection(
            class_name="drill",
            confidence=0.75,
            bbox=(400, 300, 500, 450),
            track_id=None,
            is_ppe=False,
            model_source="tool",
        ),
    ]
    res_f3 = tracker.update(dets_f3, frame_number=3)
    assert res_f3[0].track_id == 200
    assert res_f3[1].track_id == 201


def test_deduplication_preserves_ppe_and_tools_on_person():
    detector = Detector.__new__(Detector)

    # Person with hardhat and carrying drill (all overlapping with person bbox)
    person = Detection(
        class_name="person",
        confidence=0.90,
        bbox=(100, 100, 300, 600),
        track_id=1,
        is_ppe=False,
        model_source="coco",
    )
    hardhat = Detection(
        class_name="hardhat",
        confidence=0.85,
        bbox=(150, 100, 250, 180),
        track_id=None,
        is_ppe=True,
        model_source="ppe",
    )
    drill = Detection(
        class_name="drill",
        confidence=0.70,
        bbox=(180, 350, 260, 430),
        track_id=200,
        is_ppe=False,
        model_source="tool",
    )
    # Duplicate person from PPE model with lower confidence
    duplicate_person = Detection(
        class_name="person",
        confidence=0.65,
        bbox=(105, 102, 305, 598),
        track_id=None,
        is_ppe=False,
        model_source="ppe",
    )

    dets = [person, hardhat, drill, duplicate_person]
    deduped = detector._deduplicate(dets)

    assert len(deduped) == 3
    classes = {d.class_name for d in deduped}
    assert classes == {"person", "hardhat", "drill"}
