import gzip
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import numpy as np

from app.rag.coaching import generate_coaching
from app.rag.embeddings import EmbeddingQuotaError, HashEmbeddingProvider
from app.rag.embeddings import GeminiEmbeddingProvider
from app.rag.vector_index import LocalVectorIndex
from app.rag.knowledge import KnowledgeStore
from app.reference import ReferenceLibrary
from app.llm_provider import GoogleGenAIProvider
from app.progress import build_progress_payload, session_snapshot


def test_vector_index_returns_semantic_candidates(tmp_path) -> None:
    records = [
        {"id": "pullup", "text": "dominada controlada con brazos extendidos"},
        {"id": "squat", "text": "sentadilla con cadera debajo de las rodillas"},
    ]
    index = LocalVectorIndex(tmp_path)
    metadata = index.build(records, HashEmbeddingProvider())

    results = index.search("dominada brazos")

    assert metadata["count"] == 2
    assert metadata["dimensions"] == 384
    assert results[0][0] == "pullup"


class CountingHashProvider(HashEmbeddingProvider):
    def __init__(self) -> None:
        super().__init__()
        self.query_calls = 0

    def embed_query(self, text: str) -> np.ndarray:
        self.query_calls += 1
        return super().embed_query(text)


def test_vector_index_caches_query_vectors_without_storing_query_text(tmp_path) -> None:
    index = LocalVectorIndex(tmp_path)
    index.build([{"id": "pullup", "text": "dominada controlada"}], HashEmbeddingProvider())
    provider = CountingHashProvider()
    index._provider = lambda _metadata: provider

    index.search("dominada controlada")
    index.search("dominada controlada")

    assert provider.query_calls == 1
    cache_files = list((tmp_path / "query_cache").glob("*.npy"))
    assert len(cache_files) == 1
    assert "dominada" not in cache_files[0].name


def test_knowledge_store_uses_local_vector_fallback_when_primary_is_unavailable(tmp_path) -> None:
    corpus = tmp_path / "knowledge"
    corpus.mkdir()
    record = {"id": "pullup", "filename": "manual.pdf", "page": 67, "text": "dominada brazos extendidos"}
    (corpus / "chunks.jsonl").write_text(json.dumps(record) + "\n", encoding="utf-8")
    LocalVectorIndex(corpus).build([record], HashEmbeddingProvider())
    store = KnowledgeStore(
        corpus,
        vector_root=tmp_path / "missing-gemini",
        fallback_vector_root=corpus,
    )

    result = store.search("dominada brazos extendidos", limit=1)[0]

    assert result["retrieval_mode"] == "hybrid_vector_lexical"
    assert result["embedding_provider"] == "local_hash"
    assert result["retrieval_fallback"] is True


class SizeLimitedEmbeddingProvider:
    name = "test"
    model = "size-limited"

    def embed_documents(self, texts):
        if len(texts) > 2:
            raise RuntimeError("batch too large")
        return np.ones((len(texts), 4), dtype=np.float32)


def test_vector_index_adapts_a_failed_embedding_batch(tmp_path) -> None:
    records = [{"id": str(index), "text": f"fragmento {index}"} for index in range(5)]

    metadata = LocalVectorIndex(tmp_path).build(records, SizeLimitedEmbeddingProvider(), batch_size=5)

    assert metadata["count"] == 5
    assert metadata["dimensions"] == 4


class TrackingEmbeddingProvider:
    name = "test"
    model = "tracking-v1"

    def __init__(self):
        self.calls = []

    def embed_documents(self, texts):
        self.calls.append(list(texts))
        return np.asarray([[len(text), sum(map(ord, text)), 1.0] for text in texts], dtype=np.float32)


def test_vector_index_completion_reuses_rows_by_id_and_embeds_only_missing(tmp_path) -> None:
    provider = TrackingEmbeddingProvider()
    index = LocalVectorIndex(tmp_path)
    index.build([{"id": "a", "text": "alpha"}, {"id": "c", "text": "charlie"}], provider)
    original = np.load(tmp_path / "vectors.npy").copy()
    provider.calls.clear()

    metadata = index.complete([
        {"id": "a", "text": "alpha"},
        {"id": "b", "text": "bravo"},
        {"id": "c", "text": "charlie"},
    ], provider)
    completed = np.load(tmp_path / "vectors.npy")

    assert provider.calls == [["bravo"]]
    assert metadata["completion"] == {
        "reused_vectors": 2,
        "embedded_vectors": 1,
        "strategy": "exact_join_by_chunk_id",
    }
    np.testing.assert_array_equal(completed[0], original[0])
    np.testing.assert_array_equal(completed[2], original[1])


class QuotaLimitedProvider:
    name = "test"
    model = "quota-limited"

    def __init__(self):
        self.calls = 0

    def embed_documents(self, texts):
        self.calls += 1
        raise EmbeddingQuotaError("HTTP 429")


def test_vector_index_does_not_split_batches_when_quota_is_exhausted(tmp_path) -> None:
    provider = QuotaLimitedProvider()
    records = [{"id": str(index), "text": f"fragmento {index}"} for index in range(10)]

    try:
        LocalVectorIndex(tmp_path).build(records, provider, batch_size=10)
    except EmbeddingQuotaError:
        pass
    else:
        raise AssertionError("Se esperaba EmbeddingQuotaError")

    assert provider.calls == 1


class UnavailableProvider:
    name = "ollama"

    def generate_structured(self, model, system, prompt, schema):
        raise RuntimeError("offline")


class GroundedProvider:
    name = "google"

    def generate_structured(self, model, system, prompt, schema):
        return {
            "summary": "Técnica consistente.",
            "feedback": [],
            "general_recommendations": ["Mantén el patrón descrito en la fuente."],
            "source_ids": ["K1"],
        }


def test_coaching_falls_back_to_rule_engine_without_ollama() -> None:
    diagnostics = {
        "exercise": "back_squat",
        "summary": {"incorrect_repetitions": 1},
        "warnings": [],
        "repetitions": [{
            "number": 1,
            "correct": False,
            "errors": [{
                "type": "insufficient_depth",
                "description": "Profundidad insuficiente",
                "severity": "media",
                "correction": "Reduce la carga y practica la profundidad.",
            }],
        }],
    }
    context = [{
        "id": "squat-p190",
        "filename": "guide.pdf",
        "page": 190,
        "text": "Reduce la carga y conserva una profundidad controlada.",
        "score": 0.9,
    }]
    result = generate_coaching(diagnostics, context, UnavailableProvider(), "test")

    assert result["status"] == "fallback_no_llm"
    assert result["provider"] == "rules_engine"
    assert result["repetitions"][0]["corrections"] == ["Reduce la carga y practica la profundidad."]


def test_coaching_does_not_call_llm_without_rag_context() -> None:
    diagnostics = {"exercise": "air_squat", "summary": {}, "warnings": [], "repetitions": []}
    provider = UnavailableProvider()

    result = generate_coaching(diagnostics, [], provider, "test")

    assert result["status"] == "fallback_no_rag"
    assert result["provider"] == "rules_engine"


def test_coaching_exposes_auditable_grounding_trace() -> None:
    diagnostics = {
        "exercise": "strict_pull_up",
        "summary": {"incorrect_repetitions": 0},
        "warnings": [],
        "repetitions": [],
    }
    context = [{"id": "manual-p67", "filename": "manual.pdf", "page": 67, "text": "Movimiento controlado.", "score": 0.9}]

    result = generate_coaching(diagnostics, context, GroundedProvider(), "gemma-test")

    assert result["status"] == "generated"
    assert result["rag_trace"]["grounded"] is True
    assert result["rag_trace"]["remote"] is True
    assert result["rag_trace"]["citations_returned"] == ["K1"]
    assert len(result["rag_trace"]["context_sha256"]) == 64


def test_gemini_embedding_requires_explicit_api_key() -> None:
    provider = GeminiEmbeddingProvider(None)
    try:
        provider.embed_query("dominada")
        assert False, "Se esperaba RuntimeError"
    except RuntimeError as exc:
        assert "no está configurado" in str(exc)


def test_reference_library_exposes_only_correct_calibrations(tmp_path) -> None:
    folder = tmp_path / "pullup_reference"
    folder.mkdir()
    summary = {
        "video": "strict_pull_up.mp4",
        "camera_view": "side",
        "metadata": {"width": 640, "height": 360},
        "diagnostics": {
            "exercise": "strict_pull_up",
            "repetitions": [{"number": 1, "correct": True, "phase_frames": {}, "start_frame": 1, "end_frame": 9}],
        },
    }
    (folder / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    with gzip.open(folder / "pose.jsonl.gz", "wt", encoding="utf-8") as output:
        output.write(json.dumps({"frame_index": 1, "people": []}) + "\n")

    library = ReferenceLibrary(tmp_path)

    assert library.list("strict_pull_up")[0]["label"] == "strict_pull_up"
    assert library.frames("pullup_reference")[0]["frame_index"] == 1


def test_google_provider_advertises_remote_gemma_without_api_key() -> None:
    provider = GoogleGenAIProvider(None)

    models = provider.list_models()

    assert provider.name == "google"
    assert models[0]["name"] == "gemma-4-26b-a4b-it"
    assert all(item["remote"] for item in models)


def test_progress_snapshot_and_ols_trend() -> None:
    job = SimpleNamespace(
        id="session-1",
        requested_exercise="back_squat",
        original_filename="squat.mp4",
        camera_view="side",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    diagnostics = {
        "exercise": "back_squat",
        "summary": {"repetitions_detected": 2, "correct_repetitions": 1, "incorrect_repetitions": 1},
        "repetitions": [
            {"confidence": 0.9, "metrics": {"minimum_knee_angle": 80, "maximum_knee_angle": 170}, "errors": []},
            {"confidence": 0.8, "metrics": {"minimum_knee_angle": 90, "maximum_knee_angle": 165}, "errors": [{"type": "insufficient_depth"}]},
        ],
    }
    first = session_snapshot(job, diagnostics)
    second = {**first, "job_id": "session-2", "correct_repetitions": 2, "correct_rate": 100.0}
    payload = build_progress_payload([first, second], "back_squat")

    assert first["correct_rate"] == 50.0
    assert first["rom"]["value"] == 82.5
    assert first["errors"] == {"insufficient_depth": 1}
    assert payload["summary"]["correct_rate_slope_per_session"] == 50.0
    mixed = build_progress_payload([first, {**second, "exercise": "strict_pull_up"}])
    assert mixed["summary"]["rom_comparable"] is False
    assert mixed["summary"]["mean_rom"] is None
