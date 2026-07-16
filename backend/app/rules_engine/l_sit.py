from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phase = config["phases"]
    start: int | None = None
    result: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        hip = item.get("hip_angle")
        elbow = item.get("elbow_angle")
        candidate = hip is not None and elbow is not None and hip <= phase["candidate_hip_max"] and elbow >= phase["candidate_elbow_min"]
        if candidate and start is None:
            start = index
        elif not candidate and start is not None:
            if index - start >= config["minimum_hold_frames"]:
                result.append((start, index - 1))
            start = None
    if start is not None and len(metrics) - start >= config["minimum_hold_frames"]:
        result.append((start, len(metrics) - 1))
    return result


def analyze_l_sit(frames: list[dict], camera_view: str) -> dict:
    config = load_config("l_sit.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions: list[dict] = []
    if camera_view == "front":
        result = summary_result("l_sit", [], ["La vista frontal no permite medir con fiabilidad el ángulo cadera-tronco. Usa vista lateral o 3/4."])
        result["status"] = "unsupported_view"
        result["equipment"] = {"required": ["parallel_bars_or_floor"], "detected": [], "status": "not_evaluated", "message": "Selecciona una vista lateral antes de evaluar el apoyo."}
        return result

    for number, (start, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        peak = min(segment, key=lambda item: item.get("hip_angle") if item.get("hip_angle") is not None else 999)
        hip_values = [item["hip_angle"] for item in segment if item["hip_angle"] is not None]
        knee_values = [item["knee_angle"] for item in segment if item["knee_angle"] is not None]
        elbow_values = [item["elbow_angle"] for item in segment if item["elbow_angle"] is not None]
        mean_hip = mean(hip_values)
        min_knee = min(knee_values, default=None)
        min_elbow = min(elbow_values, default=None)
        confidence = mean(item["confidence"] for item in segment) or 0.0
        duration = max(0.0, float(segment[-1]["timestamp_seconds"]) - float(segment[0]["timestamp_seconds"]))
        errors: list[dict] = []

        hip_rule = config["rules"]["leg_height"]
        if mean_hip is not None and mean_hip > hip_rule["maximum_mean_hip_angle"]:
            errors.append(make_error("leg_height", config, [peak["frame_index"]], ["left_hip", "right_hip", "left_ankle", "right_ankle"]))
        knee_rule = config["rules"]["bent_knees"]
        if min_knee is not None and min_knee < knee_rule["minimum_knee_angle"]:
            error_frame = min(segment, key=lambda item: item.get("knee_angle") if item.get("knee_angle") is not None else 999)["frame_index"]
            errors.append(make_error("bent_knees", config, [error_frame], ["left_knee", "right_knee"]))
        elbow_rule = config["rules"]["soft_support"]
        if min_elbow is not None and min_elbow < elbow_rule["minimum_elbow_angle"]:
            error_frame = min(segment, key=lambda item: item.get("elbow_angle") if item.get("elbow_angle") is not None else 999)["frame_index"]
            errors.append(make_error("soft_support", config, [error_frame], ["left_elbow", "right_elbow"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": peak["frame_index"],
            "phase_frames": {"hold_start": segment[0]["frame_index"], "peak": peak["frame_index"], "hold_end": segment[-1]["frame_index"]},
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {"hold_duration_seconds": rounded(duration), "mean_hip_angle": rounded(mean_hip), "minimum_knee_angle": rounded(min_knee), "minimum_elbow_angle": rounded(min_elbow)},
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; este intento no se diagnostica."] if low_confidence else [],
        })

    warnings = ["Cada intervalo estable se reporta como un intento de sostén; no como una repetición dinámica."]
    if not repetitions:
        warnings.append("No se detectó un sostén lateral continuo con cadera flexionada y brazos de apoyo.")
    result = summary_result("l_sit", repetitions, warnings)
    result["equipment"] = {"required": ["parallel_bars_or_floor"], "detected": [], "status": "checkpoint_required", "message": "La pose evalúa el cuerpo; la superficie de apoyo aún no se confirma visualmente."}
    return result
