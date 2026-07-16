from __future__ import annotations

import math
import os
from importlib.metadata import version
from pathlib import Path
from typing import Protocol

import numpy as np


COCO_KEYPOINT_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]


def _json_safe(value):
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    if isinstance(value, (np.floating, float)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, (np.integer, int)):
        return int(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    return value


class PoseEstimator(Protocol):
    model_name: str
    device: str

    def predict(self, frame_rgb: np.ndarray) -> list[dict]: ...


class RFDetrKeypointEstimator:
    model_name = f"RFDETRKeypointPreview@{version('rfdetr')}"

    def __init__(self, threshold: float = 0.35, model_dir: Path | None = None) -> None:
        import torch
        from rfdetr import RFDETRKeypointPreview

        if not torch.cuda.is_available():
            raise RuntimeError("PyTorch no detectó la GPU NVIDIA/CUDA.")
        if model_dir is not None:
            model_dir.mkdir(parents=True, exist_ok=True)
            os.environ["RF_HOME"] = str(model_dir)
        self.device = f"cuda:{torch.cuda.current_device()}"
        self.threshold = threshold
        self._model = RFDETRKeypointPreview()

    def predict(self, frame_rgb: np.ndarray) -> list[dict]:
        keypoints = self._model.predict(frame_rgb, threshold=self.threshold)
        xy = np.asarray(keypoints.xy)
        if xy.size == 0:
            return []

        count = xy.shape[0]
        keypoint_confidence = np.asarray(keypoints.keypoint_confidence)
        detection_confidence = np.asarray(keypoints.detection_confidence)
        visible = np.asarray(keypoints.visible)
        covariance = keypoints.data.get("covariance")
        covariance_array = np.asarray(covariance) if covariance is not None else None

        people: list[dict] = []
        for person_index in range(count):
            person = {
                "detection_confidence": _json_safe(detection_confidence[person_index]),
                "keypoint_names": COCO_KEYPOINT_NAMES,
                "xy": _json_safe(xy[person_index]),
                "keypoint_confidence": _json_safe(keypoint_confidence[person_index]),
                "visible": _json_safe(visible[person_index]),
                "covariance": (
                    _json_safe(covariance_array[person_index])
                    if covariance_array is not None
                    else None
                ),
                "uncertainty_kind": "rfdetr_covariance" if covariance_array is not None else "confidence_only",
            }
            people.append(person)
        return people


def gpu_available() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except ImportError:
        return False
