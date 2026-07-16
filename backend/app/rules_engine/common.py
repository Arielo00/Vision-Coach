from __future__ import annotations

import json
from pathlib import Path

from app.rules_engine.geometry import angle_from_vertical, joint_angle, midpoint


CONFIG_DIR = Path(__file__).parent / "configs"


def load_config(name: str) -> dict:
    return json.loads((CONFIG_DIR / name).read_text(encoding="utf-8"))


def mean(values) -> float | None:
    usable = [float(value) for value in values if value is not None]
    return sum(usable) / len(usable) if usable else None


def rounded(value: float | None) -> float | None:
    return round(value, 1) if value is not None else None


def make_error(rule_name: str, config: dict, frames: list[int], joints: list[str]) -> dict:
    rule = config["rules"][rule_name]
    return {
        "type": rule_name,
        "description": rule["description"],
        "severity": rule["severity"],
        "correction": rule["correction"],
        "frames": frames,
        "joints": joints,
    }


def pose_metrics(frame: dict, minimum_confidence: float) -> dict:
    person = frame.get("people", [None])[0] if frame.get("people") else None
    result = {
        "frame_index": frame["frame_index"],
        "timestamp_seconds": frame["timestamp_seconds"],
        "knee_angle": None,
        "left_knee_angle": None,
        "right_knee_angle": None,
        "hip_angle": None,
        "left_hip_angle": None,
        "right_hip_angle": None,
        "elbow_angle": None,
        "left_elbow_angle": None,
        "right_elbow_angle": None,
        "shoulder_angle": None,
        "left_shoulder_angle": None,
        "right_shoulder_angle": None,
        "torso_lean": None,
        "wrist_height_normalized": None,
        "body_wrist_horizontal_normalized": None,
        "ankle_separation_normalized": None,
        "knee_separation_normalized": None,
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
    left_hip = joint_angle(point(5), point(11), point(13))
    right_hip = joint_angle(point(6), point(12), point(14))
    left_elbow = joint_angle(point(5), point(7), point(9))
    right_elbow = joint_angle(point(6), point(8), point(10))
    left_shoulder = joint_angle(point(11), point(5), point(7))
    right_shoulder = joint_angle(point(12), point(6), point(8))
    shoulders = midpoint(point(5), point(6))
    hips = midpoint(point(11), point(12))
    ankles = midpoint(point(15), point(16))
    wrists = midpoint(point(9), point(10))
    torso_lean = angle_from_vertical(shoulders, hips) if shoulders and hips else None
    torso_length = (
        ((shoulders[0] - hips[0]) ** 2 + (shoulders[1] - hips[1]) ** 2) ** 0.5
        if shoulders and hips
        else None
    )
    body_wrist_horizontal = (
        abs(hips[0] - wrists[0]) / torso_length
        if hips and wrists and torso_length is not None and torso_length > 1
        else None
    )
    shoulder_width = (
        ((point(5)[0] - point(6)[0]) ** 2 + (point(5)[1] - point(6)[1]) ** 2) ** 0.5
        if point(5)[0] is not None and point(6)[0] is not None
        else None
    )
    left_ankle, right_ankle = point(15), point(16)
    left_knee_point, right_knee_point = point(13), point(14)
    ankle_separation = (
        abs(left_ankle[0] - right_ankle[0]) / shoulder_width
        if left_ankle[0] is not None and right_ankle[0] is not None and shoulder_width and shoulder_width > 1
        else None
    )
    knee_separation = (
        abs(left_knee_point[0] - right_knee_point[0]) / shoulder_width
        if left_knee_point[0] is not None and right_knee_point[0] is not None and shoulder_width and shoulder_width > 1
        else None
    )
    body_height = abs(ankles[1] - shoulders[1]) if ankles and shoulders else None
    wrist_height = (
        (shoulders[1] - wrists[1]) / body_height
        if shoulders and wrists and body_height is not None and body_height > 1
        else None
    )
    important = [float(confidence[index]) for index in (5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16) if confidence[index] is not None]
    result.update(
        knee_angle=mean([left_knee, right_knee]),
        left_knee_angle=left_knee,
        right_knee_angle=right_knee,
        hip_angle=mean([left_hip, right_hip]),
        left_hip_angle=left_hip,
        right_hip_angle=right_hip,
        elbow_angle=mean([left_elbow, right_elbow]),
        left_elbow_angle=left_elbow,
        right_elbow_angle=right_elbow,
        shoulder_angle=mean([left_shoulder, right_shoulder]),
        left_shoulder_angle=left_shoulder,
        right_shoulder_angle=right_shoulder,
        torso_lean=torso_lean,
        wrist_height_normalized=wrist_height,
        body_wrist_horizontal_normalized=body_wrist_horizontal,
        ankle_separation_normalized=ankle_separation,
        knee_separation_normalized=knee_separation,
        wrists_above_shoulders=wrist_height >= 0 if wrist_height is not None else None,
        confidence=mean(important) or 0.0,
    )
    return result


def smooth_metrics(metrics: list[dict], radius: int = 2) -> list[dict]:
    numeric_fields = (
        "knee_angle", "left_knee_angle", "right_knee_angle",
        "hip_angle", "left_hip_angle", "right_hip_angle",
        "elbow_angle", "left_elbow_angle", "right_elbow_angle",
        "shoulder_angle", "left_shoulder_angle", "right_shoulder_angle",
        "torso_lean", "wrist_height_normalized", "confidence",
        "body_wrist_horizontal_normalized", "ankle_separation_normalized", "knee_separation_normalized",
    )
    smoothed: list[dict] = []
    for index, item in enumerate(metrics):
        updated = dict(item)
        window = metrics[max(0, index - radius) : min(len(metrics), index + radius + 1)]
        for field in numeric_fields:
            values = sorted(float(candidate[field]) for candidate in window if candidate.get(field) is not None)
            if values:
                updated[field] = values[len(values) // 2]
        overhead = [candidate["wrists_above_shoulders"] for candidate in window if candidate.get("wrists_above_shoulders") is not None]
        if overhead:
            updated["wrists_above_shoulders"] = sum(bool(value) for value in overhead) >= (len(overhead) + 1) // 2
        smoothed.append(updated)
    return smoothed


def metrics_from_frames(frames: list[dict], minimum_confidence: float) -> list[dict]:
    return smooth_metrics([pose_metrics(frame, minimum_confidence) for frame in frames])


def summary_result(exercise: str, repetitions: list[dict], warnings: list[str]) -> dict:
    correct = sum(rep["correct"] for rep in repetitions)
    return {
        "exercise": exercise,
        "exercise_source": "manual",
        "exercise_confidence": 1.0,
        "classification_reason": "Ejercicio seleccionado manualmente.",
        "status": "completed",
        "warnings": warnings,
        "summary": {
            "repetitions_detected": len(repetitions),
            "correct_repetitions": correct,
            "incorrect_repetitions": len(repetitions) - correct,
        },
        "repetitions": repetitions,
    }
