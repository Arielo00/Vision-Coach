from __future__ import annotations

import hashlib
import json
from pathlib import Path
from uuid import uuid4

import numpy as np

from app.rag.embeddings import EmbeddingProvider, EmbeddingQuotaError, GeminiEmbeddingProvider, HashEmbeddingProvider, OllamaEmbeddingProvider


class LocalVectorIndex:
    def __init__(
        self,
        root: Path,
        ollama_url: str = "http://127.0.0.1:11434",
        google_api_key: str | None = None,
        *,
        enable_query_cache: bool = True,
    ) -> None:
        self.root = root
        self.ollama_url = ollama_url
        self.google_api_key = google_api_key
        self.enable_query_cache = enable_query_cache
        self.metadata_path = root / "vector_index.json"
        self.vectors_path = root / "vectors.npy"
        self.query_cache_dir = root / "query_cache"

    def exists(self) -> bool:
        return self.metadata_path.is_file() and self.vectors_path.is_file()

    def metadata(self) -> dict:
        return json.loads(self.metadata_path.read_text(encoding="utf-8")) if self.exists() else {}

    def _provider(self, metadata: dict) -> EmbeddingProvider:
        if metadata.get("provider") == "ollama":
            return OllamaEmbeddingProvider(self.ollama_url, metadata["model"])
        if metadata.get("provider") == "google":
            return GeminiEmbeddingProvider(self.google_api_key, metadata["model"], int(metadata["dimensions"]))
        return HashEmbeddingProvider(int(metadata.get("dimensions", 384)))

    def build(self, records: list[dict], provider: EmbeddingProvider, batch_size: int = 32) -> dict:
        self.root.mkdir(parents=True, exist_ok=True)
        parts_dir = self.root / ".vector_parts"
        state_path = parts_dir / "state.json"
        expected_state = {
            "provider": provider.name,
            "model": provider.model,
            "count": len(records),
            "batch_size": batch_size,
        }
        parts_dir.mkdir(parents=True, exist_ok=True)
        existing_state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else None
        if existing_state != expected_state:
            for path in parts_dir.glob("part-*.npy"):
                path.unlink()
            state_path.write_text(json.dumps(expected_state, ensure_ascii=False, indent=2), encoding="utf-8")
        batches: list[np.ndarray] = []
        for offset in range(0, len(records), batch_size):
            texts = [item["text"] for item in records[offset : offset + batch_size]]
            part_path = parts_dir / f"part-{offset:06d}.npy"
            if part_path.exists():
                part = np.load(part_path, allow_pickle=False)
                if part.ndim == 2 and part.shape[0] == len(texts):
                    batches.append(part)
                    continue
                part_path.unlink()
            part = self._embed_adaptive(provider, texts)
            np.save(part_path, part, allow_pickle=False)
            batches.append(part)
            print(f"indexados={min(offset + len(texts), len(records))}/{len(records)}", flush=True)
        vectors = np.concatenate(batches, axis=0) if batches else np.empty((0, 0), dtype=np.float32)
        np.save(self.vectors_path, vectors, allow_pickle=False)
        metadata = {
            "version": 1,
            "provider": provider.name,
            "model": provider.model,
            "dimensions": int(vectors.shape[1]) if vectors.size else 0,
            "count": len(records),
            "ids": [item["id"] for item in records],
        }
        self.metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        for path in parts_dir.glob("part-*.npy"):
            path.unlink()
        if state_path.exists():
            state_path.unlink()
        parts_dir.rmdir()
        return metadata

    def complete(self, records: list[dict], provider: EmbeddingProvider, batch_size: int = 32) -> dict:
        """Completa por ID un índice parcial sin recalcular vectores válidos."""
        if not self.exists():
            return self.build(records, provider, batch_size=batch_size)
        metadata = self.metadata()
        vectors = np.load(self.vectors_path, allow_pickle=False)
        existing_ids = metadata.get("ids", [])
        if metadata.get("provider") != provider.name or metadata.get("model") != provider.model:
            raise RuntimeError("El índice parcial pertenece a otro proveedor o modelo")
        if vectors.ndim != 2 or vectors.shape[0] != len(existing_ids):
            raise RuntimeError("El índice parcial no coincide con su manifiesto")
        if len(existing_ids) != len(set(existing_ids)):
            raise RuntimeError("El índice parcial contiene IDs duplicados")
        current_ids = [item["id"] for item in records]
        if len(current_ids) != len(set(current_ids)):
            raise RuntimeError("El corpus contiene IDs duplicados")
        current_id_set = set(current_ids)
        extra_ids = [record_id for record_id in existing_ids if record_id not in current_id_set]
        if extra_ids:
            raise RuntimeError("El índice parcial contiene chunks ajenos al corpus actual")

        existing_by_id = {record_id: vectors[index] for index, record_id in enumerate(existing_ids)}
        missing_records = [item for item in records if item["id"] not in existing_by_id]
        embedded_by_id: dict[str, np.ndarray] = {}
        for offset in range(0, len(missing_records), batch_size):
            batch = missing_records[offset : offset + batch_size]
            part = self._embed_adaptive(provider, [item["text"] for item in batch])
            if part.ndim != 2 or part.shape[0] != len(batch):
                raise RuntimeError("El proveedor devolvió un lote inválido al completar el índice")
            for item, vector in zip(batch, part):
                embedded_by_id[item["id"]] = vector
            print(f"faltantes_indexados={min(offset + len(batch), len(missing_records))}/{len(missing_records)}", flush=True)

        dimensions = int(vectors.shape[1]) if vectors.size else (
            int(next(iter(embedded_by_id.values())).shape[0]) if embedded_by_id else 0
        )
        completed = np.stack([
            existing_by_id[item["id"]] if item["id"] in existing_by_id else embedded_by_id[item["id"]]
            for item in records
        ]).astype(np.float32, copy=False)
        if completed.shape != (len(records), dimensions) or not np.isfinite(completed).all():
            raise RuntimeError("La matriz completada no superó la validación dimensional")

        next_vectors = self.root / "vectors.next.npy"
        next_metadata = self.root / "vector_index.next.json"
        np.save(next_vectors, completed, allow_pickle=False)
        result = {
            "version": 1,
            "provider": provider.name,
            "model": provider.model,
            "dimensions": dimensions,
            "count": len(records),
            "ids": current_ids,
            "completion": {
                "reused_vectors": len(records) - len(missing_records),
                "embedded_vectors": len(missing_records),
                "strategy": "exact_join_by_chunk_id",
            },
        }
        next_metadata.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        next_vectors.replace(self.vectors_path)
        next_metadata.replace(self.metadata_path)
        return result

    def _embed_adaptive(self, provider: EmbeddingProvider, texts: list[str]) -> np.ndarray:
        """Reduce un lote fallido sin descartar los checkpoints ya calculados."""
        try:
            return provider.embed_documents(texts)
        except EmbeddingQuotaError:
            raise
        except RuntimeError:
            if len(texts) <= 1:
                raise
            midpoint = len(texts) // 2
            left = self._embed_adaptive(provider, texts[:midpoint])
            right = self._embed_adaptive(provider, texts[midpoint:])
            return np.concatenate((left, right), axis=0)

    def search(self, query: str, limit: int = 10) -> list[tuple[str, float]]:
        metadata = self.metadata()
        if not metadata or not query.strip():
            return []
        vectors = np.load(self.vectors_path, mmap_mode="r", allow_pickle=False)
        if vectors.shape[0] != len(metadata.get("ids", [])):
            return []
        query_vector = self._query_vector(metadata, query)
        if query_vector.shape[0] != vectors.shape[1]:
            return []
        scores = np.asarray(vectors @ query_vector, dtype=np.float32)
        count = min(max(limit, 1), len(scores))
        indices = np.argpartition(scores, -count)[-count:]
        ordered = indices[np.argsort(scores[indices])[::-1]]
        return [(metadata["ids"][int(index)], float(scores[int(index)])) for index in ordered]

    def _query_vector(self, metadata: dict, query: str) -> np.ndarray:
        """Cachea únicamente el vector; el texto de la consulta no se persiste."""
        canonical_query = " ".join(query.split())
        cache_payload = json.dumps(
            {
                "provider": metadata.get("provider"),
                "model": metadata.get("model"),
                "dimensions": int(metadata.get("dimensions", 0)),
                "query_contract": "embed_query-v1",
                "query": canonical_query,
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
        cache_key = hashlib.sha256(cache_payload).hexdigest()
        cache_path = self.query_cache_dir / f"{cache_key}.npy"
        dimensions = int(metadata.get("dimensions", 0))
        if self.enable_query_cache and cache_path.is_file():
            try:
                cached = np.load(cache_path, allow_pickle=False)
                if cached.shape == (dimensions,) and np.isfinite(cached).all():
                    return cached.astype(np.float32, copy=False)
            except (OSError, ValueError):
                pass

        vector = self._provider(metadata).embed_query(canonical_query)[0].astype(np.float32, copy=False)
        if vector.shape != (dimensions,) or not np.isfinite(vector).all():
            raise RuntimeError("El embedding de consulta no superó la validación dimensional")
        try:
            if not self.enable_query_cache:
                return vector
            self.query_cache_dir.mkdir(parents=True, exist_ok=True)
            temporary = self.query_cache_dir / f".{cache_key}.{uuid4().hex}.tmp"
            with temporary.open("wb") as output:
                np.save(output, vector, allow_pickle=False)
            temporary.replace(cache_path)
        except OSError:
            if "temporary" in locals() and temporary.exists():
                temporary.unlink(missing_ok=True)
        return vector
