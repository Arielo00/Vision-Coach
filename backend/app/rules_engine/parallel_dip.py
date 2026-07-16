from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phases = config["phases"]
    ready = False
    start: int | None = None
    segments: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        elbow = item.get("elbow_angle")
        if elbow is None:
            continue
        if start is None:
            if elbow >= phases["support_elbow_min"]:
                ready = True
            elif ready and elbow <= phases["descent_elbow_max"]:
                start = index
        elif elbow >= phases["finish_elbow_min"]:
            if index - start >= config["minimum_rep_frames"]:
                segments.append((start, index))
            start = None
            ready = True
    return segments


def analyze_parallel_dip(frames: list[dict], camera_view: str) -> dict:
    config = load_config("parallel_dip.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions: list[dict] = []
    for number, (start, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        elbow_items = [item for item in segment if item["elbow_angle"] is not None]
        bottom = min(elbow_items, key=lambda item: item["elbow_angle"]) if elbow_items else segment[0]
        min_elbow = min((item["elbow_angle"] for item in elbow_items), default=None)
        max_elbow = max((item["elbow_angle"] for item in elbow_items), default=None)
        max_shoulder = max((item["shoulder_angle"] for item in segment if item["shoulder_angle"] is not None), default=None)
        asymmetries = [abs(item["left_elbow_angle"] - item["right_elbow_angle"]) for item in segment if item["left_elbow_angle"] is not None and item["right_elbow_angle"] is not None]
        max_asymmetry = max(asymmetries, default=None)
        confidence = mean(item["confidence"] for item in segment) or 0.0
        errors: list[dict] = []

        depth = config["rules"]["insufficient_depth"]
        if min_elbow is not None and min_elbow > depth["maximum_bottom_elbow_angle"] + depth.get("tolerance_degrees", 0):
            errors.append(make_error("insufficient_depth", config, [bottom["frame_index"]], ["left_elbow", "right_elbow"]))
        shoulder = config["rules"]["excessive_shoulder_depth"]
        if camera_view in {"side", "three_quarter"} and max_shoulder is not None and max_shoulder > shoulder["maximum_trunk_arm_angle"]:
            error_frame = max(segment, key=lambda item: item.get("shoulder_angle") or -1)["frame_index"]
            errors.append(make_error("excessive_shoulder_depth", config, [error_frame], ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow"]))
        lockout = config["rules"]["incomplete_support"]
        if max_elbow is not None and max_elbow < lockout["minimum_elbow_angle"] - lockout.get("tolerance_degrees", 0):
            errors.append(make_error("incomplete_support", config, [segment[-1]["frame_index"]], ["left_elbow", "right_elbow"]))
        if camera_view in {"front", "three_quarter"} and max_asymmetry is not None and max_asymmetry > config["rules"]["elbow_asymmetry"]["maximum_degrees"]:
            error_frame = max(segment, key=lambda item: abs((item.get("left_elbow_angle") or 0) - (item.get("right_elbow_angle") or 0)))["frame_index"]
            errors.append(make_error("elbow_asymmetry", config, [error_frame], ["left_elbow", "right_elbow", "left_shoulder", "right_shoulder"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": bottom["frame_index"],
            "phase_frames": {"descent": segment[0]["frame_index"], "bottom": bottom["frame_index"], "support": segment[-1]["frame_index"]},
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {"minimum_elbow_angle": rounded(min_elbow), "maximum_elbow_angle": rounded(max_elbow), "maximum_trunk_arm_angle": rounded(max_shoulder), "maximum_elbow_asymmetry": rounded(max_asymmetry)},
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    warnings = ["COCO-17 no distingue hiperextensión del codo ni confirma el apoyo sobre las paralelas; esos criterios quedan sin evaluar."]
    if camera_view == "unspecified":
        warnings.append("Etiqueta la vista: lateral evalúa profundidad de hombro y frontal evalúa asimetría.")
    if not repetitions:
        warnings.append("No se segmentó un fondo completo desde soporte, descenso y regreso al soporte.")
    result = summary_result("parallel_dip", repetitions, warnings)
    result["equipment"] = {"required": ["parallel_bars"], "detected": [], "status": "checkpoint_required", "message": "La presencia y el contacto con las paralelas requieren detección de equipo."}
    return result
