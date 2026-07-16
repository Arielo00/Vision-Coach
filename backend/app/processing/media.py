from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import av
import numpy as np
from av.error import FFmpegError


@dataclass(frozen=True, slots=True)
class MediaMetadata:
    duration_seconds: float
    fps: float
    width: int
    height: int
    codec: str
    frame_count: int


@dataclass(frozen=True, slots=True)
class VideoFrame:
    index: int
    timestamp_seconds: float
    rgb: np.ndarray


class InvalidVideoError(ValueError):
    pass


def _video_stream(container: av.container.InputContainer):
    if not container.streams.video:
        raise InvalidVideoError("El archivo no contiene una pista de video.")
    return container.streams.video[0]


def probe_video(path: Path) -> MediaMetadata:
    try:
        with av.open(str(path)) as container:
            stream = _video_stream(container)
            try:
                first_frame = next(container.decode(stream))
            except StopIteration as exc:
                raise InvalidVideoError("No fue posible decodificar ningún cuadro.") from exc

            fps = float(stream.average_rate) if stream.average_rate else 0.0
            if stream.duration is not None and stream.time_base is not None:
                duration = float(stream.duration * stream.time_base)
            elif container.duration is not None:
                duration = float(container.duration / av.time_base)
            else:
                duration = 0.0

            frame_count = int(stream.frames or 0)
            if frame_count <= 0 and duration > 0 and fps > 0:
                frame_count = max(1, round(duration * fps))

            width = int(stream.codec_context.width or first_frame.width)
            height = int(stream.codec_context.height or first_frame.height)
            codec = stream.codec_context.name or "desconocido"
            return MediaMetadata(
                duration_seconds=max(duration, 0.0),
                fps=max(fps, 0.0),
                width=width,
                height=height,
                codec=codec,
                frame_count=frame_count,
            )
    except InvalidVideoError:
        raise
    except (FFmpegError, OSError, ValueError) as exc:
        raise InvalidVideoError(f"Video inválido o codec no compatible: {exc}") from exc


def iter_video_frames(path: Path) -> Iterator[VideoFrame]:
    try:
        with av.open(str(path)) as container:
            stream = _video_stream(container)
            fallback_fps = float(stream.average_rate) if stream.average_rate else 30.0
            for index, frame in enumerate(container.decode(stream)):
                timestamp = float(frame.time) if frame.time is not None else index / fallback_fps
                yield VideoFrame(
                    index=index,
                    timestamp_seconds=timestamp,
                    rgb=frame.to_ndarray(format="rgb24"),
                )
    except InvalidVideoError:
        raise
    except (FFmpegError, OSError, ValueError) as exc:
        raise InvalidVideoError(f"Falló la decodificación del video: {exc}") from exc
