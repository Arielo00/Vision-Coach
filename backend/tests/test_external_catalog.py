from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.external_catalog import ExternalCatalogStore
from app.main import create_app


def external_record(tmp_path: Path) -> dict:
    return {
        "source": "hasaneyldrm/exercises-dataset",
        "source_exercise_id": "0662",
        "canonical_exercise_id": "push_up",
        "discipline": "calisthenics",
        "standard_variant": "calisthenics_general",
        "relationship": "exact",
        "review_status": "secondary_reviewed",
        "merge_into_standards": False,
        "name": "push-up",
        "equipment": "body weight",
        "instructions_es": "Mantén el cuerpo en línea recta.",
        "instruction_steps_es": ["Inicia en plancha alta."],
        "media_relative_path": "inputs/external_catalogs/exercises_dataset/media/0662.gif",
        "media_attribution": "© Gymvisual — https://gymvisual.com/",
        "media_license_status": "permission_pending",
        "source_url": "https://github.com/hasaneyldrm/exercises-dataset/blob/main/data/exercises.json",
    }


def settings_for(tmp_path: Path, licensed: bool = False) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        input_video_dir=tmp_path / "inputs" / "videos",
        input_pdf_dir=tmp_path / "inputs" / "pdfs",
        enable_worker=False,
        enable_pose=False,
        gymvisual_media_licensed=licensed,
        ollama_url="http://127.0.0.1:9",
    )


def test_secondary_store_rejects_automatic_standard_merge(tmp_path: Path) -> None:
    record = external_record(tmp_path)
    record["merge_into_standards"] = True
    with pytest.raises(ValueError, match="no pueden modificar estándares"):
        ExternalCatalogStore(tmp_path / "external.db").upsert([record])


def test_library_exposes_secondary_text_but_not_restricted_media_url(tmp_path: Path) -> None:
    settings = settings_for(tmp_path)
    media = tmp_path / "inputs" / "external_catalogs" / "exercises_dataset" / "media" / "0662.gif"
    media.parent.mkdir(parents=True)
    media.write_bytes(b"GIF89a")
    ExternalCatalogStore(settings.external_catalog_database_path).upsert([external_record(tmp_path)])

    with TestClient(create_app(settings)) as client:
        response = client.get("/api/library/exercises")
        media_response = client.get("/api/library/external-media/exercises-dataset/0662")

    assert response.status_code == 200
    push_up = next(item for item in response.json()["items"] if item["id"] == "push_up")
    source = push_up["secondary_sources"][0]
    assert source["instructions_es"] == "Mantén el cuerpo en línea recta."
    assert source["merge_into_standards"] is False
    assert source["media"]["staged_available"] is True
    assert source["media"]["display_enabled"] is False
    assert source["media"]["url"] is None
    assert media_response.status_code == 403


def test_library_serves_gif_only_when_license_switch_is_enabled(tmp_path: Path) -> None:
    settings = settings_for(tmp_path, licensed=True)
    media = tmp_path / "inputs" / "external_catalogs" / "exercises_dataset" / "media" / "0662.gif"
    media.parent.mkdir(parents=True)
    media.write_bytes(b"GIF89a")
    ExternalCatalogStore(settings.external_catalog_database_path).upsert([external_record(tmp_path)])

    with TestClient(create_app(settings)) as client:
        library = client.get("/api/library/exercises").json()
        response = client.get("/api/library/external-media/exercises-dataset/0662")

    push_up = next(item for item in library["items"] if item["id"] == "push_up")
    assert push_up["secondary_sources"][0]["media"]["url"].endswith("/0662")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/gif"


def test_curated_selection_only_targets_existing_exercises() -> None:
    selection_path = Path(__file__).parents[1] / "app" / "external_catalog" / "selections" / "exercises_dataset.json"
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    assert len(selection["records"]) == 18
    assert all(record["review_status"] in {"secondary_reviewed", "variant_candidate"} for record in selection["records"])
