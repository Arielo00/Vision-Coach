from __future__ import annotations

from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class VideoJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    content_type: str | None
    size_bytes: int
    camera_view: str
    requested_exercise: str
    status: str
    stage: str
    progress: int
    duration_seconds: float | None
    fps: float | None
    width: int | None
    height: int | None
    codec: str | None
    frame_count: int | None
    processed_frames: int
    max_people_detected: int
    pose_frames_with_person: int
    mean_keypoint_confidence: float | None
    pose_model: str | None
    pose_artifact: str | None
    created_at: datetime
    updated_at: datetime
    error_message: str | None


class HealthResponse(BaseModel):
    status: str
    storage: str
    scope: str
    gpu_available: bool


class ExerciseOption(BaseModel):
    id: str
    label: str
    category: str
    categories: list[str] = Field(default_factory=list)
    variants: list[str] = Field(default_factory=list)
    family: str
    maturity: str
    preferred_views: list[str] = Field(default_factory=list)
    required_equipment: list[str] = Field(default_factory=list)
    limiting_factor: str


class ExerciseSelectionRequest(BaseModel):
    exercise: str


class HardExampleRequest(BaseModel):
    frame_index: int = Field(ge=0)
    repetition_number: int | None = Field(default=None, ge=1)
    correction_type: Literal[
        "keypoints",
        "false_positive_error",
        "false_negative_error",
        "exercise_classification",
        "phase_or_count",
        "other",
    ]
    note: str | None = Field(default=None, max_length=500)
