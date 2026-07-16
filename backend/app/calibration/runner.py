from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from app.config import DEFAULT_SETTINGS
from app.exercise_classifier import classify_exercise
from app.processing.media import iter_video_frames, probe_video
from app.rules_engine import analyze_exercise
from app.rules_engine.common import metrics_from_frames
from app.vision.pose_estimator import RFDetrKeypointEstimator
from app.vision.tracking import PrimaryPersonTracker
from app.vision.equipment_detector import build_equipment_detector, equipment_inference_applicable
from app.vision.equipment_tracking import EquipmentTracker


def load_pose(path: Path) -> list[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return [json.loads(line) for line in source]


def run(video: Path, expected: str, camera_view: str, output_dir: Path, probe_only: bool, frame_stride: int) -> dict:
    video = video.resolve()
    metadata = probe_video(video)
    metadata_dict = {
        "duration_seconds": metadata.duration_seconds,
        "fps": metadata.fps,
        "width": metadata.width,
        "height": metadata.height,
        "codec": metadata.codec,
        "frame_count": metadata.frame_count,
    }
    if probe_only:
        return {"video": str(video), "metadata": metadata_dict}

    output_dir.mkdir(parents=True, exist_ok=True)
    pose_path = output_dir / "pose.jsonl.gz"
    if pose_path.exists():
        frames = load_pose(pose_path)
    else:
        estimator = RFDetrKeypointEstimator(
            DEFAULT_SETTINGS.pose_threshold,
            DEFAULT_SETTINGS.rfdetr_model_dir,
        )
        equipment_detector = (
            build_equipment_detector(
                DEFAULT_SETTINGS.rfdetr_model_dir,
                DEFAULT_SETTINGS.equipment_threshold,
                DEFAULT_SETTINGS.equipment_checkpoint,
                DEFAULT_SETTINGS.equipment_coco_bootstrap,
            )
            if DEFAULT_SETTINGS.enable_equipment and equipment_inference_applicable(expected, DEFAULT_SETTINGS.equipment_checkpoint, DEFAULT_SETTINGS.equipment_coco_bootstrap)
            else None
        )
        frames = []
        tracker = PrimaryPersonTracker(DEFAULT_SETTINGS.pose_threshold)
        equipment_tracker = EquipmentTracker()
        with gzip.open(pose_path, "wt", encoding="utf-8") as output:
            for frame in iter_video_frames(video):
                if frame.index % frame_stride != 0:
                    continue
                equipment = []
                if equipment_detector is not None:
                    equipment = equipment_tracker.update(
                        equipment_detector.predict(frame.rgb),
                        (frame.rgb.shape[0], frame.rgb.shape[1]),
                    )
                record = {
                    "frame_index": frame.index,
                    "timestamp_seconds": frame.timestamp_seconds,
                    "people": tracker.order(estimator.predict(frame.rgb)),
                    "equipment": equipment,
                    "equipment_model": equipment_detector.model_name if equipment_detector is not None else None,
                    "equipment_capability": equipment_detector.capability if equipment_detector is not None else "unavailable",
                }
                frames.append(record)
                output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
                if (frame.index + 1) % 60 == 0:
                    print(f"processed_frames={frame.index + 1}", flush=True)

    classification = classify_exercise(metrics_from_frames(frames, 0.40))
    diagnostics = analyze_exercise(frames, camera_view, expected)
    result = {
        "video": str(video),
        "expected_exercise": expected,
        "camera_view": camera_view,
        "metadata": metadata_dict,
        "classification": classification,
        "diagnostics": diagnostics,
    }
    (output_dir / "summary.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Evalúa un video de referencia sin convertirlo en sesión de usuario.")
    parser.add_argument("video", type=Path)
    parser.add_argument("--expected", default="auto")
    parser.add_argument("--camera-view", default="unspecified")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--frame-stride", type=int, default=1)
    args = parser.parse_args()
    result = run(args.video, args.expected, args.camera_view, args.output_dir, args.probe_only, max(1, args.frame_stride))
    if args.probe_only:
        print(json.dumps(result, ensure_ascii=False))
    else:
        summary = {
            "classification": result["classification"],
            "repetitions": result["diagnostics"]["summary"],
            "output": str(args.output_dir.resolve()),
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
