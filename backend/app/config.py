from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path = PROJECT_ROOT / "data"
    input_video_dir: Path = PROJECT_ROOT / "inputs" / "videos"
    input_pdf_dir: Path = PROJECT_ROOT / "inputs" / "pdfs"
    max_upload_bytes: int = 2 * 1024 * 1024 * 1024
    enable_worker: bool = True
    enable_pose: bool = True
    pose_threshold: float = 0.35
    enable_equipment: bool = True
    equipment_threshold: float = 0.30
    equipment_frame_stride: int = 2
    equipment_coco_bootstrap: bool = True
    worker_poll_seconds: float = 2.0
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_chat_model: str = "qwen3:4b"
    ollama_embedding_model: str = "embeddinggemma"
    google_gemma_model: str = "gemma-4-26b-a4b-it"
    google_embedding_model: str = "gemini-embedding-2"
    google_embedding_dimensions: int = 768
    gymvisual_media_licensed: bool = field(default_factory=lambda: os.getenv(
        "GYMVISUAL_MEDIA_LICENSED", ""
    ).strip().lower() in {"1", "true", "yes", "si", "sí"})
    frontend_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def database_path(self) -> Path:
        return self.data_dir / "biomech.db"

    @property
    def external_catalog_database_path(self) -> Path:
        return self.data_dir / "external_catalog.db"

    @property
    def artifact_dir(self) -> Path:
        return self.data_dir / "artifacts"

    @property
    def rfdetr_model_dir(self) -> Path:
        return PROJECT_ROOT / "model_registry" / "rfdetr"

    @property
    def equipment_checkpoint(self) -> Path:
        return self.rfdetr_model_dir / "equipment" / "checkpoint_best_total.pth"

    @property
    def knowledge_dir(self) -> Path:
        return self.data_dir / "knowledge"

    @property
    def knowledge_index_dir(self) -> Path:
        """Índice semántico activo; el corpus y sus fuentes permanecen en knowledge_dir."""
        return (
            self.knowledge_dir
            / "indexes"
            / f"google-{self.google_embedding_model}-{self.google_embedding_dimensions}"
        )

    @property
    def fallback_knowledge_index_dir(self) -> Path:
        """Índice BGE local conservado para continuidad cuando Gemini no responda."""
        return self.knowledge_dir

    @property
    def calibration_dir(self) -> Path:
        return self.data_dir / "calibration"

    @property
    def hard_example_dir(self) -> Path:
        return self.data_dir / "hard_examples"

    @property
    def google_api_key(self) -> str | None:
        return os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.database_path.as_posix()}"


DEFAULT_SETTINGS = Settings()
