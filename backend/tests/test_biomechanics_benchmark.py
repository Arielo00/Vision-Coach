from tools.evaluate_biomechanics import evaluate_rows


def test_biomechanics_benchmark_separates_false_positives_causes_and_abstention() -> None:
    correct_case = {
        "id": "correct", "exercise": "air_squat", "form_label": "correct",
        "expected": {"repetition_count": 1, "repetitions": [{"number": 1, "correct": True, "errors": []}]},
    }
    error_case = {
        "id": "error", "exercise": "air_squat", "form_label": "intentional_error",
        "expected": {"repetition_count": 1, "repetitions": [{"number": 1, "correct": False, "errors": ["depth"]}]},
    }
    prediction_correct = {"repetitions": [{"number": 1, "valid": True, "correct": True, "errors": []}], "warnings": []}
    prediction_error = {"repetitions": [{"number": 1, "valid": True, "correct": False, "errors": [{"type": "depth"}]}], "warnings": []}

    report = evaluate_rows([(correct_case, prediction_correct), (error_case, prediction_error)])

    assert report["repetition_count"]["mean_absolute_error"] == 0
    assert report["form_error_detection"]["f1"] == 1
    assert report["error_type_detection"]["f1"] == 1
    assert report["abstention"]["rate"] == 0
    assert report["limitations"] == []
