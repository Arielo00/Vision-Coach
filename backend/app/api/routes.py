from __future__ import annotations

import hashlib
import gzip
import json
import shutil
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.jobs import ExerciseOption, ExerciseSelectionRequest, HardExampleRequest, HealthResponse, VideoJobResponse
from app.domain.exercise_catalog import ALLOWED_EXERCISES, EXERCISE_CATALOG, EXERCISE_DISCIPLINES
from app.domain.exercise_library import build_exercise_library, external_media_path, library_video_path
from app.domain.pipeline_status import load_pipeline_status
from app.rules_engine import analyze_exercise
from app.rules_engine.coverage import exercise_coverage, load_catalog_coverage
from app.rag import KnowledgeStore
from app.rag.coaching import CoachingRequest, generate_coaching
from app.llm_provider import GoogleGenAIProvider, OllamaProvider
from app.reference import ReferenceLibrary
from app.progress import build_progress_payload, session_snapshot
from app.storage.database import Database, VideoJob
from app.vision.pose_estimator import gpu_available
from app.active_learning import save_hard_example


ALLOWED_EXTENSIONS = {".mp4", ".mov"}
ALLOWED_VIEWS = {"front", "side", "three_quarter", "unspecified"}
CHUNK_SIZE = 1024 * 1024

router = APIRouter(prefix="/api")

KNOWLEDGE_QUERIES = {
    "wall_ball_shot": "wall ball sentadilla extensión cadera rodillas",
    "hyrox_wall_balls": "wall ball sentadilla extensión cadera rodillas",
    "back_squat": "sentadilla profundidad caderas rodillas extensión completa",
    "front_squat": "sentadilla frontal profundidad torso erguido extensión completa",
    "air_squat": "sentadilla de aire profundidad rodillas columna neutral extensión",
    "overhead_squat": "sentadilla sobre la cabeza brazos extendidos profundidad estabilidad",
    "goblet_squat": "sentadilla carga frontal profundidad tronco rodillas extensión",
    "strict_pull_up": "dominada pull up brazos extendidos controlada cabeza encima barra",
    "kipping_pull_up": "kipping pull-up kip swing hombros empujarse de la barra sobreextensión balanceo correcciones",
    "parallel_dip": "fondos paralelas codos hombros profundidad control soporte",
    "l_sit": "L-sit piernas extendidas cadera noventa grados brazos soporte",
    "push_press": "push press dip vertical extensión cadera piernas brazos bloqueo overhead",
    "snatch": "IWF snatch barbell single movement full extent arms overhead feet same line incorrect movements press-out",
    "clean_and_jerk": "IWF clean and jerk barbell shoulders motionless knees extended arms legs fully extended feet same line",
    "split_jerk": "IWF jerk motionless knees extended split arms legs fully extended feet same line",
    "kettlebell_swing_russian": "kettlebell swing extensión cadera brazos",
    "kettlebell_swing_american": "kettlebell swing extensión cadera brazos",
}

KNOWLEDGE_MOVEMENTS = {
    "wall_ball_shot": {"squat_family", "air_squat"},
    "hyrox_wall_balls": {"squat_family", "air_squat"},
    "back_squat": {"squat_family", "air_squat"},
    "front_squat": {"front_squat", "squat_family"},
    "air_squat": {"air_squat", "squat_family"},
    "overhead_squat": {"overhead_squat", "squat_family"},
    "goblet_squat": {"squat_family", "air_squat"},
    "push_press": {"push_press", "press_family"},
    "strict_pull_up": {"pull_up"},
    "kipping_pull_up": {"pull_up"},
    "snatch": {"snatch", "olympic_lifts"},
    "clean_and_jerk": {"clean_and_jerk", "olympic_lifts"},
    "split_jerk": {"clean_and_jerk", "olympic_lifts"},
}


def knowledge_store(settings, *, require_vector: bool = False) -> KnowledgeStore:
    """Gemini es primario; BGE local mantiene continuidad sin cambiar el corpus."""
    return KnowledgeStore(
        settings.knowledge_dir,
        settings.ollama_url,
        settings.google_api_key,
        vector_root=settings.knowledge_index_dir,
        fallback_vector_root=settings.fallback_knowledge_index_dir,
        require_vector=require_vector,
    )


def ollama_model_kind(item: dict) -> str:
    name = (item.get("name") or item.get("model") or "").lower()
    family = str(item.get("details", {}).get("family", "")).lower()
    return "embedding" if "embed" in name or name.startswith("bge-") or "bert" in family else "chat"


def get_database(request: Request) -> Database:
    return request.app.state.database


def get_db_session(database: Annotated[Database, Depends(get_database)]):
    yield from database.session()


DbSession = Annotated[Session, Depends(get_db_session)]


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    return HealthResponse(
        status="ok",
        storage="local",
        scope="video_only",
        gpu_available=gpu_available() if request.app.state.settings.enable_pose else False,
    )


@router.get("/catalog/exercises", response_model=list[ExerciseOption])
def exercises() -> list[ExerciseOption]:
    return [
        ExerciseOption(
            id=item[0], label=item[1], category=item[2],
            categories=list(EXERCISE_DISCIPLINES[item[0]]),
            **exercise_coverage(item[0]),
        )
        for item in EXERCISE_CATALOG
    ]


@router.get("/catalog/coverage")
def catalog_coverage() -> dict:
    return load_catalog_coverage()


@router.get("/library/exercises")
def exercise_library(request: Request) -> dict:
    settings = request.app.state.settings
    project_root = settings.input_video_dir.parent.parent.resolve()
    return build_exercise_library(
        project_root,
        external_database_path=settings.external_catalog_database_path,
        allow_restricted_media=settings.gymvisual_media_licensed,
    )


@router.get("/library/videos/{video_id}", response_class=FileResponse)
def exercise_library_video(video_id: str, request: Request) -> FileResponse:
    project_root = request.app.state.settings.input_video_dir.parent.parent.resolve()
    path = library_video_path(project_root, video_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Video de referencia no disponible")
    media_type = "video/quicktime" if path.suffix.lower() == ".mov" else "video/mp4"
    return FileResponse(path, media_type=media_type)


@router.get("/library/external-media/exercises-dataset/{source_exercise_id}", response_class=FileResponse)
def exercise_library_external_media(source_exercise_id: str, request: Request) -> FileResponse:
    settings = request.app.state.settings
    if not settings.gymvisual_media_licensed:
        raise HTTPException(
            status_code=403,
            detail="Visualización bloqueada hasta confirmar una licencia de Gymvisual.",
        )
    project_root = settings.input_video_dir.parent.parent.resolve()
    path = external_media_path(project_root, settings.external_catalog_database_path, source_exercise_id)
    if path is None:
        raise HTTPException(status_code=404, detail="GIF externo no disponible")
    return FileResponse(path, media_type="image/gif")


@router.get("/pipeline/status")
def pipeline_status() -> dict:
    return load_pipeline_status()


@router.get("/jobs", response_model=list[VideoJobResponse])
def list_jobs(db: DbSession) -> list[VideoJob]:
    statement = select(VideoJob).order_by(VideoJob.created_at.desc()).limit(50)
    return list(db.scalars(statement))


@router.get("/jobs/{job_id}", response_model=VideoJobResponse)
def get_job(job_id: str, db: DbSession) -> VideoJob:
    job = db.get(VideoJob, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trabajo no encontrado")
    return job


@router.post("/jobs/{job_id}/reanalyze", response_model=VideoJobResponse)
def reanalyze_job(job_id: str, db: DbSession) -> VideoJob:
    job = get_job(job_id, db)
    if job.status == "processing":
        raise HTTPException(status_code=409, detail="El trabajo ya se está procesando")
    job.status = "queued"
    job.stage = "pending_media_probe"
    job.progress = 0
    job.error_message = None
    job.processed_frames = 0
    job.max_people_detected = 0
    job.pose_frames_with_person = 0
    job.mean_keypoint_confidence = None
    job.pose_model = None
    job.pose_artifact = None
    db.commit()
    return job


@router.patch("/jobs/{job_id}/exercise", response_model=VideoJobResponse)
def change_job_exercise(job_id: str, selection: ExerciseSelectionRequest, db: DbSession) -> VideoJob:
    job = get_job(job_id, db)
    if selection.exercise not in ALLOWED_EXERCISES:
        raise HTTPException(status_code=422, detail="El ejercicio solicitado no es válido")
    job.requested_exercise = selection.exercise
    db.commit()
    return job


@router.get("/jobs/{job_id}/video", response_class=FileResponse)
def get_job_video(job_id: str, request: Request, db: DbSession) -> FileResponse:
    job = get_job(job_id, db)
    path = Path(job.stored_path).resolve()
    data_dir = request.app.state.settings.data_dir.resolve()
    if not path.is_file() or not path.is_relative_to(data_dir):
        raise HTTPException(status_code=404, detail="Video no disponible")
    return FileResponse(path, media_type=job.content_type, filename=job.original_filename)


@router.get("/jobs/{job_id}/pose/frames")
def get_pose_frames(
    job_id: str,
    request: Request,
    db: DbSession,
    offset: int = 0,
    limit: int = 600,
) -> dict:
    job = get_job(job_id, db)
    if not job.pose_artifact:
        raise HTTPException(status_code=404, detail="La pose todavía no está disponible")
    path = Path(job.pose_artifact).resolve()
    artifact_dir = request.app.state.settings.artifact_dir.resolve()
    if not path.is_file() or not path.is_relative_to(artifact_dir):
        raise HTTPException(status_code=404, detail="Artefacto de pose no disponible")
    safe_offset = max(offset, 0)
    safe_limit = min(max(limit, 1), 3000)
    items: list[dict] = []
    with gzip.open(path, "rt", encoding="utf-8") as source:
        for index, line in enumerate(source):
            if index < safe_offset:
                continue
            if len(items) >= safe_limit:
                break
            items.append(json.loads(line))
    return {"offset": safe_offset, "limit": safe_limit, "items": items}


@router.get("/jobs/{job_id}/biomechanics")
def get_biomechanics(job_id: str, request: Request, db: DbSession) -> dict:
    job = get_job(job_id, db)
    result = _analyze_job_pose(job, request.app.state.settings)
    query = KNOWLEDGE_QUERIES.get(result.get("exercise", ""))
    detected_issues = [
        issue
        for repetition in result.get("repetitions", [])
        for issue in repetition.get("errors", [])
    ]
    if query and detected_issues:
        issue_terms = " ".join(
            f"{issue['type']} {issue['description']} corrección {issue['correction']}"
            for issue in detected_issues[:6]
        )
        query = f"{query} {issue_terms}"
    result["knowledge_context"] = (
        knowledge_store(request.app.state.settings).search(
            query,
            limit=4,
            preferred_roles={"coach_guide", "movement_execution_and_coaching", "movement_execution"},
            preferred_movements=KNOWLEDGE_MOVEMENTS.get(result.get("exercise", "")),
        )
        if query
        else []
    )
    context = result["knowledge_context"]
    first = context[0] if context else {}
    mode = first.get("retrieval_mode", "not_applicable" if not query else "unavailable")
    fallback = bool(first.get("retrieval_fallback")) or mode == "lexical"
    result["knowledge_status"] = {
        "available": bool(context),
        "retrieval_mode": mode,
        "embedding_provider": first.get("embedding_provider"),
        "embedding_model": first.get("embedding_model"),
        "fallback": fallback,
        "message": (
            "Gemini no estuvo disponible; se recuperó el contexto con el índice BGE local."
            if first.get("retrieval_fallback")
            else "Los índices vectoriales no estuvieron disponibles; se usó recuperación léxica local."
            if mode == "lexical"
            else None
        ),
    }
    return result


@router.post("/jobs/{job_id}/feedback", status_code=status.HTTP_201_CREATED)
def create_hard_example(job_id: str, payload: HardExampleRequest, request: Request, db: DbSession) -> dict:
    job = get_job(job_id, db)
    diagnostics = _analyze_job_pose(job, request.app.state.settings)
    try:
        return save_hard_example(request.app.state.settings.hard_example_dir, job, payload, diagnostics)
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _analyze_job_pose(job: VideoJob, settings) -> dict:
    if job.status != "completed" or not job.pose_artifact:
        raise HTTPException(status_code=409, detail="El análisis de pose todavía no está completo")
    path = Path(job.pose_artifact).resolve()
    artifact_dir = settings.artifact_dir.resolve()
    if not path.is_file() or not path.is_relative_to(artifact_dir):
        raise HTTPException(status_code=404, detail="Artefacto de pose no disponible")
    frames: list[dict] = []
    with gzip.open(path, "rt", encoding="utf-8") as source:
        frames.extend(json.loads(line) for line in source)
    return analyze_exercise(frames, job.camera_view, job.requested_exercise)


@router.get("/progress")
def get_progress(request: Request, db: DbSession, exercise: str | None = None, limit: int = 100) -> dict:
    safe_limit = min(max(limit, 1), 500)
    jobs = list(db.scalars(
        select(VideoJob)
        .where(VideoJob.status == "completed", VideoJob.pose_artifact.is_not(None))
        .order_by(VideoJob.created_at.asc())
        .limit(safe_limit)
    ))
    cache: dict = request.app.state.progress_cache
    snapshots: list[dict] = []
    for job in jobs:
        cache_key = f"{job.id}:{job.requested_exercise}:{job.updated_at.isoformat()}"
        snapshot = cache.get(cache_key)
        if snapshot is None:
            try:
                snapshot = session_snapshot(job, _analyze_job_pose(job, request.app.state.settings))
            except (HTTPException, OSError, json.JSONDecodeError):
                continue
            cache[cache_key] = snapshot
        snapshots.append(snapshot)
    return build_progress_payload(snapshots, exercise)


@router.get("/knowledge/sources")
def get_knowledge_sources(request: Request) -> dict:
    sources = KnowledgeStore(request.app.state.settings.knowledge_dir).sources()
    return {"items": sources, "total": len(sources)}


@router.get("/knowledge/search")
def search_knowledge(request: Request, q: str, limit: int = 4) -> dict:
    settings = request.app.state.settings
    items = knowledge_store(settings).search(q, limit=limit)
    return {"query": q, "items": items, "total": len(items)}


@router.get("/knowledge/index")
def get_knowledge_index(request: Request) -> dict:
    settings = request.app.state.settings
    store = knowledge_store(settings)
    metadata = store.vector_index.metadata()
    fallback = store.fallback_vector_index.metadata() if store.fallback_vector_index else {}
    return {
        "available": bool(metadata),
        "default": True,
        **metadata,
        "fallback": {"available": bool(fallback), **fallback},
    }


@router.get("/llm/models")
def get_llm_models(request: Request) -> dict:
    settings = request.app.state.settings
    items: list[dict] = []
    messages: list[str] = []
    ollama = OllamaProvider(settings.ollama_url)
    try:
        models = ollama.list_models()
        chat_names = [item.get("name") or item.get("model") for item in models if ollama_model_kind(item) == "chat"]
        items.extend({
            "id": f"ollama::{item.get('name') or item.get('model')}",
            "name": item.get("name") or item.get("model"),
            "provider": "ollama",
            "kind": ollama_model_kind(item),
            "remote": False,
            "available": True,
            "details": item.get("details", {}),
        } for item in models)
    except RuntimeError as exc:
        chat_names = []
        messages.append(str(exc))

    google = GoogleGenAIProvider(settings.google_api_key)
    items.extend({
        "id": f"google::{item['name']}",
        "name": item["name"],
        "provider": "google",
        "kind": "chat",
        "remote": True,
        "available": bool(settings.google_api_key),
        "details": {},
    } for item in google.list_models())
    preferred = settings.ollama_chat_model if settings.ollama_chat_model in chat_names else (chat_names[0] if chat_names else None)
    default_model = f"ollama::{preferred}" if preferred else (
        f"google::{settings.google_gemma_model}" if settings.google_api_key else f"ollama::{settings.ollama_chat_model}"
    )
    return {
        "available": any(item["kind"] == "chat" and item["available"] for item in items),
        "provider": "multiple",
        "default_model": default_model,
        "items": items,
        "google_configured": bool(settings.google_api_key),
        "message": " · ".join(messages) or None,
    }


@router.post("/jobs/{job_id}/coaching")
def get_coaching(job_id: str, payload: CoachingRequest, request: Request, db: DbSession) -> dict:
    diagnostics = get_biomechanics(job_id, request, db)
    settings = request.app.state.settings
    model_spec = payload.model
    if not model_spec:
        try:
            provider_models = OllamaProvider(settings.ollama_url).list_models()
            chat_names = [item.get("name") or item.get("model") for item in provider_models if ollama_model_kind(item) == "chat"]
            model = settings.ollama_chat_model if settings.ollama_chat_model in chat_names else (chat_names[0] if chat_names else settings.ollama_chat_model)
            model_spec = f"ollama::{model}"
        except RuntimeError:
            model_spec = f"ollama::{settings.ollama_chat_model}"
    provider_name, model = model_spec.split("::", 1) if "::" in model_spec else ("ollama", model_spec)
    if provider_name == "google":
        if not payload.allow_remote:
            raise HTTPException(status_code=422, detail="Debes confirmar el envío del diagnóstico textual al proveedor remoto")
        if not settings.google_api_key:
            raise HTTPException(status_code=409, detail="Google GenAI no está configurado en este equipo")
        provider = GoogleGenAIProvider(settings.google_api_key)
    elif provider_name == "ollama":
        provider = OllamaProvider(settings.ollama_url)
    else:
        raise HTTPException(status_code=422, detail="Proveedor LLM no válido")
    context = diagnostics.get("knowledge_context", [])
    return generate_coaching(diagnostics, context, provider, model)


@router.get("/references")
def list_references(request: Request, exercise: str | None = None) -> dict:
    items = ReferenceLibrary(request.app.state.settings.calibration_dir).list(exercise)
    return {"items": items, "total": len(items)}


@router.get("/references/{reference_id}/frames")
def get_reference_frames(reference_id: str, request: Request, limit: int = 3000) -> dict:
    library = ReferenceLibrary(request.app.state.settings.calibration_dir)
    info = library.get(reference_id)
    if not info:
        raise HTTPException(status_code=404, detail="Referencia no encontrada")
    return {"reference": info, "items": library.frames(reference_id, min(max(limit, 1), 3000))}


@router.post("/videos", response_model=VideoJobResponse, status_code=status.HTTP_201_CREATED)
async def upload_video(
    request: Request,
    db: DbSession,
    file: Annotated[UploadFile, File(...)],
    camera_view: Annotated[str, Form()] = "unspecified",
    requested_exercise: Annotated[str, Form()] = "auto",
) -> VideoJob:
    settings = request.app.state.settings
    original_filename = Path(file.filename or "video").name
    extension = Path(original_filename).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Solo se aceptan archivos MP4 o MOV.")
    if camera_view not in ALLOWED_VIEWS:
        raise HTTPException(status_code=422, detail="La vista de cámara no es válida.")
    if requested_exercise not in ALLOWED_EXERCISES:
        raise HTTPException(status_code=422, detail="El ejercicio solicitado no es válido.")

    job_id = str(uuid4())
    job_dir = settings.upload_dir / job_id
    destination = job_dir / f"original{extension}"
    job_dir.mkdir(parents=True, exist_ok=False)
    size_bytes = 0
    digest = hashlib.sha256()

    try:
        with destination.open("wb") as output:
            while chunk := await file.read(CHUNK_SIZE):
                size_bytes += len(chunk)
                if size_bytes > settings.max_upload_bytes:
                    raise HTTPException(status_code=413, detail="El video supera el límite de 2 GB.")
                digest.update(chunk)
                output.write(chunk)
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise
    finally:
        await file.close()

    if size_bytes == 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=422, detail="El archivo está vacío.")

    job = VideoJob(
        id=job_id,
        original_filename=original_filename,
        stored_path=str(destination),
        content_type=file.content_type,
        size_bytes=size_bytes,
        camera_view=camera_view,
        requested_exercise=requested_exercise,
        status="queued",
        stage="pending_media_probe",
        progress=0,
        sha256=digest.hexdigest(),
    )
    db.add(job)
    db.commit()
    (job_dir / "sha256.txt").write_text(digest.hexdigest(), encoding="utf-8")
    return job
