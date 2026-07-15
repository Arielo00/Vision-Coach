import gzip
import json
from types import SimpleNamespace

import cv2
import numpy as np

from app.active_learning import save_hard_example


def test_hard_example_persists_frame_prediction_and_human_correction(tmp_path) -> None:
    video_path = tmp_path / "video.mp4"
    writer = cv2.VideoWriter(str(video_path), cv2.VideoWriter_fourcc(*"mp4v"), 10.0, (64, 48))
    for value in range(5):
        writer.write(np.full((48, 64, 3), value * 30, dtype=np.uint8))
    writer.release()
    pose_path = tmp_path / "pose.jsonl.gz"
    pose_frame = {
        "frame_index": 2,
        "timestamp_seconds": 0.2,
        "people": [{"keypoint_confidence": [0.8] * 17, "xy": [[1, 1]] * 17}],
    }
    with gzip.open(pose_path, "wt", encoding="utf-8") as output:
        output.write(json.dumps(pose_frame) + "\n")
    job = SimpleNamespace(
        id="job-1", pose_artifact=str(pose_path), stored_path=str(video_path), sha256="abc",
        original_filename="video.mp4", requested_exercise="air_squat", camera_view="side",
        pose_model="test-pose",
    )
    payload = SimpleNamespace(frame_index=2, repetition_number=1, correction_type="keypoints", note=None)
    diagnostics = {"exercise": "air_squat", "repetitions": [{"number": 1, "correct": True}]}

    result = save_hard_example(tmp_path / "hard", job, payload, diagnostics)
    metadata = json.loads((tmp_path / "hard" / result["id"] / "metadata.json").read_text(encoding="utf-8"))

    assert (tmp_path / "hard" / result["id"] / "frame.jpg").is_file()
    assert metadata["pose_prediction"]["frame_index"] == 2
    assert metadata["correction_type"] == "keypoints"
    assert metadata["original_confidence"] == 0.8
    assert metadata["export_status"] == "local_review_pending"
