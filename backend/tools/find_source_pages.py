from __future__ import annotations

import argparse
import json
from collections import Counter

from app.config import DEFAULT_SETTINGS


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("terms", nargs="+")
    args = parser.parse_args()
    with (DEFAULT_SETTINGS.knowledge_dir / "chunks.jsonl").open(encoding="utf-8") as source:
        records = [json.loads(line) for line in source]
    for term in args.terms:
        matches = Counter(
            (record["filename"], record["page"])
            for record in records
            if term.lower() in record["text"].lower()
        )
        print(f"\n{term}")
        for (filename, page), count in matches.most_common(8):
            print(f"{filename} p.{page}: {count}")


if __name__ == "__main__":
    main()
