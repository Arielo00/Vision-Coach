from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import cv2


def _closest_pose_frame(path: Path, frame_index: int) -> dict | None:
    closest: dict | None = None
    closest_distance = float("inf")
    with gzip.open(path, "rt", encoding="utf-8") as source:
        for line in source:
            item = json.loads(line)
            distance = abs(int(item["frame_index"]) - frame_index)
            if distance < closest_distance:
                closest = item
                closest_distance = distance
            if distance == 0 or int(item["frame_index"]) > frame_index:
                break
    return closest


def _save_video_frame(video_path: Path, frame_index: int, destination: Path) -> None:
    capture = cv2.VideoCapture(str(video_path))
    try:
        capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, frame = capture.read()
        if not ok or frame is None or not cv2.imwrite(str(destination), frame):
            raise RuntimeError("No fue posible extraer el frame marcado")
    finally:
        capture.release()


def _mean_keypoint_confidence(frame: dict | None) -> float | None:
    if not frame or not frame.get("people"):
        return None
    values = [
        float(value)
        for value in (frame["people"][0].get("keypoint_confidence") or [])
        if value is not None
    ]
    return sum(values) / len(values) if values else None


def save_hard_example(root: Path, job, payload, diagnostics: dict) -> dict:
    pose_path = Path(job.pose_artifact).resolve()
    video_path = Path(job.stored_path).resolve()
    pose_frame = _closest_pose_frame(pose_path, payload.frame_index)
    if pose_frame is None:
        raise RuntimeError("No existe pose para el frame marcado")
    actual_frame = int(pose_frame["frame_index"])
    repetition = next(
        (item for item in diagnostics.get("repetitions", []) if item.get("number") == payload.repetition_number),
        None,
    )

    example_id = str(uuid4())
    example_dir = root / example_id
    example_dir.mkdir(parents=True, exist_ok=False)
    frame_path = example_dir / "frame.jpg"
    _save_video_frame(video_path, actual_frame, frame_path)
    metadata = {
        "schema_version": 1,
        "id": example_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "job_id": job.id,
        "video_sha256": job.sha256,
        "original_filename": job.original_filename,
        "exercise": diagnostics.get("exercise", job.requested_exercise),
        "camera_view": job.camera_view,
        "frame_index_requested": payload.frame_index,
        "frame_index_saved": actual_frame,
        "timestamp_seconds": pose_frame.get("timestamp_seconds"),
        "repetition_number": payload.repetition_number,
        "correction_type": payload.correction_type,
        "note": payload.note,
        "original_confidence": _mean_keypoint_confidence(pose_frame),
        "pose_model": job.pose_model,
        "pose_prediction": pose_frame,
        "repetition_diagnostics": repetition,
        "artifacts": {"frame": "frame.jpg"},
        "export_status": "local_review_pending",
    }
    (example_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {key: metadata[key] for key in (
        "id", "created_at", "job_id", "exercise", "frame_index_saved",
        "repetition_number", "correction_type", "original_confidence", "export_status",
    )}
