from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from app.api.routes import KNOWLEDGE_QUERIES
from app.config import DEFAULT_SETTINGS, PROJECT_ROOT
from app.domain.exercise_catalog import EXERCISE_CATALOG
from app.rag import KnowledgeStore
from app.rules_engine.coverage import load_catalog_coverage


def normalized(value: str) -> set[str]:
    value = unicodedata.normalize("NFD", value.lower())
    value = "".join(char for char in value if unicodedata.category(char) != "Mn")
    return {token for token in re.findall(r"[a-z0-9]+", value) if len(token) > 2}


def main() -> None:
    settings = DEFAULT_SETTINGS
    store = KnowledgeStore(
        settings.knowledge_dir,
        settings.ollama_url,
        settings.google_api_key,
        vector_root=settings.knowledge_index_dir,
        fallback_vector_root=settings.fallback_knowledge_index_dir,
    )
    coverage = load_catalog_coverage()["exercises"]
    videos = list((PROJECT_ROOT / "inputs" / "references" / "videos").glob("*.mp4"))
    items = []
    for exercise, label, category in EXERCISE_CATALOG:
        if exercise == "auto":
            continue
        query = KNOWLEDGE_QUERIES.get(exercise, f"{label} técnica ejecución errores correcciones")
        sources = store.search(query, limit=3)
        label_tokens = normalized(f"{exercise} {label}")
        matching_videos = [path.name for path in videos if len(label_tokens & normalized(path.stem)) >= 1]
        top_score = sources[0]["score"] if sources else 0
        evidence = "strong" if top_score >= 0.65 else "partial" if top_score >= 0.48 else "weak"
        items.append({
            "exercise": exercise,
            "label": label,
            "category": category,
            "rules_status": "active" if coverage[exercise]["maturity"].startswith("active_") else "pending",
            "maturity": coverage[exercise]["maturity"],
            "retrieval_signal_only": evidence,
            "top_score": top_score,
            "sources": [
                {"filename": item["filename"], "page": item["page"], "score": item["score"]}
                for item in sources
            ],
            "candidate_reference_videos_requiring_review": matching_videos,
        })
    output = settings.data_dir / "catalog_audit.json"
    output.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "exercises": len(items),
        "active": sum(item["rules_status"] == "active" for item in items),
        "strong_retrieval_signals_not_evidence": sum(item["retrieval_signal_only"] == "strong" for item in items),
        "with_candidate_reference_video": sum(bool(item["candidate_reference_videos_requiring_review"]) for item in items),
        "output": str(output),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
