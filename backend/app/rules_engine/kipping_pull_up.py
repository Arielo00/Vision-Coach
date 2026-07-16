from __future__ import annotations

from app.rules_engine.common import load_config, make_error, mean, metrics_from_frames, rounded, summary_result


def _segments(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phases = config["phases"]
    hanging = False
    hang_start: int | None = None
    start: int | None = None
    missing = 0
    result: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        elbow = item.get("elbow_angle")
        if elbow is None:
            if start is not None:
                missing += 1
                if missing > config.get("maximum_missing_metric_frames", 5):
                    start = None
                    hanging = False
                    hang_start = None
            continue
        missing = 0
        if start is not None:
            elapsed = float(item["timestamp_seconds"]) - float(metrics[start]["timestamp_seconds"])
            if elapsed > config.get("maximum_rep_seconds", 5.0):
                start = None
                hanging = False
                hang_start = None
        if start is None:
            if elbow >= phases["hang_elbow_min"]:
                if not hanging:
                    hang_start = index
                hanging = True
            elif hanging and elbow <= phases["pull_elbow_max"]:
                start = hang_start if hang_start is not None else index
        elif elbow >= phases["finish_elbow_min"]:
            if index - start >= config["minimum_rep_frames"]:
                result.append((start, index))
            start = None
            hanging = True
            hang_start = index
    return result


def _onset(segment: list[dict], field: str, delta: float) -> int | None:
    values = [(index, item.get(field)) for index, item in enumerate(segment) if item.get(field) is not None]
    if len(values) < 2:
        return None
    baseline = float(values[0][1])
    return next((index for index, value in values[1:] if abs(float(value) - baseline) >= delta), None)


def analyze_kipping_pull_up(frames: list[dict], camera_view: str) -> dict:
    config = load_config("kipping_pull_up.json")
    metrics = metrics_from_frames(frames, config["minimum_joint_confidence"])
    repetitions = []
    for number, (start, end) in enumerate(_segments(metrics, config), start=1):
        segment = metrics[start : end + 1]
        usable_elbows = [item for item in segment if item.get("elbow_angle") is not None]
        top = min(usable_elbows, key=lambda item: item["elbow_angle"]) if usable_elbows else segment[0]
        top_index = segment.index(top)
        min_elbow = min((item["elbow_angle"] for item in usable_elbows), default=None)
        max_elbow = max((item["elbow_angle"] for item in usable_elbows), default=None)
        top_wrist_items = [item for item in segment if item.get("wrist_height_normalized") is not None]
        minimum_top_wrist_height = min((item["wrist_height_normalized"] for item in top_wrist_items), default=None)
        hip_values = [item["hip_angle"] for item in segment if item.get("hip_angle") is not None]
        hip_range = max(hip_values) - min(hip_values) if hip_values else None
        horizontal_values = [item["body_wrist_horizontal_normalized"] for item in segment if item.get("body_wrist_horizontal_normalized") is not None]
        horizontal_range = max(horizontal_values) - min(horizontal_values) if horizontal_values else None
        knee_values = [item["knee_angle"] for item in segment if item.get("knee_angle") is not None]
        bent_fraction = (
            sum(value < config["rules"]["bent_knees_loose_body"]["minimum_knee_angle"] for value in knee_values) / len(knee_values)
            if knee_values
            else None
        )
        asymmetries = [
            abs(item["left_elbow_angle"] - item["right_elbow_angle"])
            for item in segment
            if item.get("left_elbow_angle") is not None and item.get("right_elbow_angle") is not None
        ]
        max_asymmetry = max(asymmetries, default=None)
        confidence = mean(item.get("confidence") for item in segment) or 0.0
        errors = []

        pull = config["rules"]["incomplete_pull"]
        elbow_incomplete = min_elbow is not None and min_elbow > pull["maximum_top_elbow_angle"] + pull.get("tolerance_degrees", 0)
        wrist_incomplete = minimum_top_wrist_height is None or minimum_top_wrist_height > pull["maximum_top_wrist_height_normalized"]
        if elbow_incomplete and wrist_incomplete:
            errors.append(make_error("incomplete_pull", config, [top["frame_index"]], ["left_elbow", "right_elbow"]))
        extension = config["rules"]["incomplete_extension"]
        if max_elbow is not None and max_elbow < extension["minimum_bottom_elbow_angle"] - extension.get("tolerance_degrees", 0):
            errors.append(make_error("incomplete_extension", config, [segment[-1]["frame_index"]], ["left_elbow", "right_elbow"]))

        if camera_view in {"side", "three_quarter"}:
            initiation = config["rules"]["leg_initiated_swing"]
            shoulder_onset = _onset(segment, "shoulder_angle", initiation["shoulder_delta_degrees"])
            hip_onset = _onset(segment, "hip_angle", initiation["hip_delta_degrees"])
            if shoulder_onset is not None and hip_onset is not None and hip_onset + initiation["maximum_hip_lead_frames"] < shoulder_onset:
                errors.append(make_error("leg_initiated_swing", config, [segment[hip_onset]["frame_index"]], ["left_shoulder", "right_shoulder", "left_hip", "right_hip"]))

            push_rule = config["rules"]["missing_push_away"]
            top_horizontal = top.get("body_wrist_horizontal_normalized")
            post_top = [item for item in segment[top_index + 1 :] if item.get("body_wrist_horizontal_normalized") is not None]
            horizontal_return = (
                max(item["body_wrist_horizontal_normalized"] for item in post_top) - top_horizontal
                if top_horizontal is not None and post_top
                else None
            )
            if horizontal_return is not None and horizontal_return < push_rule["minimum_horizontal_return"]:
                errors.append(make_error("missing_push_away", config, [top["frame_index"]], ["left_shoulder", "right_shoulder", "left_wrist", "right_wrist"]))

            excessive = config["rules"]["excessive_swing_core_loss"]
            if (hip_range is not None and hip_range > excessive["maximum_hip_angle_range"]) or (
                horizontal_range is not None and horizontal_range > excessive["maximum_body_wrist_horizontal_range"]
            ):
                error_frame = max(segment, key=lambda item: item.get("body_wrist_horizontal_normalized") or -1)["frame_index"]
                errors.append(make_error("excessive_swing_core_loss", config, [error_frame], ["left_shoulder", "right_shoulder", "left_hip", "right_hip", "left_knee", "right_knee"]))
            if bent_fraction is not None and bent_fraction > config["rules"]["bent_knees_loose_body"]["maximum_fraction"]:
                error_frame = min((item for item in segment if item.get("knee_angle") is not None), key=lambda item: item["knee_angle"])["frame_index"]
                errors.append(make_error("bent_knees_loose_body", config, [error_frame], ["left_knee", "right_knee", "left_ankle", "right_ankle"]))
        else:
            horizontal_return = None
            shoulder_onset = None
            hip_onset = None

        if camera_view in {"front", "three_quarter"} and max_asymmetry is not None and max_asymmetry > config["rules"]["elbow_asymmetry"]["maximum_degrees"]:
            error_frame = max(segment, key=lambda item: abs((item.get("left_elbow_angle") or 0) - (item.get("right_elbow_angle") or 0)))["frame_index"]
            errors.append(make_error("elbow_asymmetry", config, [error_frame], ["left_elbow", "right_elbow"]))

        low_confidence = confidence < config["minimum_rep_confidence"]
        arch = max((item for item in segment if item.get("hip_angle") is not None), key=lambda item: item["hip_angle"], default=segment[0])
        hollow = min((item for item in segment if item.get("hip_angle") is not None), key=lambda item: item["hip_angle"], default=segment[0])
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": top["frame_index"],
            "phase_frames": {
                "kip_arch": arch["frame_index"],
                "kip_hollow": hollow["frame_index"],
                "pull": segment[0]["frame_index"],
                "top": top["frame_index"],
                "push_away": post_top[0]["frame_index"] if camera_view in {"side", "three_quarter"} and post_top else top["frame_index"],
                "hang": segment[-1]["frame_index"],
            },
            "confidence": round(confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {
                "minimum_elbow_angle": rounded(min_elbow),
                "maximum_elbow_angle": rounded(max_elbow),
                "minimum_top_wrist_height_normalized": rounded(minimum_top_wrist_height),
                "hip_angle_range": rounded(hip_range),
                "body_wrist_horizontal_range": rounded(horizontal_range),
                "post_top_horizontal_return": rounded(horizontal_return),
                "bent_knee_fraction": rounded(bent_fraction),
                "shoulder_motion_onset_frame_offset": shoulder_onset,
                "hip_motion_onset_frame_offset": hip_onset,
                "maximum_elbow_asymmetry": rounded(max_asymmetry),
            },
            "errors": [] if low_confidence else errors,
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    warnings = [
        "El empuje posterior se estima como separación horizontal cuerpo-muñecas; no confirma fuerza aplicada sobre la barra.",
        "Sin detectar la barra no se evalúa si el mentón la supera.",
    ]
    if camera_view not in {"side", "three_quarter"}:
        warnings.append("La vista lateral o tres cuartos es necesaria para evaluar el ciclo arch-hollow y el retorno.")
    if not repetitions:
        warnings.append("No se segmentó un ciclo completo desde extensión, tirón y regreso.")
    result = summary_result("kipping_pull_up", repetitions, warnings)
    result["equipment"] = {
        "required": ["pull_up_bar"],
        "detected": [],
        "status": "checkpoint_required",
        "message": "La detección de barra habilitará el estándar mentón-sobre-barra y mejorará el marco de referencia del kip.",
    }
    return result
