from __future__ import annotations

from collections import Counter
from statistics import mean


ROM_METRICS = {
    "wall_ball_shot": ("minimum_knee_angle", "maximum_knee_angle", "ROM de rodilla"),
    "hyrox_wall_balls": ("minimum_knee_angle", "maximum_knee_angle", "ROM de rodilla"),
    "back_squat": ("minimum_knee_angle", "maximum_knee_angle", "ROM de rodilla"),
    "strict_pull_up": ("minimum_elbow_angle", "maximum_elbow_angle", "ROM de codo"),
    "kettlebell_swing_russian": ("minimum_hip_angle", "maximum_hip_angle", "ROM de cadera"),
    "kettlebell_swing_american": ("minimum_hip_angle", "maximum_hip_angle", "ROM de cadera"),
}


def _rounded_mean(values: list[float]) -> float | None:
    return round(mean(values), 2) if values else None


def _slope(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    x_mean = (len(values) - 1) / 2
    y_mean = mean(values)
    denominator = sum((index - x_mean) ** 2 for index in range(len(values)))
    if denominator == 0:
        return None
    return round(sum((index - x_mean) * (value - y_mean) for index, value in enumerate(values)) / denominator, 3)


def session_snapshot(job, diagnostics: dict) -> dict:
    repetitions = diagnostics.get("repetitions", [])
    summary = diagnostics.get("summary", {})
    detected = int(summary.get("repetitions_detected", 0))
    correct = int(summary.get("correct_repetitions", 0))
    rate = round(correct / detected * 100, 2) if detected else None
    confidence = _rounded_mean([
        float(rep["confidence"]) for rep in repetitions if rep.get("confidence") is not None
    ])
    exercise = diagnostics.get("exercise", job.requested_exercise)
    rom_definition = ROM_METRICS.get(exercise)
    rom_values: list[float] = []
    if rom_definition:
        minimum_key, maximum_key, _label = rom_definition
        for rep in repetitions:
            minimum = rep.get("metrics", {}).get(minimum_key)
            maximum = rep.get("metrics", {}).get(maximum_key)
            if isinstance(minimum, (int, float)) and isinstance(maximum, (int, float)):
                rom_values.append(float(maximum) - float(minimum))
    errors = Counter(
        issue["type"]
        for rep in repetitions
        for issue in rep.get("errors", [])
    )
    return {
        "job_id": job.id,
        "date": job.created_at,
        "filename": job.original_filename,
        "exercise": exercise,
        "camera_view": job.camera_view,
        "repetitions": detected,
        "correct_repetitions": correct,
        "incorrect_repetitions": int(summary.get("incorrect_repetitions", 0)),
        "correct_rate": rate,
        "mean_confidence": confidence,
        "rom": {
            "value": _rounded_mean(rom_values),
            "label": rom_definition[2] if rom_definition else None,
            "unit": "degrees" if rom_definition else None,
        },
        "errors": dict(errors),
    }


def build_progress_payload(sessions: list[dict], exercise: str | None = None) -> dict:
    available = Counter(item["exercise"] for item in sessions)
    filtered = [item for item in sessions if not exercise or item["exercise"] == exercise]
    rom_comparable = bool(exercise) or len({item["exercise"] for item in filtered}) <= 1
    rates = [float(item["correct_rate"]) for item in filtered if item["correct_rate"] is not None]
    rom_values = [float(item["rom"]["value"]) for item in filtered if item["rom"]["value"] is not None] if rom_comparable else []
    total_reps = sum(item["repetitions"] for item in filtered)
    total_correct = sum(item["correct_repetitions"] for item in filtered)
    return {
        "exercise": exercise,
        "exercise_options": [{"exercise": name, "sessions": count} for name, count in sorted(available.items())],
        "summary": {
            "sessions": len(filtered),
            "total_repetitions": total_reps,
            "overall_correct_rate": round(total_correct / total_reps * 100, 2) if total_reps else None,
            "mean_rom": _rounded_mean(rom_values),
            "correct_rate_slope_per_session": _slope(rates),
            "rom_slope_per_session": _slope(rom_values),
            "rom_comparable": rom_comparable,
        },
        "sessions": filtered,
    }
