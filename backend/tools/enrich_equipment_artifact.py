from __future__ import annotations

import argparse
import gzip
import json
import shutil
from pathlib import Path

from app.calibration.runner import load_pose
from app.config import DEFAULT_SETTINGS
from app.processing.media import iter_video_frames
from app.storage.database import Database, VideoJob
from app.vision.equipment_detector import build_equipment_detector
from app.vision.equipment_tracking import EquipmentTracker


def main() -> None:
    parser = argparse.ArgumentParser(description="Añade detecciones RF-DETR de equipo a un artefacto de pose existente.")
    parser.add_argument("job_id")
    parser.add_argument("--stride", type=int, default=2)
    parser.add_argument("--threshold", type=float, default=0.25)
    args = parser.parse_args()

    database = Database(DEFAULT_SETTINGS)
    database.initialize()
    with database.session_factory() as session:
        job = session.get(VideoJob, args.job_id)
        if job is None or not job.pose_artifact:
            raise ValueError("Trabajo inexistente o sin artefacto de pose.")
        video = Path(job.stored_path)
        pose_path = Path(job.pose_artifact)
    records = load_pose(pose_path)
    by_frame = {int(item["frame_index"]): item for item in records}
    detector = build_equipment_detector(
        DEFAULT_SETTINGS.rfdetr_model_dir,
        args.threshold,
        DEFAULT_SETTINGS.equipment_checkpoint,
        True,
    )
    tracker = EquipmentTracker()
    observations = 0
    labels: set[str] = set()
    stride = max(args.stride, 1)
    for frame in iter_video_frames(video):
        record = by_frame.get(frame.index)
        if record is None:
            continue
        equipment = []
        if frame.index % stride == 0:
            equipment = tracker.update(detector.predict(frame.rgb), (frame.rgb.shape[0], frame.rgb.shape[1]))
        record["equipment"] = equipment
        record["equipment_model"] = detector.model_name
        record["equipment_capability"] = detector.capability
        observations += len(equipment)
        labels.update(item["label"] for item in equipment)

    backup = pose_path.with_name(f"{pose_path.stem}.pre-equipment{pose_path.suffix}")
    if not backup.exists():
        shutil.copy2(pose_path, backup)
    temporary = pose_path.with_suffix(pose_path.suffix + ".tmp")
    with gzip.open(temporary, "wt", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")
    temporary.replace(pose_path)
    print(json.dumps({
        "job_id": args.job_id,
        "model": detector.model_name,
        "capability": detector.capability,
        "observations": observations,
        "labels": sorted(labels),
        "artifact": str(pose_path),
        "backup": str(backup),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
