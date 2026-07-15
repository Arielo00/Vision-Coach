import json

from app.rag import KnowledgeStore
from app.rag.metadata import chunk_metadata, document_language, should_index_page


def test_local_knowledge_search_preserves_source_and_page(tmp_path) -> None:
    root = tmp_path / "knowledge"
    root.mkdir()
    (root / "chunks.jsonl").write_text(
        json.dumps({
            "id": "manual-p67-c0",
            "filename": "manual.pdf",
            "page": 67,
            "text": "La dominada inicia con brazos extendidos y vuelve de forma controlada.",
        }, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    results = KnowledgeStore(root).search("dominada brazos extendidos controlada")

    assert results[0]["filename"] == "manual.pdf"
    assert results[0]["page"] == 67
    assert results[0]["score"] > 0


def test_cfj_level1_ranges_are_tagged_by_document_role() -> None:
    assert chunk_metadata("CFJ_Level1_Spanish_Latin_American.pdf", 202) == {
        "knowledge_role": "coach_guide",
        "movement": "push_press",
    }
    assert chunk_metadata("CFJ_Level1_Spanish_Latin_American.pdf", 124) == {
        "knowledge_role": "movement_execution",
        "movement": "overhead_squat",
    }


def test_iwf_rules_are_tagged_as_english_competition_validity() -> None:
    assert chunk_metadata("IWF_TCRR_2025-11-05.pdf", 5) == {
        "knowledge_role": "competition_validity",
        "movement": "snatch",
    }
    assert chunk_metadata("IWF_TCRR_2025-11-05.pdf", 7)["movement"] == "olympic_lifts"
    assert document_language("IWF_TCRR_2025-11-05.pdf") == "en"
    assert should_index_page("IWF_TCRR_2025-11-05.pdf", 8) is True
    assert should_index_page("IWF_TCRR_2025-11-05.pdf", 58) is False


def test_movement_prior_resolves_semantic_ambiguity_without_hard_filter(tmp_path) -> None:
    root = tmp_path / "knowledge"
    root.mkdir()
    records = [
        {"id": "clean", "filename": "guide.pdf", "page": 10, "text": "pelota extensión cadera", "knowledge_role": "coach_guide", "movement": "medicine_ball_clean"},
        {"id": "squat", "filename": "guide.pdf", "page": 20, "text": "pelota extensión cadera", "knowledge_role": "coach_guide", "movement": "squat_family"},
    ]
    (root / "chunks.jsonl").write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")

    results = KnowledgeStore(root).search("pelota extensión cadera", preferred_movements={"squat_family"})

    assert results[0]["movement"] == "squat_family"
    assert {item["movement"] for item in results} == {"squat_family", "medicine_ball_clean"}
