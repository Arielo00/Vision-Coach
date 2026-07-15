from app.config import PROJECT_ROOT
from tools.evaluate_embedding_indexes import page_level_relevance
from tools.evaluate_hybrid_rag import load_gold


def test_page_level_relevance_does_not_double_count_chunks() -> None:
    results = [
        {"filename": "guide.pdf", "page": 5, "id": "p5-c0"},
        {"filename": "guide.pdf", "page": 5, "id": "p5-c1"},
        {"filename": "guide.pdf", "page": 6, "id": "p6-c0"},
    ]

    assert page_level_relevance(results, {"guide.pdf": {5, 6}}) == [1, 0, 1]


def test_expanded_rag_gold_is_versioned_and_not_limited_to_seven_queries() -> None:
    payload, cases = load_gold(PROJECT_ROOT / "inputs" / "rag_benchmark" / "gold_v1.json")

    assert payload["label_unit"] == "document_page"
    assert len(cases) == 19
    assert len({case["id"] for case in cases}) == 19
    assert {case["language"] for case in cases} == {"es-419", "en"}
