from __future__ import annotations

import gzip
import json
from pathlib import Path


class ReferenceLibrary:
    def __init__(self, root: Path) -> None:
        self.root = root

    def list(self, exercise: str | None = None) -> list[dict]:
        items: list[dict] = []
        if not self.root.exists():
            return items
        for summary_path in self.root.glob("*/summary.json"):
            try:
                payload = json.loads(summary_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            diagnostics = payload.get("diagnostics", {})
            current_exercise = diagnostics.get("exercise") or payload.get("expected_exercise")
            pose_path = summary_path.parent / "pose.jsonl.gz"
            correct = [rep for rep in diagnostics.get("repetitions", []) if rep.get("correct")]
            if not current_exercise or not pose_path.exists() or not correct:
                continue
            if exercise and current_exercise != exercise:
                continue
            items.append({
                "id": summary_path.parent.name,
                "exercise": current_exercise,
                "label": Path(payload.get("video", summary_path.parent.name)).stem,
                "camera_view": payload.get("camera_view", "unspecified"),
                "metadata": payload.get("metadata", {}),
                "repetitions": correct,
                "source": "calibration_library",
            })
        return sorted(items, key=lambda item: item["label"])

    def get(self, reference_id: str) -> dict | None:
        return next((item for item in self.list() if item["id"] == reference_id), None)

    def frames(self, reference_id: str, limit: int = 3000) -> list[dict]:
        info = self.get(reference_id)
        if not info:
            return []
        path = (self.root / reference_id / "pose.jsonl.gz").resolve()
        if not path.is_file() or not path.is_relative_to(self.root.resolve()):
            return []
        items: list[dict] = []
        with gzip.open(path, "rt", encoding="utf-8") as source:
            for line in source:
                if len(items) >= limit:
                    break
                items.append(json.loads(line))
        return items
