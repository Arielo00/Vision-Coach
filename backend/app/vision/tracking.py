from __future__ import annotations

import math
from statistics import median


TORSO_KEYPOINTS = (5, 6, 11, 12)


def _center_and_scale(person: dict, minimum_confidence: float) -> tuple[tuple[float, float], float] | None:
    xy = person.get("xy") or []
    confidence = person.get("keypoint_confidence") or []
    points = [
        xy[index]
        for index in TORSO_KEYPOINTS
        if index < len(xy)
        and index < len(confidence)
        and confidence[index] is not None
        and float(confidence[index]) >= minimum_confidence
        and xy[index][0] is not None
        and xy[index][1] is not None
    ]
    if len(points) < 2:
        return None
    center = (median(float(point[0]) for point in points), median(float(point[1]) for point in points))
    distances = [math.hypot(float(point[0]) - center[0], float(point[1]) - center[1]) for point in points]
    return center, max(median(distances) * 2.0, 1.0)


class PrimaryPersonTracker:
    """Mantiene al atleta principal como people[0] sin inventar identidades globales."""

    def __init__(self, minimum_confidence: float = 0.35, reset_after_missing: int = 15) -> None:
        self.minimum_confidence = minimum_confidence
        self.reset_after_missing = reset_after_missing
        self._center: tuple[float, float] | None = None
        self._scale = 1.0
        self._missing = 0

    def order(self, people: list[dict]) -> list[dict]:
        if not people:
            self._missing += 1
            if self._missing >= self.reset_after_missing:
                self._center = None
            return []

        candidates = [(index, _center_and_scale(person, self.minimum_confidence)) for index, person in enumerate(people)]
        usable = [(index, geometry) for index, geometry in candidates if geometry is not None]
        if not usable:
            return people

        if self._center is None:
            primary_index, geometry = max(
                usable,
                key=lambda item: float(people[item[0]].get("detection_confidence") or 0.0),
            )
        else:
            primary_index, geometry = min(
                usable,
                key=lambda item: math.hypot(
                    item[1][0][0] - self._center[0],
                    item[1][0][1] - self._center[1],
                ) / max(self._scale, item[1][1], 1.0),
            )

        self._center, self._scale = geometry
        self._missing = 0
        primary = dict(people[primary_index])
        primary["track_role"] = "primary"
        return [primary, *(person for index, person in enumerate(people) if index != primary_index)]
