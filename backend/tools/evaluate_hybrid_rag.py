from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from app.api.routes import KNOWLEDGE_MOVEMENTS
from app.config import DEFAULT_SETTINGS, PROJECT_ROOT
from app.rag.knowledge import KnowledgeStore
from tools.evaluate_embedding_indexes import metrics, page_level_relevance


DEFAULT_GOLD = PROJECT_ROOT / "inputs" / "rag_benchmark" / "gold_v1.json"
PRODUCTION_PREFERRED_ROLES = {
    "coach_guide",
    "movement_execution_and_coaching",
    "movement_execution",
}


def load_gold(path: Path) -> tuple[dict, list[dict]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases", [])
    if not cases:
        raise RuntimeError("El conjunto gold no contiene consultas")
    ids = [case["id"] for case in cases]
    if len(ids) != len(set(ids)):
        raise RuntimeError("El conjunto gold contiene IDs duplicados")
    return payload, cases


def relevant_labels(case: dict) -> dict[str, set[int]]:
    return {
        filename: {int(page) for page in pages}
        for filename, pages in case["relevant"].items()
    }


def evaluate(name: str, index_root: Path, cases: list[dict]) -> dict:
    store = KnowledgeStore(
        DEFAULT_SETTINGS.knowledge_dir,
        DEFAULT_SETTINGS.ollama_url,
        DEFAULT_SETTINGS.google_api_key,
        vector_root=index_root,
        require_vector=True,
        enable_query_cache=False,
    )
    rows = []
    for case in cases:
        labels = relevant_labels(case)
        started = time.perf_counter()
        results = store.search(
            case["query"],
            limit=10,
            preferred_roles=PRODUCTION_PREFERRED_ROLES,
            preferred_movements=KNOWLEDGE_MOVEMENTS.get(case["exercise"]),
        )
        latency_ms = (time.perf_counter() - started) * 1000
        relevance = page_level_relevance(results, labels)
        total_relevant = sum(len(pages) for pages in labels.values())
        rows.append(
            {
                "id": case["id"],
                "exercise": case["exercise"],
                "language": case["language"],
                **metrics(relevance, total_relevant),
                "latency_ms": latency_ms,
                "retrieval_modes": sorted({item["retrieval_mode"] for item in results}),
                "top_results": [
                    {
                        "filename": item["filename"],
                        "page": item["page"],
                        "score": item["score"],
                        "vector_score": item.get("vector_score"),
                        "lexical_score": item.get("lexical_score"),
                        "relevant": bool(is_relevant),
                    }
                    for item, is_relevant in zip(results, relevance)
                ],
            }
        )
    metric_keys = ("recall_at_10", "mrr_at_10", "ndcg_at_10")
    latencies = [row["latency_ms"] for row in rows]
    return {
        "name": name,
        "index": store.vector_index.metadata(),
        "mean": {key: sum(row[key] for row in rows) / len(rows) for key in metric_keys},
        "latency": {
            "mean_ms": statistics.mean(latencies),
            "median_ms": statistics.median(latencies),
            "min_ms": min(latencies),
            "max_ms": max(latencies),
            "query_cache": False,
        },
        "queries": rows,
    }


def compact(result: dict | None) -> dict | None:
    if not result:
        return result
    metadata = result.get("index", {})
    return {
        "name": result.get("name"),
        "mean": result.get("mean"),
        "latency": result.get("latency"),
        "index": {
            "provider": metadata.get("provider"),
            "model": metadata.get("model"),
            "dimensions": metadata.get("dimensions"),
            "count": metadata.get("count"),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evalúa el ranking híbrido completo sobre páginas gold")
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--candidate", type=Path, default=DEFAULT_SETTINGS.knowledge_index_dir)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    gold, cases = load_gold(args.gold.resolve())
    payload = {
        "benchmark_version": 4,
        "retrieval_pipeline": {
            "semantic_weight": 0.75,
            "lexical_weight": 0.25,
            "role_boost": 0.08,
            "movement_boost": 0.12,
            "page_diversity": True,
            "query_cache": False,
            "role_routing": "production_profile",
            "movement_routing": "production_profile",
        },
        "gold": {
            "path": str(args.gold.resolve()),
            "version": gold["version"],
            "queries": len(cases),
            "exercises": len({case["exercise"] for case in cases}),
            "languages": sorted({case["language"] for case in cases}),
            "label_unit": gold["label_unit"],
            "provenance": gold["provenance"],
        },
        "baseline": evaluate("ollama-bge-large-hybrid", DEFAULT_SETTINGS.knowledge_dir, cases),
        "candidate": evaluate("google-gemini-embedding-2-hybrid", args.candidate.resolve(), cases),
        "caveat": (
            "Gold construido desde páginas verificadas; sigue siendo pequeño y no mide fidelidad del texto generado "
            "ni seguridad clínica. Las consultas de un mismo ejercicio no son observaciones independientes."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "gold": payload["gold"],
                "baseline": compact(payload["baseline"]),
                "candidate": compact(payload["candidate"]),
                "output": str(args.output.resolve()),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
