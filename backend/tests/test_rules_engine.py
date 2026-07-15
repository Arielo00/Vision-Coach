import pytest

from app.rules_engine import analyze_exercise


@pytest.mark.parametrize(
    ("exercise", "equipment"),
    [
        ("back_squat", "barbell"),
        ("strict_pull_up", "pull_up_bar"),
        ("kettlebell_swing_russian", "kettlebell"),
        ("kettlebell_swing_american", "kettlebell"),
        ("wall_ball_shot", "wall_ball"),
    ],
)
def test_supported_rule_engines_return_structured_result(exercise: str, equipment: str) -> None:
    result = analyze_exercise([], "side", exercise)

    assert result["exercise"] == exercise
    assert result["status"] == "completed"
    assert result["summary"]["repetitions_detected"] == 0
    assert equipment in result["equipment"]["required"]


def test_unsupported_exercise_keeps_pose_without_inventing_rules() -> None:
    result = analyze_exercise([], "front", "sled_push")

    assert result["status"] == "rules_not_available"
    assert result["repetitions"] == []
