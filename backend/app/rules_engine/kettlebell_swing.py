from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phases = config["phases"]
    extended = False
    start: int | None = None
    result: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        hip = item.get("hip_angle")
        if hip is None:
            continue
        if start is None:
            if hip >= phases["ready_hip_min"]:
                extended = True
            elif extended and hip <= phases["backswing_hip_max"]:
                start = index
        elif hip >= phases["finish_hip_min"]:
            if index - start >= config["minimum_rep_frames"]:
                result.append((start, index))
            start = None
            extended = True
    return result


def analyze_kettlebell_swing(frames: list[dict], camera_view: str, exercise: str) -> dict:
    config = load_config("kettlebell_swing.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions = []
    for number, (start, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        hip_items = [item for item in segment if item["hip_angle"] is not None]
        backswing = min(hip_items, key=lambda item: item["hip_angle"]) if hip_items else segment[0]
        min_hip = min((item["hip_angle"] for item in hip_items), default=None)
        max_hip = max((item["hip_angle"] for item in hip_items), default=None)
        min_knee = min((item["knee_angle"] for item in segment if item["knee_angle"] is not None), default=None)
        min_elbow = min((item["elbow_angle"] for item in segment if item["elbow_angle"] is not None), default=None)
        max_wrist_height = max((item["wrist_height_normalized"] for item in segment if item["wrist_height_normalized"] is not None), default=None)
        confidence = mean(item["confidence"] for item in segment) or 0.0
        errors = []

        extension = config["rules"]["hip_extension"]
        if max_hip is not None and max_hip < extension["minimum_hip_angle"] - extension.get("tolerance_degrees", 0):
            errors.append(make_error("hip_extension", config, [segment[-1]["frame_index"]], ["left_hip", "right_hip", "left_knee", "right_knee"]))
        arm = config["rules"]["arm_bend"]
        if min_elbow is not None and min_elbow < arm["minimum_elbow_angle"] - arm.get("tolerance_degrees", 0):
            error_frame = min(segment, key=lambda item: item["elbow_angle"] if item["elbow_angle"] is not None else 999)["frame_index"]
            errors.append(make_error("arm_bend", config, [error_frame], ["left_elbow", "right_elbow"]))
        if min_knee is not None and min_knee < config["rules"]["squat_dominant"]["minimum_knee_angle"]:
            error_frame = min(segment, key=lambda item: item["knee_angle"] if item["knee_angle"] is not None else 999)["frame_index"]
            errors.append(make_error("squat_dominant", config, [error_frame], ["left_knee", "right_knee", "left_hip", "right_hip"]))
        height_rule = "american_height" if exercise == "kettlebell_swing_american" else "russian_height"
        if max_wrist_height is not None and max_wrist_height < config["rules"][height_rule]["minimum_wrist_height"]:
            error_frame = max(segment, key=lambda item: item["wrist_height_normalized"] if item["wrist_height_normalized"] is not None else -999)["frame_index"]
            errors.append(make_error(height_rule, config, [error_frame], ["left_wrist", "right_wrist", "left_shoulder", "right_shoulder"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": backswing["frame_index"],
            "phase_frames": {"backswing": backswing["frame_index"], "extension": segment[-1]["frame_index"]},
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {"minimum_hip_angle": rounded(min_hip), "maximum_hip_angle": rounded(max_hip), "minimum_knee_angle": rounded(min_knee), "minimum_elbow_angle": rounded(min_elbow), "maximum_wrist_height": rounded(max_wrist_height)},
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    warnings = []
    if camera_view not in {"side", "three_quarter"}:
        warnings.append("La bisagra de cadera es más confiable desde una vista lateral o tres cuartos.")
    if not repetitions:
        warnings.append("No se segmentó un ciclo completo de backswing y extensión de cadera.")
    result = summary_result(exercise, repetitions, warnings)
    result["equipment"] = {"required": ["kettlebell"], "detected": [], "status": "checkpoint_required", "message": "La pesa rusa requiere un checkpoint de objetos de gimnasio para validar su trayectoria."}
    return result
