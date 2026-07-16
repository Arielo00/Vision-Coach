from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int, int]]:
    phase = config["phases"]
    ready = False
    start: int | None = None
    drive: int | None = None
    result: list[tuple[int, int, int]] = []
    for index, item in enumerate(metrics):
        knee = item.get("knee_angle")
        elbow = item.get("elbow_angle")
        overhead = item.get("wrists_above_shoulders")
        if knee is None:
            continue
        if start is None:
            if knee >= phase["ready_knee_min"] and not overhead:
                ready = True
            elif ready and knee <= phase["dip_knee_max"]:
                start = index
                drive = None
        else:
            if drive is None and knee >= phase["drive_knee_min"]:
                drive = index
            if drive is not None and overhead and elbow is not None and elbow >= phase["lockout_elbow_min"]:
                if index - start >= config["minimum_rep_frames"]:
                    result.append((start, drive, index))
                start = None
                drive = None
                ready = False
    return result


def analyze_push_press(frames: list[dict], camera_view: str) -> dict:
    config = load_config("push_press.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions: list[dict] = []
    for number, (start, drive_index, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        drive_offset = drive_index - start
        dip_segment = segment[: drive_offset + 1]
        press_segment = segment[drive_offset:]
        bottom = min(dip_segment, key=lambda item: item.get("knee_angle") if item.get("knee_angle") is not None else 999)
        min_knee = min((item["knee_angle"] for item in dip_segment if item["knee_angle"] is not None), default=None)
        max_dip_lean = max((item["torso_lean"] for item in dip_segment if item["torso_lean"] is not None), default=None)
        min_post_drive_knee = min((item["knee_angle"] for item in press_segment if item["knee_angle"] is not None), default=None)
        final_elbow = segment[-1].get("elbow_angle")
        confidence = mean(item["confidence"] for item in segment) or 0.0
        errors: list[dict] = []

        dip_rule = config["rules"]["excessive_dip"]
        if min_knee is not None and min_knee < dip_rule["minimum_dip_knee_angle"]:
            errors.append(make_error("excessive_dip", config, [bottom["frame_index"]], ["left_knee", "right_knee", "left_hip", "right_hip"]))
        torso_rule = config["rules"]["dip_torso_lean"]
        if camera_view in {"side", "three_quarter"} and max_dip_lean is not None and max_dip_lean > torso_rule["maximum_degrees_from_vertical"]:
            error_frame = max(dip_segment, key=lambda item: item.get("torso_lean") or -1)["frame_index"]
            errors.append(make_error("dip_torso_lean", config, [error_frame], ["left_shoulder", "right_shoulder", "left_hip", "right_hip"]))

        baseline_wrist = next((item["wrist_height_normalized"] for item in dip_segment if item.get("wrist_height_normalized") is not None), None)
        early_press = None
        if baseline_wrist is not None:
            early_press = next((item for item in dip_segment if item.get("wrist_height_normalized") is not None and item["wrist_height_normalized"] - baseline_wrist > config["rules"]["early_press"]["minimum_wrist_rise"] and (item.get("knee_angle") or 180) < config["rules"]["early_press"]["minimum_knee_angle_before_press"]), None)
        if early_press is not None:
            errors.append(make_error("early_press", config, [early_press["frame_index"]], ["left_wrist", "right_wrist", "left_knee", "right_knee"]))

        rebend = config["rules"]["knee_rebend"]
        if min_post_drive_knee is not None and min_post_drive_knee < rebend["minimum_post_drive_knee_angle"]:
            error_frame = min(press_segment, key=lambda item: item.get("knee_angle") if item.get("knee_angle") is not None else 999)["frame_index"]
            errors.append(make_error("knee_rebend", config, [error_frame], ["left_knee", "right_knee"]))
        lockout = config["rules"]["lockout"]
        if final_elbow is not None and final_elbow < lockout["minimum_elbow_angle"]:
            errors.append(make_error("lockout", config, [segment[-1]["frame_index"]], ["left_elbow", "right_elbow", "left_wrist", "right_wrist"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": bottom["frame_index"],
            "phase_frames": {"dip": segment[0]["frame_index"], "bottom": bottom["frame_index"], "drive": metrics[drive_index]["frame_index"], "lockout": segment[-1]["frame_index"]},
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {"minimum_dip_knee_angle": rounded(min_knee), "maximum_dip_torso_lean": rounded(max_dip_lean), "minimum_post_drive_knee_angle": rounded(min_post_drive_knee), "final_elbow_angle": rounded(final_elbow)},
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    warnings = ["La pose evalúa la secuencia dip-drive-brazos; el rack y la trayectoria de la barra quedan pendientes del detector de equipo."]
    if camera_view == "front":
        warnings.append("La vista frontal no permite evaluar con fiabilidad si el torso se mantiene vertical durante el dip.")
    if not repetitions:
        warnings.append("No se segmentó una secuencia completa de dip, extensión de piernas y bloqueo overhead.")
    result = summary_result("push_press", repetitions, warnings)
    result["equipment"] = {"required": ["barbell"], "detected": [], "status": "checkpoint_required", "message": "El rack y la trayectoria de barra requieren el checkpoint de equipo."}
    return result
