from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import DEFAULT_SETTINGS, Settings
from app.processing.worker import JobWorker
from app.storage.database import Database


def create_app(settings: Settings | None = None) -> FastAPI:
    active_settings = settings or DEFAULT_SETTINGS
    database = Database(active_settings)
    worker = JobWorker(active_settings, database)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        active_settings.upload_dir.mkdir(parents=True, exist_ok=True)
        active_settings.input_video_dir.mkdir(parents=True, exist_ok=True)
        active_settings.input_pdf_dir.mkdir(parents=True, exist_ok=True)
        active_settings.hard_example_dir.mkdir(parents=True, exist_ok=True)
        database.initialize()
        if active_settings.enable_worker:
            worker.start()
        try:
            yield
        finally:
            if active_settings.enable_worker:
                worker.stop()

    application = FastAPI(
        title="Biomech Coach API",
        version="0.1.0",
        description="API local para trabajos de análisis biomecánico de video.",
        lifespan=lifespan,
    )
    application.state.settings = active_settings
    application.state.database = database
    application.state.worker = worker
    application.state.progress_cache = {}
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(active_settings.frontend_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["*"],
    )
    application.include_router(router)
    return application


app = create_app()
