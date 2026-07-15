from __future__ import annotations

import json
from pathlib import Path

from app.config import DEFAULT_SETTINGS
from app.rag.metadata import chunk_metadata, document_language


def main() -> None:
    path = DEFAULT_SETTINGS.knowledge_dir / "chunks.jsonl"
    records = []
    with path.open("r", encoding="utf-8") as source:
        for line in source:
            item = json.loads(line)
            item.update(chunk_metadata(item["filename"], int(item["page"])))
            item["language"] = document_language(item["filename"])
            records.append(item)
    temporary = path.with_suffix(".jsonl.tmp")
    with temporary.open("w", encoding="utf-8") as output:
        for item in records:
            output.write(json.dumps(item, ensure_ascii=False) + "\n")
    temporary.replace(path)
    tagged = sum(item["knowledge_role"] != "technical_reference" for item in records)
    print(json.dumps({"records": len(records), "tagged": tagged, "path": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
