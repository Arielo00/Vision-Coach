from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

from app.rag.vector_index import LocalVectorIndex


STOPWORDS = {"de", "la", "el", "los", "las", "un", "una", "y", "en", "con", "para", "por", "del", "al"}


class KnowledgeRetrievalError(RuntimeError):
    """El índice semántico requerido no pudo producir contexto verificable."""


def tokens(text: str) -> set[str]:
    normalized = unicodedata.normalize("NFD", text.lower())
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return {token for token in re.findall(r"[a-z0-9]+", normalized) if len(token) > 2 and token not in STOPWORDS}


class KnowledgeStore:
    def __init__(
        self,
        root: Path,
        ollama_url: str = "http://127.0.0.1:11434",
        google_api_key: str | None = None,
        *,
        vector_root: Path | None = None,
        fallback_vector_root: Path | None = None,
        require_vector: bool = False,
        enable_query_cache: bool = True,
    ) -> None:
        self.root = root
        self.require_vector = require_vector
        self.vector_index = LocalVectorIndex(
            vector_root or root,
            ollama_url,
            google_api_key,
            enable_query_cache=enable_query_cache,
        )
        self.fallback_vector_index = (
            LocalVectorIndex(
                fallback_vector_root,
                ollama_url,
                google_api_key,
                enable_query_cache=enable_query_cache,
            )
            if fallback_vector_root and fallback_vector_root.resolve() != (vector_root or root).resolve()
            else None
        )

    def sources(self) -> list[dict]:
        path = self.root / "sources.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []

    def search(
        self,
        query: str,
        limit: int = 4,
        preferred_roles: set[str] | None = None,
        preferred_movements: set[str] | None = None,
    ) -> list[dict]:
        path = self.root / "chunks.jsonl"
        query_tokens = tokens(query)
        if not path.exists() or not query_tokens:
            return []
        records: dict[str, dict] = {}
        lexical_scores: dict[str, float] = {}
        with path.open("r", encoding="utf-8") as source:
            for line in source:
                record = json.loads(line)
                records[record["id"]] = record
                text_tokens = tokens(record["text"])
                matches = query_tokens & text_tokens
                if not matches:
                    continue
                score = len(matches) / max(len(query_tokens), 1)
                if query.lower() in record["text"].lower():
                    score += 0.5
                lexical_scores[record["id"]] = score

        vector_scores: dict[str, float] = {}
        active_index = self.vector_index
        used_fallback = False
        primary_error: RuntimeError | None = None
        if self.vector_index.exists():
            try:
                # Recuperar un conjunto amplio antes de aplicar priors de rol/movimiento;
                # si k es muy pequeño, el reranker nunca puede rescatar páginas pertinentes.
                vector_scores = dict(self.vector_index.search(query, limit=max(limit * 16, 64)))
            except RuntimeError as exc:
                primary_error = exc
        else:
            primary_error = RuntimeError("El índice semántico predeterminado no está disponible")
        if not vector_scores and self.fallback_vector_index and self.fallback_vector_index.exists():
            try:
                vector_scores = dict(self.fallback_vector_index.search(query, limit=max(limit * 16, 64)))
                active_index = self.fallback_vector_index
                used_fallback = bool(vector_scores)
            except RuntimeError:
                vector_scores = {}
        if self.require_vector and not vector_scores:
            raise KnowledgeRetrievalError("El índice semántico no devolvió candidatos") from primary_error
        candidate_ids = set(lexical_scores) | set(vector_scores)
        ranked = []
        for record_id in candidate_ids:
            record = records.get(record_id)
            if not record:
                continue
            lexical = min(lexical_scores.get(record_id, 0.0), 1.0)
            vector = max(vector_scores.get(record_id, 0.0), 0.0)
            score = 0.25 * lexical + 0.75 * vector if vector_scores else lexical
            role_boost = 0.08 if preferred_roles and record.get("knowledge_role") in preferred_roles else 0.0
            movement_boost = 0.12 if preferred_movements and record.get("movement") in preferred_movements else 0.0
            score += role_boost + movement_boost
            ranked.append((score, lexical, vector, record))
        ranked.sort(key=lambda item: (item[0], item[1], -item[3]["page"]), reverse=True)
        mode = "hybrid_vector_lexical" if vector_scores else "lexical"
        active_metadata = active_index.metadata() if vector_scores else {}
        unique_pages = []
        repeated_pages = []
        seen_pages: set[tuple[str, int]] = set()
        for item in ranked:
            page_key = (item[3]["filename"], int(item[3]["page"]))
            if page_key in seen_pages:
                repeated_pages.append(item)
            else:
                unique_pages.append(item)
                seen_pages.add(page_key)
        selected = (unique_pages + repeated_pages)[: max(1, min(limit, 10))]
        return [
            {
                **record,
                "score": round(score, 3),
                "lexical_score": round(lexical, 3),
                "vector_score": round(vector, 3),
                "retrieval_mode": mode,
                "embedding_provider": active_metadata.get("provider"),
                "embedding_model": active_metadata.get("model"),
                "retrieval_fallback": used_fallback,
            }
            for score, lexical, vector, record in selected
        ]
