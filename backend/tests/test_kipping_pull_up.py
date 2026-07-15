from app.rules_engine import kipping_pull_up


def _metric_frames(error_case: bool = False) -> list[dict]:
    elbows = [160, 160, 155, 150, 130, 110, 80, 100, 125, 145, 155, 160]
    if error_case:
        shoulders = [170, 169, 168, 155, 150, 148, 145, 150, 155, 160, 165, 170]
        hips = [175, 150, 130, 115, 105, 100, 95, 105, 120, 140, 160, 175]
        horizontal = [0.35, 0.50, 0.70, 0.85, 0.55, 0.30, 0.20, 0.22, 0.21, 0.20, 0.19, 0.18]
        knees = [130] * len(elbows)
    else:
        shoulders = [170, 158, 150, 146, 145, 145, 148, 152, 158, 164, 168, 170]
        hips = [175, 170, 158, 145, 140, 145, 150, 158, 165, 170, 173, 175]
        horizontal = [0.35, 0.45, 0.60, 0.70, 0.55, 0.35, 0.20, 0.28, 0.38, 0.48, 0.55, 0.58]
        knees = [155] * len(elbows)
    return [
        {
            "frame_index": index,
            "timestamp_seconds": index / 30,
            "elbow_angle": elbow,
            "left_elbow_angle": elbow,
            "right_elbow_angle": elbow,
            "shoulder_angle": shoulders[index],
            "hip_angle": hips[index],
            "knee_angle": knees[index],
            "body_wrist_horizontal_normalized": horizontal[index],
            "confidence": 0.9,
        }
        for index, elbow in enumerate(elbows)
    ]


def test_kipping_pull_up_segments_arch_pull_push_and_hang(monkeypatch) -> None:
    monkeypatch.setattr(kipping_pull_up, "metrics_from_frames", lambda frames, threshold: _metric_frames())

    result = kipping_pull_up.analyze_kipping_pull_up([{}] * 12, "side")

    assert result["summary"]["repetitions_detected"] == 1
    assert result["repetitions"][0]["correct"] is True
    assert set(result["repetitions"][0]["phase_frames"]) == {
        "kip_arch", "kip_hollow", "pull", "top", "push_away", "hang"
    }


def test_kipping_pull_up_identifies_specific_coaching_causes(monkeypatch) -> None:
    monkeypatch.setattr(kipping_pull_up, "metrics_from_frames", lambda frames, threshold: _metric_frames(True))

    result = kipping_pull_up.analyze_kipping_pull_up([{}] * 12, "side")
    error_types = {item["type"] for item in result["repetitions"][0]["errors"]}

    assert "leg_initiated_swing" in error_types
    assert "missing_push_away" in error_types
    assert "excessive_swing_core_loss" in error_types
    assert "bent_knees_loose_body" in error_types
