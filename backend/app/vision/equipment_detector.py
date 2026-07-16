from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import numpy as np


@dataclass(slots=True)
class EquipmentDetection:
    label: str
    confidence: float
    xyxy: tuple[float, float, float, float]
    source_label: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


class EquipmentDetector(Protocol):
    model_name: str
    capability: str

    def predict(self, frame_rgb: np.ndarray) -> list[EquipmentDetection]: ...


class EquipmentDetectorUnavailable:
    """Implementación segura cuando no existe checkpoint ni bootstrap permitido."""

    model_name = "equipment-detector-not-configured"
    capability = "unavailable"

    def predict(self, frame_rgb: np.ndarray) -> list[EquipmentDetection]:
        return []


class RFDetrEquipmentDetector:
    """Adaptador local para checkpoints RF-DETR propios o el bootstrap COCO Nano."""

    def __init__(
        self,
        model_dir: Path,
        threshold: float = 0.35,
        checkpoint: Path | None = None,
        allow_coco_bootstrap: bool = True,
    ) -> None:
        import torch
        from rfdetr import RFDETR, RFDETRNano

        if not torch.cuda.is_available():
            raise RuntimeError("PyTorch no detectó la GPU NVIDIA/CUDA para RF-DETR de equipo.")
        model_dir.mkdir(parents=True, exist_ok=True)
        os.environ["RF_HOME"] = str(model_dir)
        self.threshold = threshold
        self.checkpoint = checkpoint
        if checkpoint is not None and checkpoint.is_file():
            self._model = RFDETR.from_checkpoint(str(checkpoint))
            self.capability = "custom_gym_equipment"
            self.model_name = f"RFDETRCustom:{checkpoint.name}"
            self.allowed_labels: set[str] | None = None
        elif allow_coco_bootstrap:
            self._model = RFDETRNano()
            self.capability = "coco_bootstrap_ball_only"
            self.model_name = "RFDETRNano:COCO-bootstrap"
            self.allowed_labels = {"sports_ball"}
        else:
            raise FileNotFoundError("No existe un checkpoint RF-DETR de equipo configurado.")
        try:
            self._model.optimize_for_inference(compile=False, batch_size=1, dtype="float16")
        except (RuntimeError, TypeError, ValueError):
            # El modelo sigue siendo utilizable sin optimización; se conserva un fallback explícito.
            pass

    def predict(self, frame_rgb: np.ndarray) -> list[EquipmentDetection]:
        detections = self._model.predict(frame_rgb, threshold=self.threshold, include_source_image=False)
        xyxy = np.asarray(detections.xyxy)
        confidence = np.asarray(detections.confidence)
        raw_names = detections.data.get("class_name")
        class_names = np.asarray(raw_names) if raw_names is not None else np.array([], dtype=object)
        result: list[EquipmentDetection] = []
        for index in range(len(xyxy)):
            raw_label = str(class_names[index]) if index < len(class_names) else ""
            label = canonical_equipment_label(raw_label)
            if not label or (self.allowed_labels is not None and label not in self.allowed_labels):
                continue
            box = tuple(float(value) for value in xyxy[index])
            result.append(EquipmentDetection(label, float(confidence[index]), box, raw_label))
        return result


def canonical_equipment_label(label: str) -> str:
    normalized = label.strip().lower().replace("-", "_").replace(" ", "_")
    return EQUIPMENT_ALIASES.get(normalized, normalized)


def build_equipment_detector(
    model_dir: Path,
    threshold: float,
    checkpoint: Path,
    allow_coco_bootstrap: bool,
) -> EquipmentDetector:
    try:
        return RFDetrEquipmentDetector(model_dir, threshold, checkpoint, allow_coco_bootstrap)
    except (FileNotFoundError, RuntimeError):
        if allow_coco_bootstrap:
            raise
        return EquipmentDetectorUnavailable()


def equipment_inference_applicable(exercise: str, checkpoint: Path, allow_coco_bootstrap: bool) -> bool:
    if checkpoint.is_file():
        return True
    return allow_coco_bootstrap and exercise in {"auto", "wall_ball_shot", "hyrox_wall_balls"}


EQUIPMENT_ALIASES = {
    "sports_ball": "sports_ball",
    "bar": "barbell",
    "barbell_bar": "barbell",
    "plate": "weight_plate",
    "box": "plyo_box",
    "medicine_ball": "wall_ball",
    "wallball": "wall_ball",
    "wall_ball_target_zone": "wall_ball_target",
    "pullup_bar": "pull_up_bar",
    "kettle_bell": "kettlebell",
}

GYM_EQUIPMENT_CLASSES = (
    "barbell", "weight_plate", "rig", "pull_up_bar", "rings", "parallel_bars", "plyo_box",
    "sled", "dumbbell", "kettlebell", "jump_rope", "climbing_rope", "wall_ball",
    "wall_ball_target", "sandbag", "rowing_erg", "ski_erg", "ghd", "wall",
)
