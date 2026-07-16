from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path


STATUS_PATH = Path(__file__).with_name("pipeline_status.json")


@lru_cache(maxsize=1)
def load_pipeline_status() -> dict:
    payload = json.loads(STATUS_PATH.read_text(encoding="utf-8"))
    identifiers = [item["id"] for item in payload["blocks"]]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError("El estado del pipeline contiene bloques duplicados")
    return payload
