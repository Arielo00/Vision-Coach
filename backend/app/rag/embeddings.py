from __future__ import annotations

import hashlib
import json
import math
import re
import time
import unicodedata
import urllib.error
import urllib.request
from abc import ABC, abstractmethod

import numpy as np


class EmbeddingQuotaError(RuntimeError):
    """El proveedor respondió 429; subdividir el lote no resolverá la cuota."""


def _normalize_text(text: str) -> str:
    value = unicodedata.normalize("NFD", text.lower())
    return "".join(char for char in value if unicodedata.category(char) != "Mn")


class EmbeddingProvider(ABC):
    name: str
    model: str

    @abstractmethod
    def embed(self, texts: list[str]) -> np.ndarray:
        raise NotImplementedError

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self.embed(texts)

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed([text])


class HashEmbeddingProvider(EmbeddingProvider):
    """Embedding local, determinista y sin descargas para mantener operativo el RAG."""

    name = "local_hash"

    def __init__(self, dimensions: int = 384) -> None:
        self.dimensions = dimensions
        self.model = f"hashing-es-v1-{dimensions}"

    def embed(self, texts: list[str]) -> np.ndarray:
        matrix = np.zeros((len(texts), self.dimensions), dtype=np.float32)
        for row, text in enumerate(texts):
            normalized = _normalize_text(text)
            words = re.findall(r"[a-z0-9]+", normalized)
            features = words + [f"{words[i]}_{words[i + 1]}" for i in range(len(words) - 1)]
            for feature in features:
                digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
                value = int.from_bytes(digest, "little")
                column = value % self.dimensions
                sign = 1.0 if value & 1 else -1.0
                matrix[row, column] += sign * (1.0 + math.log1p(len(feature)))
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        return matrix / np.maximum(norms, 1e-12)


class OllamaEmbeddingProvider(EmbeddingProvider):
    name = "ollama"

    def __init__(self, base_url: str, model: str, timeout_seconds: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_seconds = timeout_seconds

    def embed(self, texts: list[str]) -> np.ndarray:
        payload = json.dumps({"model": self.model, "input": texts, "truncate": True}).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/embed",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as exc:
            raise RuntimeError(f"Ollama embeddings no disponible: {exc}") from exc
        vectors = np.asarray(body.get("embeddings", []), dtype=np.float32)
        if vectors.ndim != 2 or vectors.shape[0] != len(texts):
            raise RuntimeError("Ollama devolvió una matriz de embeddings inválida")
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.maximum(norms, 1e-12)


class GeminiEmbeddingProvider(EmbeddingProvider):
    name = "google"

    def __init__(
        self,
        api_key: str | None,
        model: str = "gemini-embedding-2",
        dimensions: int = 768,
        requests_per_minute: int | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions
        self.requests_per_minute = requests_per_minute
        self._next_request_at = 0.0

    def _embed(self, texts: list[str]) -> np.ndarray:
        if not self.api_key:
            raise RuntimeError("Gemini Embedding no está configurado")
        if self.requests_per_minute:
            wait_seconds = max(0.0, self._next_request_at - time.monotonic())
            if wait_seconds:
                time.sleep(wait_seconds)
            # Google contabiliza cada contenido, aunque viajen juntos en un lote.
            interval = 60.0 * len(texts) / self.requests_per_minute
            self._next_request_at = time.monotonic() + interval
        try:
            from google import genai
            from google.genai import types

            contents = [types.Content(parts=[types.Part.from_text(text=text)]) for text in texts]
            with genai.Client(api_key=self.api_key) as client:
                response = client.models.embed_content(
                    model=self.model,
                    contents=contents,
                    config=types.EmbedContentConfig(output_dimensionality=self.dimensions),
                )
            vectors = np.asarray([item.values for item in response.embeddings or []], dtype=np.float32)
        except Exception as exc:
            status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            if status_code == 429 or "429 RESOURCE_EXHAUSTED" in str(exc):
                raise EmbeddingQuotaError("Cuota de Gemini Embedding agotada (HTTP 429)") from exc
            raise RuntimeError(f"Gemini Embedding no disponible: {type(exc).__name__}") from exc
        if vectors.ndim != 2 or vectors.shape != (len(texts), self.dimensions):
            raise RuntimeError("Gemini devolvió una matriz de embeddings inválida")
        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors / np.maximum(norms, 1e-12)

    def embed(self, texts: list[str]) -> np.ndarray:
        return self._embed(texts)

    def embed_documents(self, texts: list[str]) -> np.ndarray:
        return self._embed([f"title: none | text: {text}" for text in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._embed([f"task: search result | query: {text}"])
