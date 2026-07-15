from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

from app.config import DEFAULT_SETTINGS
from app.rag.vector_index import LocalVectorIndex


BENCHMARK = [
    {"id": "air_squat", "query": "sentadilla profundidad cadera debajo de rodillas extensión completa columna neutral", "relevant": {"CFJ_Level1_Spanish_Latin_American.pdf": {115, 116, 117, 118, 119, 120, 121, 122, 123, 189, 190, 191, 192, 193}}},
    {"id": "push_press", "query": "push press dip corto torso vertical extensión piernas antes que brazos bloqueo overhead", "relevant": {"CFJ_Level1_Spanish_Latin_American.pdf": {132, 133, 134, 135, 136, 202, 203, 204, 205}}},
    {"id": "strict_pull_up", "query": "dominada estricta brazos extendidos cabeza sobre barra movimiento controlado", "relevant": {"Manual de Calistenia SND_ 2023.pdf": {51, 67}, "CFJ_Level1_Spanish_Latin_American.pdf": {237}}},
    {"id": "parallel_dip", "query": "fondos paralelas codos cerca tronco no superar noventa grados hombro", "relevant": {"Manual de Calistenia SND_ 2023.pdf": {61}}},
    {"id": "l_sit", "query": "L-sit brazos apoyo piernas extendidas flexión cadera noventa grados", "relevant": {"Manual de Calistenia SND_ 2023.pdf": {63, 65, 68}}},
    {"id": "snatch_iwf", "query": "IWF snatch barbell single movement full extent arms overhead feet same line incorrect movements press-out", "relevant": {"IWF_TCRR_2025-11-05.pdf": {5, 7, 8}}},
    {"id": "clean_jerk_iwf", "query": "IWF clean and jerk barbell shoulders motionless knees extended arms legs fully extended feet same line", "relevant": {"IWF_TCRR_2025-11-05.pdf": {6, 7, 8}}},
]


def load_records(root: Path) -> dict[str, dict]:
    with (root / "chunks.jsonl").open("r", encoding="utf-8") as source:
        return {item["id"]: item for item in map(json.loads, source)}


def is_relevant(record: dict, labels: dict[str, set[int]]) -> bool:
    return int(record["page"]) in labels.get(record["filename"], set())


def page_level_relevance(results: list[dict], labels: dict[str, set[int]]) -> list[int]:
    """Cuenta cada página gold una sola vez aunque recupere varios chunks."""
    seen: set[tuple[str, int]] = set()
    relevance = []
    for item in results:
        key = (item["filename"], int(item["page"]))
        relevant = is_relevant(item, labels) and key not in seen
        relevance.append(int(relevant))
        if relevant:
            seen.add(key)
    return relevance


def metrics(relevance: list[int], total_relevant: int) -> dict:
    hits = sum(relevance)
    reciprocal_rank = next((1.0 / (index + 1) for index, value in enumerate(relevance) if value), 0.0)
    dcg = sum(value / math.log2(index + 2) for index, value in enumerate(relevance))
    ideal = sum(1.0 / math.log2(index + 2) for index in range(min(total_relevant, len(relevance))))
    return {
        "recall_at_10": hits / max(total_relevant, 1),
        "mrr_at_10": reciprocal_rank,
        "ndcg_at_10": dcg / ideal if ideal else 0.0,
    }


def evaluate(name: str, index_root: Path, records: dict[str, dict]) -> dict:
    index = LocalVectorIndex(index_root, DEFAULT_SETTINGS.ollama_url, DEFAULT_SETTINGS.google_api_key)
    rows = []
    for case in BENCHMARK:
        started = time.perf_counter()
        ranked = index.search(case["query"], limit=10)
        latency_ms = (time.perf_counter() - started) * 1000
        results = [records[record_id] | {"score": score} for record_id, score in ranked if record_id in records]
        relevance = page_level_relevance(results, case["relevant"])
        total_relevant = sum(len(pages) for pages in case["relevant"].values())
        rows.append({
            "id": case["id"],
            **metrics(relevance, total_relevant),
            "latency_ms": latency_ms,
            "top_results": [{"filename": item["filename"], "page": item["page"], "score": round(float(item["score"]), 4), "relevant": bool(rel)} for item, rel in zip(results, relevance)],
        })
    keys = ("recall_at_10", "mrr_at_10", "ndcg_at_10", "latency_ms")
    return {"name": name, "index": index.metadata(), "mean": {key: sum(row[key] for row in rows) / len(rows) for key in keys}, "queries": rows}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    records = load_records(DEFAULT_SETTINGS.knowledge_dir)
    payload = {
        "benchmark_version": 3,
        "queries": len(BENCHMARK),
        "baseline": evaluate("ollama-bge-large", DEFAULT_SETTINGS.knowledge_dir, records),
        "caveat": "Conjunto gold pequeño, definido por páginas verificadas; no sustituye validación por ejercicio ni evaluación humana.",
    }
    if args.candidate:
        try:
            payload["candidate"] = evaluate("google-gemini-embedding-2", args.candidate.resolve(), records)
        except RuntimeError as exc:
            payload["candidate"] = {"status": "unavailable", "reason": str(exc)}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    candidate = payload.get("candidate")
    candidate_summary = candidate
    if isinstance(candidate, dict) and "mean" in candidate:
        metadata = candidate.get("index", {})
        candidate_summary = {
            "name": candidate.get("name"),
            "mean": candidate["mean"],
            "index": {
                "provider": metadata.get("provider"),
                "model": metadata.get("model"),
                "dimensions": metadata.get("dimensions"),
                "count": metadata.get("count"),
            },
        }
    print(json.dumps({"baseline": payload["baseline"]["mean"], "candidate": candidate_summary, "output": str(args.output.resolve())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
