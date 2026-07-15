from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def build_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        data_dir=tmp_path / "data",
        input_video_dir=tmp_path / "inputs" / "videos",
        input_pdf_dir=tmp_path / "inputs" / "pdfs",
        max_upload_bytes=1024 * 1024,
        enable_worker=False,
        enable_pose=False,
        ollama_url="http://127.0.0.1:9",
    )
    return TestClient(create_app(settings))


def test_health(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "storage": "local",
        "scope": "video_only",
        "gpu_available": False,
    }


def test_exercise_catalog_has_all_categories(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/api/catalog/exercises")

    assert response.status_code == 200
    items = response.json()
    assert {item["category"] for item in items} == {"automatic", "crossfit", "calisthenics", "hyrox"}
    assert any(item["id"] == "sled_push" for item in items)
    assert any(item["id"] == "handstand_push_up" for item in items)
    assert all(item["maturity"] for item in items)
    assert all(item["preferred_views"] for item in items)
    by_id = {item["id"]: item for item in items}
    assert by_id["bar_muscle_up"]["categories"] == ["crossfit", "calisthenics"]
    assert by_id["ring_muscle_up"]["categories"] == ["crossfit", "calisthenics"]
    assert by_id["rowing"]["categories"] == ["crossfit", "hyrox"]


def test_catalog_coverage_exposes_limitations_without_claiming_false_support(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/api/catalog/coverage")

    assert response.status_code == 200
    exercises = response.json()["exercises"]
    assert exercises["air_squat"]["maturity"] == "active_needs_calibration"
    assert exercises["sled_push"]["maturity"] == "equipment_blocked"


def test_exercise_library_preserves_sources_rules_and_video_relationships(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/api/library/exercises")

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["exercises"] == 46
    assert "with_secondary_sources" in payload["summary"]
    items = {item["id"]: item for item in payload["items"]}
    assert "auto" not in items
    assert items["bar_muscle_up"]["categories"] == ["crossfit", "calisthenics"]
    assert any(source["pages"] == [237, 238, 239, 240, 241, 242, 243, 244] for source in items["kipping_pull_up"]["sources"])
    assert any(video["relationship"] == "advanced_variant" for video in items["kipping_pull_up"]["videos"])
    assert items["kipping_pull_up"]["benchmark"]["status"] == "needs_intentional_errors"
    assert "missing_push_away" in items["kipping_pull_up"]["benchmark"]["intentional_errors_pending"]


def test_library_video_endpoint_rejects_unknown_ids(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/api/library/videos/../../secreto")

    assert response.status_code == 404


def test_pipeline_status_exposes_real_gaps_from_architecture_diagram(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get("/api/pipeline/status")

    assert response.status_code == 200
    blocks = {item["id"]: item for item in response.json()["blocks"]}
    assert blocks["person_pose"]["status"] == "implemented"
    assert blocks["equipment_detection"]["status"] == "implemented_bootstrap_awaiting_custom"
    assert blocks["hard_examples"]["status"] == "implemented_local_capture"
    assert blocks["vector_store"]["status"] == "implemented_alternative"


def test_upload_creates_persistent_job(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.post(
            "/api/videos",
            files={"file": ("sentadilla.mp4", b"fake-video-content", "video/mp4")},
            data={"camera_view": "side", "requested_exercise": "back_squat"},
        )
        jobs_response = client.get("/api/jobs")
        changed_response = client.patch(
            f"/api/jobs/{response.json()['id']}/exercise",
            json={"exercise": "sled_push"},
        )

    assert response.status_code == 201
    job = response.json()
    assert job["status"] == "queued"
    assert job["camera_view"] == "side"
    assert jobs_response.json()[0]["id"] == job["id"]
    assert changed_response.status_code == 200
    assert changed_response.json()["requested_exercise"] == "sled_push"
    assert (tmp_path / "data" / "uploads" / job["id"] / "original.mp4").exists()


def test_rejects_unsupported_extension(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.post(
            "/api/videos",
            files={"file": ("clip.avi", b"fake", "video/x-msvideo")},
        )

    assert response.status_code == 415


def test_llm_catalog_shows_remote_gemma_as_unavailable_without_key(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    with build_client(tmp_path) as client:
        response = client.get("/api/llm/models")

    assert response.status_code == 200
    payload = response.json()
    gemma = next(item for item in payload["items"] if item["id"] == "google::gemma-4-26b-a4b-it")
    assert gemma["remote"] is True
    assert gemma["available"] is False
    assert "api_key" not in str(payload).lower()
