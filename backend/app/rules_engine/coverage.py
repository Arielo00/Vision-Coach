from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from app.domain.exercise_catalog import ALLOWED_EXERCISES


MANIFEST_PATH = Path(__file__).with_name("catalog_coverage.json")


@lru_cache(maxsize=1)
def load_catalog_coverage() -> dict:
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    configured = set(payload["exercises"])
    missing = ALLOWED_EXERCISES - configured
    unknown = configured - ALLOWED_EXERCISES
    if missing or unknown:
        raise ValueError(f"Catálogo de cobertura desalineado. Faltan={sorted(missing)}; sobran={sorted(unknown)}")
    return payload


def exercise_coverage(exercise: str) -> dict:
    return load_catalog_coverage()["exercises"][exercise]
