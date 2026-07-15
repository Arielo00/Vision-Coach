from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.config import DEFAULT_SETTINGS
from app.processing.media import iter_video_frames
from app.vision.equipment_detector import build_equipment_detector


def main() -> None:
    parser = argparse.ArgumentParser(description="Prueba el detector de equipo en cuadros concretos.")
    parser.add_argument("video", type=Path)
    parser.add_argument("--frames", default="0")
    parser.add_argument("--threshold", type=float, default=0.20)
    args = parser.parse_args()
    selected = {int(value) for value in args.frames.split(",") if value.strip()}
    detector = build_equipment_detector(
        DEFAULT_SETTINGS.rfdetr_model_dir,
        args.threshold,
        DEFAULT_SETTINGS.equipment_checkpoint,
        True,
    )
    results = []
    for frame in iter_video_frames(args.video):
        if frame.index not in selected:
            continue
        results.append({
            "frame_index": frame.index,
            "detections": [item.to_dict() for item in detector.predict(frame.rgb)],
        })
        if len(results) == len(selected):
            break
    print(json.dumps({"model": detector.model_name, "capability": detector.capability, "items": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
