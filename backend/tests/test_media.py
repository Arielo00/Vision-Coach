from pathlib import Path

import av
import numpy as np

from app.processing.media import iter_video_frames, probe_video


def create_video(path: Path, frame_count: int = 12, fps: int = 6) -> None:
    with av.open(str(path), mode="w") as container:
        stream = container.add_stream("mpeg4", rate=fps)
        stream.width = 96
        stream.height = 64
        stream.pix_fmt = "yuv420p"
        for index in range(frame_count):
            image = np.zeros((64, 96, 3), dtype=np.uint8)
            image[:, :, 1] = index * 10
            frame = av.VideoFrame.from_ndarray(image, format="rgb24")
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def test_probe_and_decode_video(tmp_path: Path) -> None:
    path = tmp_path / "sample.mp4"
    create_video(path)

    metadata = probe_video(path)
    frames = list(iter_video_frames(path))

    assert metadata.width == 96
    assert metadata.height == 64
    assert metadata.fps == 6
    assert metadata.codec == "mpeg4"
    assert len(frames) == 12
    assert frames[0].rgb.shape == (64, 96, 3)

