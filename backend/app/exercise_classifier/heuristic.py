from __future__ import annotations


def _range(metrics: list[dict], field: str) -> float:
    values = [float(item[field]) for item in metrics if item.get(field) is not None]
    return max(values) - min(values) if values else 0.0


def _mean(metrics: list[dict], field: str) -> float:
    values = [float(item[field]) for item in metrics if item.get(field) is not None]
    return sum(values) / len(values) if values else 0.0


def _clip(value: float) -> float:
    return max(0.0, min(1.0, value))


def classify_exercise(frame_metrics: list[dict]) -> dict:
    usable = [item for item in frame_metrics if item.get("confidence", 0) >= 0.35]
    if len(usable) < 20:
        return {
            "exercise": "unknown",
            "confidence": 0.0,
            "reason": "No hay suficientes cuadros articulares confiables.",
            "candidates": [],
            "features": {"usable_frames": len(usable)},
        }

    knee_range = _range(usable, "knee_angle")
    hip_range = _range(usable, "hip_angle")
    elbow_range = _range(usable, "elbow_angle")
    wrist_range = _range(usable, "wrist_height_normalized")
    wrist_values = [float(item["wrist_height_normalized"]) for item in usable if item.get("wrist_height_normalized") is not None]
    peak_wrist = max(wrist_values, default=-1.0)
    overhead_ratio = sum(bool(item.get("wrists_above_shoulders")) for item in usable) / len(usable)
    quality = _clip(_mean(usable, "confidence"))

    knee_motion = _clip(knee_range / 55.0)
    hip_motion = _clip(hip_range / 45.0)
    elbow_motion = _clip(elbow_range / 70.0)
    wrist_motion = _clip(wrist_range / 0.45)
    overhead_event = _clip(overhead_ratio / 0.16)
    sustained_overhead = _clip(overhead_ratio / 0.65)

    raw_scores: dict[str, float] = {}
    if knee_range >= 35 and wrist_range >= 0.20 and overhead_ratio >= 0.05:
        raw_scores["wall_ball_shot"] = 0.45 * knee_motion + 0.35 * wrist_motion + 0.20 * overhead_event
    if knee_range >= 35 and overhead_ratio < 0.14:
        raw_scores["back_squat"] = 0.62 * knee_motion + 0.23 * (1 - overhead_event) + 0.15 * hip_motion
    if elbow_range >= 35 and overhead_ratio >= 0.42 and knee_range < 35:
        strict_score = 0.55 * elbow_motion + 0.30 * sustained_overhead + 0.15 * (1 - knee_motion)
        raw_scores["strict_pull_up"] = strict_score * (1 - 0.45 * hip_motion)
        if hip_range >= 28:
            raw_scores["kipping_pull_up"] = 0.42 * elbow_motion + 0.25 * sustained_overhead + 0.23 * hip_motion + 0.10 * (1 - knee_motion)
    if hip_range >= 24 and wrist_range >= 0.18 and knee_range < 55:
        variant = "kettlebell_swing_american" if peak_wrist >= 0.12 else "kettlebell_swing_russian"
        raw_scores[variant] = 0.45 * hip_motion + 0.30 * wrist_motion + 0.25 * (1 - _clip(knee_range / 65.0))

    candidates = sorted(
        ({"exercise": exercise, "confidence": round(_clip(score * quality), 3)} for exercise, score in raw_scores.items()),
        key=lambda item: item["confidence"],
        reverse=True,
    )
    best = candidates[0] if candidates else {"exercise": "unknown", "confidence": 0.0}
    features = {
        "usable_frames": len(usable),
        "knee_angle_range": round(knee_range, 1),
        "hip_angle_range": round(hip_range, 1),
        "elbow_angle_range": round(elbow_range, 1),
        "wrist_height_range": round(wrist_range, 3),
        "overhead_ratio": round(overhead_ratio, 3),
        "mean_pose_confidence": round(quality, 3),
    }
    if best["confidence"] < 0.55:
        return {
            "exercise": "unknown",
            "confidence": best["confidence"],
            "reason": "El patrón no supera el umbral mínimo; conviene seleccionar el ejercicio manualmente.",
            "candidates": candidates[:3],
            "features": features,
        }

    caveat = ""
    if best["exercise"] == "back_squat":
        caveat = " Sin detectar la barra, esta primera versión reconoce un patrón de sentadilla, no distingue todavía back/front/air squat."
    return {
        "exercise": best["exercise"],
        "confidence": best["confidence"],
        "reason": f"Patrón temporal compatible con {best['exercise'].replace('_', ' ')}.{caveat}",
        "candidates": candidates[:3],
        "features": features,
    }
