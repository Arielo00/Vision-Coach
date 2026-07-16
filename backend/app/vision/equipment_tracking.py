from __future__ import annotations

from dataclasses import dataclass
from math import hypot

from app.vision.equipment_detector import EquipmentDetection


@dataclass(slots=True)
class _Track:
    track_id: str
    label: str
    center: tuple[float, float]
    missed: int = 0


class EquipmentTracker:
    """Asociación temporal 2D por clase y distancia normalizada."""

    def __init__(self, maximum_distance_normalized: float = 0.25, maximum_missed: int = 15) -> None:
        self.maximum_distance_normalized = maximum_distance_normalized
        self.maximum_missed = maximum_missed
        self._tracks: dict[str, _Track] = {}
        self._next_id = 1

    def update(self, detections: list[EquipmentDetection], frame_shape: tuple[int, int]) -> list[dict]:
        height, width = frame_shape
        diagonal = max(hypot(width, height), 1.0)
        unmatched = set(self._tracks)
        output: list[dict] = []
        for detection in sorted(detections, key=lambda item: item.confidence, reverse=True):
            x1, y1, x2, y2 = detection.xyxy
            center = ((x1 + x2) / 2, (y1 + y2) / 2)
            candidates = [
                track for track in self._tracks.values()
                if track.track_id in unmatched and track.label == detection.label
            ]
            nearest = min(candidates, key=lambda track: hypot(center[0] - track.center[0], center[1] - track.center[1]), default=None)
            distance = hypot(center[0] - nearest.center[0], center[1] - nearest.center[1]) / diagonal if nearest else None
            if nearest is None or distance is None or distance > self.maximum_distance_normalized:
                track_id = f"{detection.label}:{self._next_id}"
                self._next_id += 1
                nearest = _Track(track_id, detection.label, center)
                self._tracks[track_id] = nearest
            else:
                unmatched.discard(nearest.track_id)
                nearest.center = center
                nearest.missed = 0
            item = detection.to_dict()
            item.update(
                track_id=nearest.track_id,
                center=[round(center[0], 3), round(center[1], 3)],
                center_normalized=[round(center[0] / max(width, 1), 6), round(center[1] / max(height, 1), 6)],
            )
            output.append(item)

        for track_id in list(unmatched):
            track = self._tracks[track_id]
            track.missed += 1
            if track.missed > self.maximum_missed:
                del self._tracks[track_id]
        return output
