from __future__ import annotations

from collections import defaultdict
from math import hypot, sqrt


def trajectory_summary(frames: list[dict], labels: set[str], minimum_confidence: float = 0.30) -> dict | None:
    tracks: dict[str, list[dict]] = defaultdict(list)
    for frame in frames:
        for detection in frame.get("equipment", []):
            if detection.get("label") not in labels or float(detection.get("confidence", 0)) < minimum_confidence:
                continue
            center = detection.get("center_normalized")
            if not center or len(center) != 2:
                continue
            tracks[detection.get("track_id", detection["label"])].append({
                "frame_index": frame["frame_index"],
                "timestamp_seconds": frame["timestamp_seconds"],
                "x": float(center[0]),
                "y": float(center[1]),
                "confidence": float(detection["confidence"]),
                "label": detection["label"],
            })
    if not tracks:
        return None
    segments = []
    for track_id, points in tracks.items():
        points.sort(key=lambda item: item["frame_index"])
        path_length = sum(hypot(right["x"] - left["x"], right["y"] - left["y"]) for left, right in zip(points, points[1:]))
        peak = min(points, key=lambda item: item["y"])
        segments.append({
            "track_id": track_id,
            "label": points[0]["label"],
            "observations": len(points),
            "mean_confidence": round(sum(item["confidence"] for item in points) / len(points), 3),
            "path_length_frame_diagonal": round(path_length, 4),
            "vertical_range_frame_fraction": round(max(item["y"] for item in points) - min(item["y"] for item in points), 4),
            "peak_frame": peak["frame_index"],
            "points": points,
        })
    segments.sort(key=lambda item: item["observations"], reverse=True)
    primary = dict(segments[0])
    primary["observations_total"] = sum(item["observations"] for item in segments)
    primary["segments"] = [{key: value for key, value in item.items() if key != "points"} for item in segments]
    return primary


def contact_events(
    frames: list[dict],
    object_labels: set[str],
    target_labels: set[str],
    minimum_confidence: float = 0.30,
    expansion_ratio: float = 0.12,
) -> list[dict]:
    candidates = []
    for frame in frames:
        objects = [item for item in frame.get("equipment", []) if item.get("label") in object_labels and float(item.get("confidence", 0)) >= minimum_confidence]
        targets = [item for item in frame.get("equipment", []) if item.get("label") in target_labels and float(item.get("confidence", 0)) >= minimum_confidence]
        for obj in objects:
            center = obj.get("center")
            if not center:
                continue
            for target in targets:
                x1, y1, x2, y2 = [float(value) for value in target["xyxy"]]
                margin = hypot(x2 - x1, y2 - y1) * expansion_ratio
                dx = max(x1 - center[0], 0, center[0] - x2)
                dy = max(y1 - center[1], 0, center[1] - y2)
                distance = hypot(dx, dy)
                if distance <= margin:
                    candidates.append({
                        "frame_index": frame["frame_index"],
                        "timestamp_seconds": frame["timestamp_seconds"],
                        "object_track_id": obj.get("track_id"),
                        "target_track_id": target.get("track_id"),
                        "confidence": round(sqrt(float(obj["confidence"]) * float(target["confidence"])), 3),
                        "kind": "two_dimensional_contact_candidate",
                    })
    events = []
    for item in candidates:
        if events and item["frame_index"] <= events[-1]["end_frame"] + 2:
            events[-1]["end_frame"] = item["frame_index"]
            if item["confidence"] > events[-1]["confidence"]:
                events[-1].update(confidence=item["confidence"], peak_frame=item["frame_index"])
        else:
            events.append(item | {"start_frame": item["frame_index"], "end_frame": item["frame_index"], "peak_frame": item["frame_index"]})
    return events
