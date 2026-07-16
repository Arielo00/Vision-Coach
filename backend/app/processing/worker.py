from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import threading
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

from app.config import Settings
from app.processing.media import probe_video, iter_video_frames
from app.storage.database import Database, VideoJob
from app.vision.pose_estimator import RFDetrKeypointEstimator
from app.vision.tracking import PrimaryPersonTracker
from app.vision.equipment_detector import EquipmentDetector, build_equipment_detector, equipment_inference_applicable
from app.vision.equipment_tracking import EquipmentTracker


ALLOWED_VIDEO_SUFFIXES = {".mp4", ".mov"}
CONTENT_TYPES = {".mp4": "video/mp4", ".mov": "video/quicktime"}


class JobWorker:
    def __init__(self, settings: Settings, database: Database) -> None:
        self.settings = settings
        self.database = database
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._estimator: RFDetrKeypointEstimator | None = None
        self._equipment_detector: EquipmentDetector | None = None
        self._observed_sizes: dict[str, int] = {}

    def start(self) -> None:
        self.settings.input_video_dir.mkdir(parents=True, exist_ok=True)
        self.settings.input_pdf_dir.mkdir(parents=True, exist_ok=True)
        self.settings.artifact_dir.mkdir(parents=True, exist_ok=True)
        self._thread = threading.Thread(target=self._run, name="video-job-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=10)

    def _run(self) -> None:
        self._recover_interrupted_jobs()
        while not self._stop.is_set():
            self._ingest_inbox()
            job_id = self._next_job_id()
            if job_id is None:
                self._stop.wait(self.settings.worker_poll_seconds)
                continue
            self._process(job_id)

    def _recover_interrupted_jobs(self) -> None:
        with self.database.session_factory() as session:
            jobs = session.scalars(select(VideoJob).where(VideoJob.status == "processing"))
            for job in jobs:
                job.status = "queued"
                job.stage = "pending_media_probe"
                job.progress = 0
                job.error_message = None
            invalid_completed = session.scalars(
                select(VideoJob).where(
                    VideoJob.status == "completed",
                    VideoJob.max_people_detected > 0,
                    (VideoJob.mean_keypoint_confidence.is_(None))
                    | (VideoJob.mean_keypoint_confidence <= 0),
                )
            )
            for job in invalid_completed:
                job.status = "queued"
                job.stage = "reprocessing_invalid_pose"
                job.progress = 0
                job.processed_frames = 0
                job.max_people_detected = 0
                job.pose_frames_with_person = 0
                job.mean_keypoint_confidence = None
                job.pose_model = None
                job.pose_artifact = None
                job.error_message = None
            session.commit()

    def _ingest_inbox(self) -> None:
        for source in sorted(self.settings.input_video_dir.iterdir()):
            if not source.is_file() or source.suffix.lower() not in ALLOWED_VIDEO_SUFFIXES:
                continue
            source_key = str(source.resolve())
            size = source.stat().st_size
            if self._observed_sizes.get(source_key) != size:
                self._observed_sizes[source_key] = size
                continue

            with self.database.session_factory() as session:
                exists = session.scalar(
                    select(VideoJob.id).where(VideoJob.inbox_source == source_key).limit(1)
                )
                if exists is not None:
                    continue

                job_id = str(uuid4())
                job_dir = self.settings.upload_dir / job_id
                job_dir.mkdir(parents=True, exist_ok=False)
                destination = job_dir / f"original{source.suffix.lower()}"
                digest = hashlib.sha256()
                try:
                    with source.open("rb") as incoming, destination.open("wb") as output:
                        while chunk := incoming.read(1024 * 1024):
                            digest.update(chunk)
                            output.write(chunk)
                except Exception:
                    shutil.rmtree(job_dir, ignore_errors=True)
                    raise

                checksum = digest.hexdigest()
                (job_dir / "sha256.txt").write_text(checksum, encoding="utf-8")
                session.add(
                    VideoJob(
                        id=job_id,
                        original_filename=source.name,
                        stored_path=str(destination),
                        content_type=CONTENT_TYPES[source.suffix.lower()],
                        size_bytes=destination.stat().st_size,
                        camera_view="unspecified",
                        requested_exercise="auto",
                        status="queued",
                        stage="pending_media_probe",
                        progress=0,
                        sha256=checksum,
                        inbox_source=source_key,
                    )
                )
                session.commit()

    def _next_job_id(self) -> str | None:
        with self.database.session_factory() as session:
            return session.scalar(
                select(VideoJob.id)
                .where(VideoJob.status == "queued")
                .order_by(VideoJob.created_at.asc())
                .limit(1)
            )

    def _process(self, job_id: str) -> None:
        try:
            with self.database.session_factory() as session:
                job = session.get(VideoJob, job_id)
                if job is None:
                    return
                job.status = "processing"
                job.stage = "probing_media"
                job.progress = 1
                job.error_message = None
                session.commit()
                video_path = Path(job.stored_path)

                metadata = probe_video(video_path)
                job.duration_seconds = metadata.duration_seconds
                job.fps = metadata.fps
                job.width = metadata.width
                job.height = metadata.height
                job.codec = metadata.codec
                job.frame_count = metadata.frame_count
                job.stage = "metadata_complete"
                job.progress = 5
                session.commit()

                if not self.settings.enable_pose:
                    job.status = "completed"
                    job.progress = 100
                    session.commit()
                    return

                job.stage = "loading_pose_model"
                session.commit()
                if self._estimator is None:
                    self._estimator = RFDetrKeypointEstimator(
                        self.settings.pose_threshold,
                        self.settings.rfdetr_model_dir,
                    )
                equipment_active = self.settings.enable_equipment and equipment_inference_applicable(
                    job.requested_exercise,
                    self.settings.equipment_checkpoint,
                    self.settings.equipment_coco_bootstrap,
                )
                if (
                    equipment_active
                    and self._equipment_detector is None
                    and equipment_inference_applicable(job.requested_exercise, self.settings.equipment_checkpoint, self.settings.equipment_coco_bootstrap)
                ):
                    self._equipment_detector = build_equipment_detector(
                        self.settings.rfdetr_model_dir,
                        self.settings.equipment_threshold,
                        self.settings.equipment_checkpoint,
                        self.settings.equipment_coco_bootstrap,
                    )

                job.pose_model = self._estimator.model_name
                job.stage = "pose_inference"
                job.progress = 8
                session.commit()

                artifact_dir = self.settings.artifact_dir / job.id
                artifact_dir.mkdir(parents=True, exist_ok=True)
                artifact_path = artifact_dir / "pose.jsonl.gz"
                processed = 0
                max_people = 0
                frames_with_person = 0
                confidence_sum = 0.0
                confidence_count = 0
                estimated_total = max(metadata.frame_count, 1)
                tracker = PrimaryPersonTracker(self.settings.pose_threshold)
                equipment_tracker = EquipmentTracker()

                with gzip.open(artifact_path, "wt", encoding="utf-8") as output:
                    for frame in iter_video_frames(video_path):
                        people = tracker.order(self._estimator.predict(frame.rgb))
                        equipment = []
                        if equipment_active and self._equipment_detector is not None and frame.index % max(self.settings.equipment_frame_stride, 1) == 0:
                            raw_equipment = self._equipment_detector.predict(frame.rgb)
                            equipment = equipment_tracker.update(raw_equipment, (frame.rgb.shape[0], frame.rgb.shape[1]))
                        record = {
                            "frame_index": frame.index,
                            "timestamp_seconds": frame.timestamp_seconds,
                            "people": people,
                            "equipment": equipment,
                            "equipment_model": self._equipment_detector.model_name if equipment_active and self._equipment_detector is not None else None,
                            "equipment_capability": self._equipment_detector.capability if equipment_active and self._equipment_detector is not None else "not_applicable",
                        }
                        output.write(
                            json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
                            + "\n"
                        )
                        processed = frame.index + 1
                        max_people = max(max_people, len(people))
                        if people:
                            frames_with_person += 1
                        for person in people:
                            confidences = person.get("keypoint_confidence") or []
                            for confidence in confidences:
                                if confidence is not None:
                                    confidence_sum += float(confidence)
                                    confidence_count += 1
                        if processed % 10 == 0:
                            job.processed_frames = processed
                            job.max_people_detected = max_people
                            job.pose_frames_with_person = frames_with_person
                            job.mean_keypoint_confidence = (
                                confidence_sum / confidence_count if confidence_count else None
                            )
                            job.progress = min(97, 8 + round((processed / estimated_total) * 89))
                            session.commit()

                job.processed_frames = processed
                job.max_people_detected = max_people
                job.pose_frames_with_person = frames_with_person
                job.mean_keypoint_confidence = (
                    confidence_sum / confidence_count if confidence_count else None
                )
                if max_people > 0 and (not confidence_count or confidence_sum <= 0):
                    raise RuntimeError(
                        "RF-DETR detectó personas, pero no produjo confianza de keypoints utilizable."
                    )
                job.pose_artifact = str(artifact_path)
                job.status = "completed"
                job.stage = "pose_complete"
                job.progress = 100
                session.commit()
        except Exception as exc:
            with self.database.session_factory() as session:
                job = session.get(VideoJob, job_id)
                if job is not None:
                    job.status = "failed"
                    job.stage = "failed"
                    job.error_message = str(exc)[:1000]
                    session.commit()
