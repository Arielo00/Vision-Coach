from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phases = config["phases"]
    hanging = False
    start: int | None = None
    result: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        elbow = item.get("elbow_angle")
        if elbow is None:
            continue
        if start is None:
            if elbow >= phases["hang_elbow_min"]:
                hanging = True
            elif hanging and elbow <= phases["pull_elbow_max"]:
                start = index
        elif elbow >= phases["finish_elbow_min"]:
            if index - start >= config["minimum_rep_frames"]:
                result.append((start, index))
            start = None
            hanging = True
    return result


def analyze_strict_pull_up(frames: list[dict], camera_view: str) -> dict:
    config = load_config("strict_pull_up.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions = []
    for number, (start, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        usable = [item for item in segment if item["elbow_angle"] is not None]
        top = min(usable, key=lambda item: item["elbow_angle"]) if usable else segment[0]
        min_elbow = min((item["elbow_angle"] for item in usable), default=None)
        max_elbow = max((item["elbow_angle"] for item in usable), default=None)
        hip_values = [item["hip_angle"] for item in segment if item["hip_angle"] is not None]
        hip_range = max(hip_values) - min(hip_values) if hip_values else None
        elbow_asymmetries = [abs(item["left_elbow_angle"] - item["right_elbow_angle"]) for item in segment if item["left_elbow_angle"] is not None and item["right_elbow_angle"] is not None]
        max_asymmetry = max(elbow_asymmetries, default=None)
        confidence = mean(item["confidence"] for item in segment) or 0.0
        errors = []

        pull = config["rules"]["incomplete_pull"]
        if min_elbow is not None and min_elbow > pull["maximum_top_elbow_angle"] + pull.get("tolerance_degrees", 0):
            errors.append(make_error("incomplete_pull", config, [top["frame_index"]], ["left_elbow", "right_elbow", "left_shoulder", "right_shoulder"]))
        extension = config["rules"]["incomplete_extension"]
        if max_elbow is not None and max_elbow < extension["minimum_bottom_elbow_angle"] - extension.get("tolerance_degrees", 0):
            errors.append(make_error("incomplete_extension", config, [segment[-1]["frame_index"]], ["left_elbow", "right_elbow"]))
        if camera_view in {"side", "three_quarter"} and hip_range is not None and hip_range > config["rules"]["kipping"]["maximum_hip_angle_range"]:
            error_frame = max(segment, key=lambda item: item["hip_angle"] or -1)["frame_index"]
            errors.append(make_error("kipping", config, [error_frame], ["left_hip", "right_hip", "left_knee", "right_knee"]))
        if camera_view in {"front", "three_quarter"} and max_asymmetry is not None and max_asymmetry > config["rules"]["elbow_asymmetry"]["maximum_degrees"]:
            error_frame = max(segment, key=lambda item: abs((item["left_elbow_angle"] or 0) - (item["right_elbow_angle"] or 0)))["frame_index"]
            errors.append(make_error("elbow_asymmetry", config, [error_frame], ["left_elbow", "right_elbow"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": top["frame_index"],
            "phase_frames": {"pull": segment[0]["frame_index"], "top": top["frame_index"], "descent": segment[-1]["frame_index"]},
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {"minimum_elbow_angle": rounded(min_elbow), "maximum_elbow_angle": rounded(max_elbow), "hip_angle_range": rounded(hip_range), "maximum_elbow_asymmetry": rounded(max_asymmetry)},
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    warnings = ["Sin detectar la barra no se evalúa todavía si el mentón la supera."]
    if camera_view == "unspecified":
        warnings.append("Etiqueta la vista para evaluar balanceo de cadera o asimetría de brazos.")
    if not repetitions:
        warnings.append("No se segmentó una dominada completa desde extensión, tirón y regreso.")
    result = summary_result("strict_pull_up", repetitions, warnings)
    result["equipment"] = {"required": ["pull_up_bar"], "detected": [], "status": "checkpoint_required", "message": "La posición de la barra requiere el detector de equipo para validar el mentón sobre ella."}
    return result
