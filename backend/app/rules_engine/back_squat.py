from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phases = config["phases"]
    ready = False
    start: int | None = None
    result: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        knee = item.get("knee_angle")
        if knee is None:
            continue
        if start is None:
            if knee >= phases["ready_knee_min"]:
                ready = True
            elif ready and knee <= phases["descent_knee_max"]:
                start = index
        elif knee >= phases["finish_knee_min"]:
            if index - start >= config["minimum_rep_frames"]:
                result.append((start, index))
            start = None
            ready = True
    return result


def analyze_squat(frames: list[dict], camera_view: str, exercise: str = "back_squat") -> dict:
    config = load_config(f"{exercise}.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions = []
    for number, (start, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        usable = [item for item in segment if item["knee_angle"] is not None]
        bottom = min(usable, key=lambda item: item["knee_angle"]) if usable else segment[0]
        min_knee = min((item["knee_angle"] for item in usable), default=None)
        max_knee = max((item["knee_angle"] for item in usable), default=None)
        max_lean = max((item["torso_lean"] for item in segment if item["torso_lean"] is not None), default=None)
        asymmetries = [abs(item["left_knee_angle"] - item["right_knee_angle"]) for item in segment if item["left_knee_angle"] is not None and item["right_knee_angle"] is not None]
        max_asymmetry = max(asymmetries, default=None)
        overhead_values = [item["wrists_above_shoulders"] for item in segment if item["wrists_above_shoulders"] is not None]
        overhead_fraction = sum(bool(value) for value in overhead_values) / len(overhead_values) if overhead_values else None
        confidence = mean(item["confidence"] for item in segment) or 0.0
        errors = []

        depth = config["rules"]["depth"]
        if min_knee is not None and min_knee > depth["maximum_bottom_knee_angle"] + depth.get("tolerance_degrees", 0):
            errors.append(make_error("depth", config, [bottom["frame_index"]], ["left_knee", "right_knee", "left_hip", "right_hip"]))
        lockout = config["rules"]["lockout"]
        if max_knee is not None and max_knee < lockout["minimum_knee_angle"] - lockout.get("tolerance_degrees", 0):
            errors.append(make_error("lockout", config, [segment[-1]["frame_index"]], ["left_knee", "right_knee", "left_hip", "right_hip"]))
        if camera_view in {"side", "three_quarter"} and max_lean is not None and max_lean > config["rules"]["torso_lean"]["maximum_degrees_from_vertical"]:
            error_frame = max(segment, key=lambda item: item["torso_lean"] or -1)["frame_index"]
            errors.append(make_error("torso_lean", config, [error_frame], ["left_shoulder", "right_shoulder", "left_hip", "right_hip"]))
        if camera_view in {"front", "three_quarter"} and max_asymmetry is not None and max_asymmetry > config["rules"]["knee_asymmetry"]["maximum_degrees"]:
            error_frame = max(segment, key=lambda item: abs((item["left_knee_angle"] or 0) - (item["right_knee_angle"] or 0)))["frame_index"]
            errors.append(make_error("knee_asymmetry", config, [error_frame], ["left_knee", "right_knee"]))
        if "overhead_stability" in config["rules"] and overhead_fraction is not None:
            overhead = config["rules"]["overhead_stability"]
            if overhead_fraction < overhead["minimum_frame_fraction"]:
                error_frame = min(segment, key=lambda item: item.get("wrist_height_normalized") if item.get("wrist_height_normalized") is not None else 999)["frame_index"]
                errors.append(make_error("overhead_stability", config, [error_frame], ["left_wrist", "right_wrist", "left_shoulder", "right_shoulder"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": bottom["frame_index"],
            "phase_frames": {"descent": segment[0]["frame_index"], "bottom": bottom["frame_index"], "ascent": segment[-1]["frame_index"]},
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {"minimum_knee_angle": rounded(min_knee), "maximum_knee_angle": rounded(max_knee), "maximum_torso_lean": rounded(max_lean), "maximum_knee_asymmetry": rounded(max_asymmetry), "overhead_frame_fraction": rounded(overhead_fraction)},
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    warnings = []
    if camera_view == "unspecified":
        warnings.append("Etiqueta la vista para evaluar inclinación del torso o simetría de rodillas.")
    if not repetitions:
        warnings.append("No se segmentó una sentadilla completa con inicio y final en extensión.")
    if config.get("position_requires_equipment_detection"):
        warnings.append(config["position_requires_equipment_detection"])
    result = summary_result(exercise, repetitions, warnings)
    required_equipment = config.get("required_equipment", [])
    result["equipment"] = {
        "required": required_equipment,
        "detected": [],
        "status": "checkpoint_required" if required_equipment else "not_required",
        "message": "La posición y trayectoria de la carga se validarán con el checkpoint de equipo." if required_equipment else "Este análisis de pose no requiere detectar un implemento.",
    }
    return result


def analyze_back_squat(frames: list[dict], camera_view: str) -> dict:
    return analyze_squat(frames, camera_view, "back_squat")
