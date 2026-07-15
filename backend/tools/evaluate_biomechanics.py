from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from app.calibration.runner import load_pose, run as run_calibration
from app.config import DEFAULT_SETTINGS, PROJECT_ROOT
from app.rules_engine import analyze_exercise
from app.storage.database import Database, VideoJob


def safe_div(numerator: int | float, denominator: int | float) -> float | None:
    return numerator / denominator if denominator else None


def classification_metrics(tp: int, fp: int, fn: int) -> dict:
    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    f1 = safe_div(2 * precision * recall, precision + recall) if precision is not None and recall is not None else None
    return {"true_positive": tp, "false_positive": fp, "false_negative": fn, "precision": precision, "recall": recall, "f1": f1}


def load_cases(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def prediction_for(case: dict, analyze_missing: bool) -> dict | None:
    if case.get("summary"):
        path = (PROJECT_ROOT / case["summary"]).resolve()
        if path.is_file():
            payload = json.loads(path.read_text(encoding="utf-8"))
            return payload.get("diagnostics", payload)
    if case.get("job_id"):
        database = Database(DEFAULT_SETTINGS)
        database.initialize()
        with database.session_factory() as session:
            job = session.get(VideoJob, case["job_id"])
            if job and job.pose_artifact and Path(job.pose_artifact).is_file():
                return analyze_exercise(load_pose(Path(job.pose_artifact)), case["camera_view"], case["exercise"])
    if case.get("file") and analyze_missing:
        video = (PROJECT_ROOT / case["file"]).resolve()
        output = DEFAULT_SETTINGS.calibration_dir / "benchmark" / case["id"]
        return run_calibration(video, case["exercise"], case["camera_view"], output, False, 1)["diagnostics"]
    return None


def evaluate_rows(rows: list[tuple[dict, dict | None]]) -> dict:
    available = [(case, prediction) for case, prediction in rows if prediction is not None]
    count_errors = []
    exact_counts = 0
    aligned_repetitions = 0
    abstentions = 0
    form_tp = form_fp = form_fn = form_tn = 0
    error_tp = error_fp = error_fn = 0
    per_exercise: dict[str, list[tuple[dict, dict | None]]] = defaultdict(list)
    details = []
    for case, prediction in rows:
        per_exercise[case["exercise"]].append((case, prediction))
        if prediction is None:
            details.append({"id": case["id"], "status": "prediction_missing"})
            continue
        expected_reps = case["expected"].get("repetitions", [])
        predicted_reps = prediction.get("repetitions", [])
        expected_count = case["expected"].get("repetition_count")
        if expected_count is not None:
            difference = abs(len(predicted_reps) - int(expected_count))
            count_errors.append(difference)
            exact_counts += int(difference == 0)
        for expected, predicted in zip(expected_reps, predicted_reps):
            aligned_repetitions += 1
            if not predicted.get("valid", False):
                abstentions += 1
                continue
            true_error = not bool(expected["correct"])
            predicted_error = not bool(predicted["correct"])
            form_tp += int(true_error and predicted_error)
            form_fp += int(not true_error and predicted_error)
            form_fn += int(true_error and not predicted_error)
            form_tn += int(not true_error and not predicted_error)
            expected_errors = set(expected.get("errors", []))
            predicted_errors = {item["type"] for item in predicted.get("errors", [])}
            error_tp += len(expected_errors & predicted_errors)
            error_fp += len(predicted_errors - expected_errors)
            error_fn += len(expected_errors - predicted_errors)
        details.append({
            "id": case["id"],
            "status": "evaluated",
            "expected_count": expected_count,
            "predicted_count": len(predicted_reps),
            "predicted_correct": sum(bool(item.get("correct")) for item in predicted_reps),
            "predicted_errors": [
                {"number": item.get("number"), "types": [error.get("type") for error in item.get("errors", [])]}
                for item in predicted_reps
            ],
            "warnings": prediction.get("warnings", []),
        })
    total_form = form_tp + form_fp + form_fn + form_tn
    return {
        "coverage": {
            "cases_total": len(rows),
            "cases_evaluated": len(available),
            "correct_clips": sum(case.get("form_label") == "correct" for case, _ in rows),
            "intentional_error_clips": sum(case.get("form_label") == "intentional_error" for case, _ in rows),
            "exercises": sorted(per_exercise),
        },
        "repetition_count": {
            "clips_with_count_label": len(count_errors),
            "mean_absolute_error": sum(count_errors) / len(count_errors) if count_errors else None,
            "exact_accuracy": exact_counts / len(count_errors) if count_errors else None,
        },
        "form_error_detection": classification_metrics(form_tp, form_fp, form_fn) | {
            "true_negative": form_tn,
            "accuracy": safe_div(form_tp + form_tn, total_form),
        },
        "error_type_detection": classification_metrics(error_tp, error_fp, error_fn),
        "abstention": {
            "aligned_repetitions": aligned_repetitions,
            "count": abstentions,
            "rate": safe_div(abstentions, aligned_repetitions),
        },
        "limitations": [
            "No puede estimarse sensibilidad hasta incorporar clips con errores intencionales."
        ] if not any(case.get("form_label") == "intentional_error" for case, _ in rows) else [],
        "details": details,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evalúa conteo, forma, causas y abstención por ejercicio.")
    parser.add_argument("--manifest", type=Path, default=PROJECT_ROOT / "inputs" / "biomechanics_benchmark" / "manifest.jsonl")
    parser.add_argument("--output", type=Path, default=DEFAULT_SETTINGS.data_dir / "biomechanics_benchmark.json")
    parser.add_argument("--analyze-missing", action="store_true")
    args = parser.parse_args()
    cases = load_cases(args.manifest)
    report = evaluate_rows([(case, prediction_for(case, args.analyze_missing)) for case in cases])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
