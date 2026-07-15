from pathlib import Path

from app.vision.equipment_detector import (
    EquipmentDetection,
    EquipmentDetectorUnavailable,
    build_equipment_detector,
    canonical_equipment_label,
    equipment_inference_applicable,
)
from app.vision.equipment_tracking import EquipmentTracker
from app.vision.equipment_trajectory import contact_events, trajectory_summary


def test_equipment_label_aliases_and_safe_unavailable_detector(tmp_path: Path) -> None:
    detector = build_equipment_detector(tmp_path, 0.3, tmp_path / "missing.pth", False)

    assert isinstance(detector, EquipmentDetectorUnavailable)
    assert canonical_equipment_label("Medicine Ball") == "wall_ball"
    assert canonical_equipment_label("pullup-bar") == "pull_up_bar"
    assert equipment_inference_applicable("wall_ball_shot", tmp_path / "missing.pth", True) is True
    assert equipment_inference_applicable("kipping_pull_up", tmp_path / "missing.pth", True) is False


def test_equipment_tracker_preserves_identity_and_normalized_centers() -> None:
    tracker = EquipmentTracker()
    first = tracker.update([EquipmentDetection("wall_ball", 0.9, (10, 20, 30, 40))], (100, 200))[0]
    second = tracker.update([EquipmentDetection("wall_ball", 0.8, (14, 22, 34, 42))], (100, 200))[0]

    assert first["track_id"] == second["track_id"]
    assert first["center_normalized"] == [0.1, 0.3]


def test_trajectory_and_contact_are_temporal_two_dimensional_evidence() -> None:
    frames = []
    for index, y in enumerate((80, 60, 40, 30)):
        frames.append({
            "frame_index": index,
            "timestamp_seconds": index / 30,
            "equipment": [
                {
                    "label": "wall_ball", "confidence": 0.9, "track_id": "ball:1",
                    "xyxy": [45, y - 5, 55, y + 5], "center": [50, y],
                    "center_normalized": [0.5, y / 100],
                },
                {
                    "label": "wall_ball_target", "confidence": 0.8, "track_id": "target:1",
                    "xyxy": [40, 20, 60, 35], "center": [50, 27.5],
                    "center_normalized": [0.5, 0.275],
                },
            ],
        })

    trajectory = trajectory_summary(frames, {"wall_ball"})
    contacts = contact_events(frames, {"wall_ball"}, {"wall_ball_target"})

    assert trajectory is not None
    assert trajectory["observations"] == 4
    assert trajectory["vertical_range_frame_fraction"] == 0.5
    assert contacts[0]["kind"] == "two_dimensional_contact_candidate"
    assert contacts[0]["peak_frame"] == 3
