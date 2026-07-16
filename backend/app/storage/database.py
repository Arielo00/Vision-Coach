from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, String, create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import Settings


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class VideoJob(Base):
    __tablename__ = "video_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(1024))
    content_type: Mapped[str | None] = mapped_column(String(127), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    camera_view: Mapped[str] = mapped_column(String(32))
    requested_exercise: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="queued")
    stage: Mapped[str] = mapped_column(String(64), default="pending_media_probe")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    inbox_source: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    codec: Mapped[str | None] = mapped_column(String(64), nullable=True)
    frame_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processed_frames: Mapped[int] = mapped_column(Integer, default=0)
    max_people_detected: Mapped[int] = mapped_column(Integer, default=0)
    pose_frames_with_person: Mapped[int] = mapped_column(Integer, default=0)
    mean_keypoint_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    pose_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    pose_artifact: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class Database:
    def __init__(self, settings: Settings) -> None:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            settings.database_url,
            connect_args={"check_same_thread": False},
        )
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
        )

    def initialize(self) -> None:
        Base.metadata.create_all(self.engine)
        self._add_missing_columns()

    def _add_missing_columns(self) -> None:
        existing = {column["name"] for column in inspect(self.engine).get_columns("video_jobs")}
        migrations = {
            "sha256": "VARCHAR(64)",
            "inbox_source": "VARCHAR(1024)",
            "duration_seconds": "FLOAT",
            "fps": "FLOAT",
            "width": "INTEGER",
            "height": "INTEGER",
            "codec": "VARCHAR(64)",
            "frame_count": "INTEGER",
            "processed_frames": "INTEGER NOT NULL DEFAULT 0",
            "max_people_detected": "INTEGER NOT NULL DEFAULT 0",
            "pose_frames_with_person": "INTEGER NOT NULL DEFAULT 0",
            "mean_keypoint_confidence": "FLOAT",
            "pose_model": "VARCHAR(128)",
            "pose_artifact": "VARCHAR(1024)",
        }
        with self.engine.begin() as connection:
            for name, column_type in migrations.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE video_jobs ADD COLUMN {name} {column_type}"))

    def session(self) -> Generator[Session, None, None]:
        with self.session_factory() as db_session:
            yield db_session
