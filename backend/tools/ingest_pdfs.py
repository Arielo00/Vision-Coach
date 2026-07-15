from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from pypdf import PdfReader

from app.rag.metadata import chunk_metadata, document_language, should_index_page


def chunks(text: str, size: int = 1200, overlap: int = 180):
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            boundary = text.rfind(" ", start + size // 2, end)
            if boundary > start:
                end = boundary
        yield text[start:end].strip()
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrae y fragmenta guías PDF locales conservando página y procedencia.")
    parser.add_argument("pdf_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    sources = []
    records = []
    for pdf in sorted(args.pdf_dir.glob("*.pdf")):
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        source_id = digest[:16]
        reader = PdfReader(str(pdf))
        source_chunks = 0
        for page_number, page in enumerate(reader.pages, start=1):
            if not should_index_page(pdf.name, page_number):
                continue
            text = re.sub(r"\s+", " ", page.extract_text() or "").strip()
            if not text:
                continue
            for index, fragment in enumerate(chunks(text)):
                if len(fragment) < 80:
                    continue
                records.append({
                    "id": f"{source_id}-p{page_number}-c{index}",
                    "source_id": source_id,
                    "filename": pdf.name,
                    "page": page_number,
                    "chunk_index": index,
                    "language": document_language(pdf.name),
                    **chunk_metadata(pdf.name, page_number),
                    "text": fragment,
                })
                source_chunks += 1
        sources.append({
            "id": source_id,
            "filename": pdf.name,
            "sha256": digest,
            "pages": len(reader.pages),
            "chunks": source_chunks,
            "status": "indexed_text",
        })
    with (args.output_dir / "chunks.jsonl").open("w", encoding="utf-8") as output:
        for record in records:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
    (args.output_dir / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sources": len(sources), "chunks": len(records), "output": str(args.output_dir.resolve())}, ensure_ascii=False))


if __name__ == "__main__":
    main()
