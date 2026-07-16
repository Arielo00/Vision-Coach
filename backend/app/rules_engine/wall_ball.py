from __future__ import annotations

import json
from pathlib import Path

from app.exercise_classifier import classify_exercise
from app.rules_engine.geometry import angle_from_vertical, joint_angle, midpoint
from app.vision.equipment_trajectory import contact_events, trajectory_summary


CONFIG_PATH = Path(__file__).parent / "configs" / "wall_ball_shot.json"


def _mean(values: list[float | None]) -> float | None:
    usable = [float(value) for value in values if value is not None]
    return sum(usable) / len(usable) if usable else None


def _rounded(value: float | None) -> float | None:
    return round(value, 1) if value is not None else None


def _smooth_metrics(metrics: list[dict], radius: int = 2) -> list[dict]:
    numeric_fields = ("knee_angle", "left_knee_angle", "right_knee_angle", "hip_below_knee_normalized", "torso_lean", "confidence")
    smoothed: list[dict] = []
    for index, item in enumerate(metrics):
        updated = dict(item)
        window = metrics[max(0, index - radius) : min(len(metrics), index + radius + 1)]
        for field in numeric_fields:
            values = sorted(float(candidate[field]) for candidate in window if candidate.get(field) is not None)
            if values:
                updated[field] = values[len(values) // 2]
        overhead_values = [candidate["wrists_above_shoulders"] for candidate in window if candidate.get("wrists_above_shoulders") is not None]
        if overhead_values:
            updated["wrists_above_shoulders"] = sum(bool(value) for value in overhead_values) >= (len(overhead_values) + 1) // 2
        smoothed.append(updated)
    return smoothed


def frame_metrics(frame: dict, minimum_confidence: float) -> dict:
    person = frame.get("people", [None])[0] if frame.get("people") else None
    result = {
        "frame_index": frame["frame_index"],
        "timestamp_seconds": frame["timestamp_seconds"],
        "knee_angle": None,
        "left_knee_angle": None,
        "right_knee_angle": None,
        "hip_below_knee_normalized": None,
        "torso_lean": None,
        "wrists_above_shoulders": None,
        "confidence": 0.0,
    }
    if not person:
        return result

    xy = person.get("xy") or []
    confidence = person.get("keypoint_confidence") or []
    if len(xy) < 17 or len(confidence) < 17:
        return result

    def point(index: int):
        value = confidence[index]
        return xy[index] if value is not None and float(value) >= minimum_confidence else (None, None)

    left_knee = joint_angle(point(11), point(13), point(15))
    right_knee = joint_angle(point(12), point(14), point(16))
    shoulders = midpoint(point(5), point(6))
    hips = midpoint(point(11), point(12))
    knees = midpoint(point(13), point(14))
    ankles = midpoint(point(15), point(16))
    torso_lean = angle_from_vertical(shoulders, hips) if shoulders and hips else None
    wrist_y = _mean([point(9)[1], point(10)[1]])
    shoulder_y = _mean([point(5)[1], point(6)[1]])
    overhead = wrist_y < shoulder_y if wrist_y is not None and shoulder_y is not None else None
    body_height = abs(ankles[1] - shoulders[1]) if ankles and shoulders else None
    hip_depth = (
        (hips[1] - knees[1]) / body_height
        if hips and knees and body_height is not None and body_height > 1
        else None
    )

    important = [confidence[index] for index in (5, 6, 9, 10, 11, 12, 13, 14, 15, 16)]
    result.update(
        knee_angle=_mean([left_knee, right_knee]),
        left_knee_angle=left_knee,
        right_knee_angle=right_knee,
        hip_below_knee_normalized=hip_depth,
        torso_lean=torso_lean,
        wrists_above_shoulders=overhead,
        confidence=_mean([float(value) for value in important if value is not None]) or 0.0,
    )
    return result


def _error(rule_name: str, config: dict, frames: list[int], joints: list[str]) -> dict:
    rule = config["rules"][rule_name]
    return {
        "type": rule_name,
        "description": rule["description"],
        "severity": rule["severity"],
        "correction": rule["correction"],
        "frames": frames,
        "joints": joints,
    }


def _segment(metrics: list[dict], config: dict) -> list[tuple[int, int]]:
    phases = config["phases"]
    minimum_frames = int(config["minimum_rep_frames"])
    ready = False
    start_index: int | None = None
    repetitions: list[tuple[int, int]] = []
    for index, item in enumerate(metrics):
        knee = item.get("knee_angle")
        if knee is None:
            continue
        if start_index is None:
            if knee >= phases["ready_knee_min"]:
                ready = True
            elif ready and knee <= phases["descent_knee_max"]:
                start_index = index
        elif knee >= phases["finish_knee_min"]:
            if index - start_index >= minimum_frames:
                repetitions.append((start_index, index))
            start_index = None
            ready = True
    return repetitions


def analyze_wall_ball(frames: list[dict], camera_view: str, requested_exercise: str) -> dict:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    metrics = _smooth_metrics([frame_metrics(frame, config["minimum_joint_confidence"]) for frame in frames])
    classification = (
        classify_exercise(metrics)
        if requested_exercise == "auto"
        else {"exercise": "wall_ball_shot", "confidence": 1.0, "reason": "Ejercicio seleccionado manualmente."}
    )
    effective_exercise = requested_exercise if requested_exercise != "auto" else classification["exercise"]
    source = "automatic" if requested_exercise == "auto" else "manual"

    if effective_exercise != "wall_ball_shot":
        return {
            "exercise": effective_exercise,
            "exercise_source": source,
            "exercise_confidence": classification["confidence"] if source == "automatic" else 1.0,
            "classification_reason": classification["reason"],
            "status": "unsupported_or_uncertain",
            "warnings": ["El clasificador no alcanzó confianza suficiente para aplicar las reglas de wall ball."],
            "summary": {"repetitions_detected": 0, "correct_repetitions": 0, "incorrect_repetitions": 0},
            "repetitions": [],
        }

    repetitions = []
    for number, (start, end) in enumerate(_segment(metrics, config), start=1):
        segment = metrics[start : end + 1]
        knee_items = [item for item in segment if item["knee_angle"] is not None]
        bottom = min(knee_items, key=lambda item: item["knee_angle"]) if knee_items else segment[0]
        min_knee = min((item["knee_angle"] for item in knee_items), default=None)
        max_knee = max((item["knee_angle"] for item in knee_items), default=None)
        depth_items = [item for item in segment if item["hip_below_knee_normalized"] is not None]
        deepest = max(depth_items, key=lambda item: item["hip_below_knee_normalized"]) if depth_items else bottom
        max_hip_depth = max((item["hip_below_knee_normalized"] for item in depth_items), default=None)
        max_lean = max((item["torso_lean"] for item in segment if item["torso_lean"] is not None), default=None)
        asymmetries = [
            abs(item["left_knee_angle"] - item["right_knee_angle"])
            for item in segment
            if item["left_knee_angle"] is not None and item["right_knee_angle"] is not None
        ]
        max_asymmetry = max(asymmetries, default=None)
        overhead = any(item["wrists_above_shoulders"] is True for item in segment)
        rep_confidence = _mean([item["confidence"] for item in segment]) or 0.0
        errors = []

        depth_rule = config["rules"]["depth"]
        if max_hip_depth is not None and max_hip_depth < depth_rule["minimum_hip_below_knee_normalized"] - depth_rule.get("tolerance_normalized", 0):
            errors.append(_error("depth", config, [deepest["frame_index"]], ["left_hip", "right_hip", "left_knee", "right_knee"]))
        torso_rule = config["rules"]["torso_lean"]
        if camera_view in {"side", "three_quarter"} and max_lean is not None and max_lean > torso_rule["maximum_degrees_from_vertical"] + torso_rule.get("tolerance_degrees", 0):
            error_frame = max(segment, key=lambda item: item["torso_lean"] or -1)["frame_index"]
            errors.append(_error("torso_lean", config, [error_frame], ["left_hip", "right_hip", "left_shoulder", "right_shoulder"]))
        extension_rule = config["rules"]["full_extension"]
        if max_knee is not None and max_knee < extension_rule["minimum_knee_angle"] - extension_rule.get("tolerance_degrees", 0):
            errors.append(_error("full_extension", config, [segment[-1]["frame_index"]], ["left_knee", "right_knee", "left_hip", "right_hip"]))
        if not overhead:
            errors.append(_error("overhead_release", config, [segment[-1]["frame_index"]], ["left_wrist", "right_wrist", "left_shoulder", "right_shoulder"]))
        if camera_view in {"front", "three_quarter"} and max_asymmetry is not None and max_asymmetry > config["rules"]["knee_asymmetry"]["maximum_degrees"]:
            error_frame = max(segment, key=lambda item: abs((item["left_knee_angle"] or 0) - (item["right_knee_angle"] or 0)))["frame_index"]
            errors.append(_error("knee_asymmetry", config, [error_frame], ["left_knee", "right_knee"]))

        low_confidence = rep_confidence < config["minimum_rep_confidence"]
        repetitions.append({
            "number": number,
            "start_frame": segment[0]["frame_index"],
            "end_frame": segment[-1]["frame_index"],
            "bottom_frame": bottom["frame_index"],
            "phase_frames": {"descent": segment[0]["frame_index"], "bottom": bottom["frame_index"], "extension": segment[-1]["frame_index"]},
            "confidence": round(rep_confidence, 3),
            "valid": not low_confidence,
            "correct": not low_confidence and not errors,
            "metrics": {
                "minimum_knee_angle": _rounded(min_knee),
                "maximum_knee_angle": _rounded(max_knee),
                "maximum_hip_below_knee_normalized": round(max_hip_depth, 3) if max_hip_depth is not None else None,
                "maximum_torso_lean": _rounded(max_lean),
                "maximum_knee_asymmetry": _rounded(max_asymmetry),
                "overhead_release_observed": overhead,
            },
            "errors": errors if not low_confidence else [],
            "warnings": ["Confianza articular insuficiente; esta repetición no se diagnostica."] if low_confidence else [],
        })

    detected_equipment = sorted({item.get("label") for frame in frames for item in frame.get("equipment", []) if item.get("label")})
    ball_labels = {"wall_ball", "sports_ball"}
    target_labels = {"wall_ball_target"}
    ball_trajectory = trajectory_summary(frames, ball_labels)
    contacts = contact_events(frames, ball_labels, target_labels)
    target_evaluable = bool(ball_labels.intersection(detected_equipment) and target_labels.intersection(detected_equipment))
    last_frame = frames[-1]["frame_index"] if frames else 0
    for index, repetition in enumerate(repetitions):
        window_end = repetitions[index + 1]["start_frame"] - 1 if index + 1 < len(repetitions) else last_frame
        matching_contacts = [item for item in contacts if repetition["start_frame"] <= item["peak_frame"] <= window_end]
        repetition["metrics"]["target_contact_observed"] = bool(matching_contacts) if target_evaluable else None
        repetition["metrics"]["target_contact_confidence"] = max((item["confidence"] for item in matching_contacts), default=None)
        if target_evaluable and not matching_contacts and repetition["valid"]:
            repetition["errors"].append(_error("target_miss", config, [window_end], ["wall_ball", "wall_ball_target"]))
            repetition["correct"] = False

    correct = sum(rep["correct"] for rep in repetitions)
    warnings = []
    warnings.append("La profundidad usa la posición 2D de cadera respecto a rodilla como proxy del pliegue de cadera; no es una medición anatómica 3D.")
    if not target_evaluable:
        warnings.append("El impacto en la zona objetivo se omite hasta observar simultáneamente balón y blanco; el bootstrap COCO sólo aporta un candidato de balón.")
    else:
        warnings.append("El contacto balón-blanco es una intersección 2D temporal, no una medición física de impacto.")
    warnings.append("La pose no permite confirmar que el lanzamiento se realiza con ambas manos.")
    if camera_view == "unspecified":
        warnings.append("La vista no está etiquetada; no se evaluaron inclinación del torso ni simetría de rodillas.")
    elif camera_view == "front":
        warnings.append("La vista frontal permite evaluar simetría, pero no inclinación del torso.")
    elif camera_view == "side":
        warnings.append("La vista lateral permite evaluar inclinación del torso, pero no simetría izquierda/derecha.")
    if not repetitions:
        warnings.append("No se segmentó una repetición completa: debe verse el inicio erguido, la sentadilla y el retorno a extensión.")
    return {
        "exercise": "wall_ball_shot",
        "exercise_source": source,
        "exercise_confidence": classification["confidence"] if source == "automatic" else 1.0,
        "classification_reason": classification["reason"],
        "status": "completed",
        "warnings": warnings,
        "summary": {
            "repetitions_detected": len(repetitions),
            "correct_repetitions": correct,
            "incorrect_repetitions": len(repetitions) - correct,
        },
        "repetitions": repetitions,
        "equipment": {
            "required": ["wall_ball", "wall_ball_target"],
            "detected": detected_equipment,
            "status": "evaluated" if target_evaluable else ("partial_bootstrap" if ball_trajectory else "not_observed"),
            "message": "El blanco sólo se valida con el checkpoint custom; RF-DETR COCO puede aportar un candidato de balón.",
            "trajectory": ball_trajectory,
            "contact_events": contacts,
        },
    }
