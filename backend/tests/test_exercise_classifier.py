from app.exercise_classifier import classify_exercise


def sequence(**series) -> list[dict]:
    length = len(next(iter(series.values())))
    return [
        {"confidence": 0.9, **{name: values[index] for name, values in series.items()}}
        for index in range(length)
    ]


def alternating(low: float, high: float, length: int = 40) -> list[float]:
    return [low if (index // 5) % 2 else high for index in range(length)]


def test_classifies_wall_ball_pattern() -> None:
    metrics = sequence(
        knee_angle=alternating(95, 165),
        hip_angle=alternating(105, 170),
        elbow_angle=alternating(120, 165),
        wrist_height_normalized=alternating(-0.25, 0.25),
        wrists_above_shoulders=[index % 2 == 0 for index in range(40)],
    )
    assert classify_exercise(metrics)["exercise"] == "wall_ball_shot"


def test_classifies_squat_pattern_with_caveat() -> None:
    metrics = sequence(
        knee_angle=alternating(90, 165),
        hip_angle=alternating(100, 170),
        elbow_angle=[150.0] * 40,
        wrist_height_normalized=[-0.2] * 40,
        wrists_above_shoulders=[False] * 40,
    )
    result = classify_exercise(metrics)
    assert result["exercise"] == "back_squat"
    assert "no distingue" in result["reason"]


def test_classifies_strict_pull_up_pattern() -> None:
    metrics = sequence(
        knee_angle=[165.0] * 40,
        hip_angle=[170.0] * 40,
        elbow_angle=alternating(65, 165),
        wrist_height_normalized=[0.4] * 40,
        wrists_above_shoulders=[True] * 40,
    )
    assert classify_exercise(metrics)["exercise"] == "strict_pull_up"


def test_classifies_kipping_pull_up_from_elbow_motion_and_cyclic_hip_range() -> None:
    metrics = sequence(
        knee_angle=alternating(155, 170),
        hip_angle=alternating(125, 175),
        elbow_angle=alternating(70, 165),
        wrist_height_normalized=alternating(0.05, 0.45),
        wrists_above_shoulders=[True] * 40,
    )

    result = classify_exercise(metrics)

    assert result["exercise"] == "kipping_pull_up"
    assert result["confidence"] > 0.8


def test_classifies_american_kettlebell_swing_pattern() -> None:
    metrics = sequence(
        knee_angle=alternating(125, 160),
        hip_angle=alternating(115, 170),
        elbow_angle=[160.0] * 40,
        wrist_height_normalized=alternating(-0.25, 0.2),
        wrists_above_shoulders=[index % 2 == 0 for index in range(40)],
    )
    assert classify_exercise(metrics)["exercise"] == "kettlebell_swing_american"
