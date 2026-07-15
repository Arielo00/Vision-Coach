from app.domain.exercise_catalog import ALLOWED_EXERCISES
from app.rules_engine import analyze_exercise
from app.rules_engine.back_squat import _segments as squat_segments
from app.rules_engine.coverage import load_catalog_coverage
from app.rules_engine.l_sit import _segments as l_sit_segments
from app.rules_engine.parallel_dip import _segments as dip_segments
from app.rules_engine.push_press import _segments as push_press_segments
from app.rules_engine.wall_ball import frame_metrics as wall_ball_frame_metrics
from app.vision.tracking import PrimaryPersonTracker


def test_coverage_manifest_has_an_explicit_entry_for_every_catalog_item() -> None:
    payload = load_catalog_coverage()

    assert set(payload["exercises"]) == ALLOWED_EXERCISES
    assert all(item["preferred_views"] for item in payload["exercises"].values())
    assert all(item["limiting_factor"] for item in payload["exercises"].values())


def test_first_catalog_wave_is_routed_to_active_engines() -> None:
    active = {
        exercise
        for exercise, item in load_catalog_coverage()["exercises"].items()
        if item["maturity"].startswith("active_")
    }

    for exercise in active:
        result = analyze_exercise([], "side", exercise)
        assert result["exercise"] == exercise
        assert result["status"] == "completed"


def test_squat_state_machine_requires_extension_descent_and_return() -> None:
    metrics = [{"knee_angle": value} for value in [160, 155, 144, 130, 110, 132, 150, 156]]
    config = {"phases": {"ready_knee_min": 152, "descent_knee_max": 145, "finish_knee_min": 152}, "minimum_rep_frames": 4}

    assert squat_segments(metrics, config) == [(2, 7)]


def test_dip_state_machine_requires_support_descent_and_support() -> None:
    metrics = [{"elbow_angle": value} for value in [160, 154, 134, 112, 92, 118, 144, 155]]
    config = {"phases": {"support_elbow_min": 150, "descent_elbow_max": 135, "finish_elbow_min": 150}, "minimum_rep_frames": 4}

    assert dip_segments(metrics, config) == [(2, 7)]


def test_l_sit_state_machine_returns_only_continuous_holds() -> None:
    metrics = [
        {"hip_angle": 150, "elbow_angle": 160},
        *[{"hip_angle": 95, "elbow_angle": 155} for _ in range(8)],
        {"hip_angle": 140, "elbow_angle": 155},
    ]
    config = {"phases": {"candidate_hip_max": 125, "candidate_elbow_min": 140}, "minimum_hold_frames": 8}

    assert l_sit_segments(metrics, config) == [(1, 8)]


def test_push_press_state_machine_preserves_dip_drive_lockout_order() -> None:
    knees = [158, 154, 145, 135, 145, 152, 156, 158, 158]
    metrics = [
        {"knee_angle": knee, "elbow_angle": 90 if index < 7 else 155, "wrists_above_shoulders": index >= 7}
        for index, knee in enumerate(knees)
    ]
    config = {"phases": {"ready_knee_min": 150, "dip_knee_max": 146, "drive_knee_min": 151, "lockout_elbow_min": 148}, "minimum_rep_frames": 5}

    assert push_press_segments(metrics, config) == [(2, 5, 7)]


def test_wall_ball_depth_uses_hip_relative_to_knee_not_knee_angle_only() -> None:
    xy = [[100.0, 100.0] for _ in range(17)]
    xy[5], xy[6] = [90.0, 100.0], [110.0, 100.0]
    xy[11], xy[12] = [90.0, 350.0], [110.0, 350.0]
    xy[13], xy[14] = [90.0, 300.0], [110.0, 300.0]
    xy[15], xy[16] = [90.0, 500.0], [110.0, 500.0]
    frame = {
        "frame_index": 0,
        "timestamp_seconds": 0.0,
        "people": [{"xy": xy, "keypoint_confidence": [1.0] * 17}],
    }

    metrics = wall_ball_frame_metrics(frame, 0.4)

    assert metrics["hip_below_knee_normalized"] == 0.125


def _tracked_person(center_x: float, detection_confidence: float) -> dict:
    xy = [[center_x, 100.0] for _ in range(17)]
    xy[5], xy[6], xy[11], xy[12] = [center_x - 10, 100], [center_x + 10, 100], [center_x - 8, 160], [center_x + 8, 160]
    return {"xy": xy, "keypoint_confidence": [1.0] * 17, "detection_confidence": detection_confidence}


def test_primary_person_tracker_preserves_identity_when_detection_order_changes() -> None:
    tracker = PrimaryPersonTracker()
    athlete = _tracked_person(100, 0.95)
    bystander = _tracked_person(400, 0.80)

    first = tracker.order([athlete, bystander])
    second = tracker.order([bystander, _tracked_person(108, 0.70)])

    assert first[0]["xy"][5][0] == 90
    assert second[0]["xy"][5][0] == 98
    assert second[0]["track_role"] == "primary"
