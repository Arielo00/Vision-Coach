from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from app.config import DEFAULT_SETTINGS
from app.rag.embeddings import EmbeddingQuotaError, GeminiEmbeddingProvider, HashEmbeddingProvider, OllamaEmbeddingProvider
from app.rag.vector_index import LocalVectorIndex


def load_records(root: Path) -> list[dict]:
    path = root / "chunks.jsonl"
    if not path.exists():
        raise SystemExit("Primero ejecuta tools/ingest_pdfs.py")
    with path.open("r", encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description="Construye el índice vectorial local del conocimiento")
    parser.add_argument("--provider", choices=("auto", "ollama", "google", "hash"), default="google")
    parser.add_argument("--model")
    parser.add_argument("--ollama-url", default=DEFAULT_SETTINGS.ollama_url)
    parser.add_argument("--dimensions", type=int, default=768)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--requests-per-minute", type=int, default=90)
    parser.add_argument("--allow-remote", action="store_true")
    parser.add_argument(
        "--complete-existing", action="store_true",
        help="Reutiliza vectores por chunk_id y calcula únicamente los faltantes.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Directorio del índice; Gemini usa por defecto la ruta activa configurada y los proveedores locales data/knowledge.",
    )
    args = parser.parse_args()

    records = load_records(DEFAULT_SETTINGS.knowledge_dir)
    provider = HashEmbeddingProvider()
    if args.provider == "google":
        if not args.allow_remote:
            raise SystemExit("Añade --allow-remote para confirmar que los chunks se enviarán a Google")
        provider = GeminiEmbeddingProvider(
            DEFAULT_SETTINGS.google_api_key,
            args.model or "gemini-embedding-2",
            args.dimensions,
            requests_per_minute=args.requests_per_minute,
        )
        # En una extensión, el primer lote faltante ya valida la conexión y
        # evitamos consumir una solicitud adicional de la cuota remota.
        if not args.complete_existing:
            provider.embed(["prueba de conexión"])
    elif args.provider in {"auto", "ollama"}:
        candidate = OllamaEmbeddingProvider(args.ollama_url, args.model or DEFAULT_SETTINGS.ollama_embedding_model)
        try:
            candidate.embed(["prueba de conexión"])
            provider = candidate
        except RuntimeError:
            if args.provider == "ollama":
                raise
            print("Ollama no disponible; se construirá el índice local de respaldo.")

    output_dir = (
        args.output_dir.resolve()
        if args.output_dir
        else DEFAULT_SETTINGS.knowledge_index_dir
        if provider.name == "google"
        else DEFAULT_SETTINGS.knowledge_dir
    )
    index = LocalVectorIndex(output_dir, args.ollama_url, DEFAULT_SETTINGS.google_api_key)
    operation = index.complete if args.complete_existing else index.build
    try:
        metadata = operation(records, provider, batch_size=args.batch_size)
    except EmbeddingQuotaError as exc:
        existing = index.metadata()
        status_payload = {
            "status": "blocked_quota",
            "provider": provider.name,
            "model": provider.model,
            "current_count": int(existing.get("count", 0)),
            "target_count": len(records),
            "missing_count": max(0, len(records) - int(existing.get("count", 0))),
            "last_attempt_utc": datetime.now(timezone.utc).isoformat(),
            "reason": str(exc),
            "safe_to_retry": True,
        }
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "completion_status.json").write_text(
            json.dumps(status_payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(status_payload, ensure_ascii=False, indent=2))
        raise SystemExit(2) from exc
    status_path = output_dir / "completion_status.json"
    if status_path.exists():
        status_path.unlink()
    metadata["output_dir"] = str(output_dir)
    print(json.dumps({key: value for key, value in metadata.items() if key != "ids"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
