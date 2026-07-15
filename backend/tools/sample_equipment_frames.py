from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import av
import numpy as np

from app.config import PROJECT_ROOT


VIDEO_SUFFIXES = {".mp4", ".mov"}
SUGGESTED_CLASSES = {
    "wall ball": ["wall_ball", "wall_ball_target"],
    "pull-up": ["pull_up_bar"],
    "pull up": ["pull_up_bar"],
    "toes-to-bar": ["pull_up_bar"],
    "muscle-up": ["pull_up_bar", "rings"],
    "ring ": ["rings"],
    "dumbbell": ["dumbbell"],
    "overhead squat": ["barbell", "weight_plate"],
    "push jerk": ["barbell", "weight_plate"],
    "clean": ["barbell", "weight_plate"],
    "row": ["rowing_erg"],
    "ghd": ["ghd"],
}


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def class_hints(name: str) -> list[str]:
    lowered = name.lower()
    return sorted({label for term, labels in SUGGESTED_CLASSES.items() if term in lowered for label in labels})


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrae cuadros diversos para anotar equipo en Roboflow.")
    parser.add_argument("--input", type=Path, action="append")
    parser.add_argument("--output", type=Path, default=PROJECT_ROOT / "inputs" / "equipment_dataset" / "seed_frames")
    parser.add_argument("--interval-seconds", type=float, default=1.5)
    parser.add_argument("--max-per-video", type=int, default=36)
    parser.add_argument("--minimum-change", type=float, default=2.0)
    args = parser.parse_args()
    roots = args.input or [PROJECT_ROOT / "inputs" / "references" / "videos", PROJECT_ROOT / "inputs" / "videos"]
    videos = sorted({path.resolve() for root in roots for path in root.rglob("*") if path.suffix.lower() in VIDEO_SUFFIXES})
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for video in videos:
        saved = 0
        previous_small = None
        with av.open(str(video)) as container:
            stream = container.streams.video[0]
            fps = float(stream.average_rate) if stream.average_rate else 30.0
            step = max(1, round(fps * args.interval_seconds))
            for frame_index, frame in enumerate(container.decode(stream)):
                if frame_index % step:
                    continue
                image = frame.to_image()
                small = np.asarray(image.resize((64, 36)).convert("L"), dtype=np.float32)
                if float(np.std(small)) < 8.0:
                    continue
                change = float(np.mean(np.abs(small - previous_small))) if previous_small is not None else None
                previous_small = small
                if change is not None and change < args.minimum_change:
                    continue
                filename = f"{slug(video.stem)}__f{frame_index:06d}.jpg"
                destination = args.output / filename
                image.save(destination, quality=92)
                timestamp = float(frame.time) if frame.time is not None else frame_index / fps
                records.append({
                    "image": filename,
                    "source_video": str(video.relative_to(PROJECT_ROOT)),
                    "frame_index": frame_index,
                    "timestamp_seconds": round(timestamp, 3),
                    "suggested_classes_for_annotation": class_hints(video.name),
                    "annotation_status": "pending",
                })
                saved += 1
                if saved >= args.max_per_video:
                    break
    manifest = args.output / "seed_manifest.jsonl"
    manifest.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in records), encoding="utf-8")
    print(json.dumps({"videos": len(videos), "frames": len(records), "output": str(args.output.resolve()), "manifest": str(manifest.resolve())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
