from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


SCHEMA = """
CREATE TABLE IF NOT EXISTS external_exercises (
    source TEXT NOT NULL,
    source_exercise_id TEXT NOT NULL,
    canonical_exercise_id TEXT NOT NULL,
    discipline TEXT NOT NULL,
    standard_variant TEXT NOT NULL,
    relationship TEXT NOT NULL,
    review_status TEXT NOT NULL,
    merge_into_standards INTEGER NOT NULL DEFAULT 0 CHECK (merge_into_standards IN (0, 1)),
    name TEXT NOT NULL,
    category TEXT,
    body_part TEXT,
    equipment TEXT,
    target TEXT,
    muscle_group TEXT,
    secondary_muscles_json TEXT NOT NULL DEFAULT '[]',
    instructions_es TEXT,
    instruction_steps_es_json TEXT NOT NULL DEFAULT '[]',
    media_relative_path TEXT,
    media_attribution TEXT,
    media_license_status TEXT NOT NULL DEFAULT 'permission_pending',
    source_url TEXT NOT NULL,
    review_note TEXT,
    imported_at TEXT NOT NULL,
    PRIMARY KEY (source, source_exercise_id, canonical_exercise_id, standard_variant)
);
CREATE INDEX IF NOT EXISTS idx_external_canonical
    ON external_exercises(canonical_exercise_id);
"""


class ExternalCatalogStore:
    """SQLite secundaria: nunca alimenta reglas o estándares automáticamente."""

    def __init__(self, database_path: Path):
        self.database_path = Path(database_path)

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.database_path) as connection:
            connection.executescript(SCHEMA)

    def upsert(self, records: Iterable[dict]) -> int:
        self.initialize()
        rows = list(records)
        if not rows:
            return 0
        now = datetime.now(timezone.utc).isoformat()
        values = []
        for record in rows:
            if record.get("merge_into_standards"):
                raise ValueError("Las fuentes secundarias no pueden modificar estándares automáticamente")
            values.append((
                record["source"], str(record["source_exercise_id"]), record["canonical_exercise_id"],
                record["discipline"], record["standard_variant"], record["relationship"],
                record["review_status"], 0, record["name"], record.get("category"),
                record.get("body_part"), record.get("equipment"), record.get("target"),
                record.get("muscle_group"), json.dumps(record.get("secondary_muscles", []), ensure_ascii=False),
                record.get("instructions_es"), json.dumps(record.get("instruction_steps_es", []), ensure_ascii=False),
                record.get("media_relative_path"), record.get("media_attribution"),
                record.get("media_license_status", "permission_pending"), record["source_url"],
                record.get("review_note"), now,
            ))
        with sqlite3.connect(self.database_path) as connection:
            connection.executemany(
                """
                INSERT INTO external_exercises (
                    source, source_exercise_id, canonical_exercise_id, discipline, standard_variant,
                    relationship, review_status, merge_into_standards, name, category, body_part,
                    equipment, target, muscle_group, secondary_muscles_json, instructions_es,
                    instruction_steps_es_json, media_relative_path, media_attribution,
                    media_license_status, source_url, review_note, imported_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source, source_exercise_id, canonical_exercise_id, standard_variant) DO UPDATE SET
                    discipline=excluded.discipline, relationship=excluded.relationship,
                    review_status=excluded.review_status, merge_into_standards=0, name=excluded.name,
                    category=excluded.category, body_part=excluded.body_part, equipment=excluded.equipment,
                    target=excluded.target, muscle_group=excluded.muscle_group,
                    secondary_muscles_json=excluded.secondary_muscles_json,
                    instructions_es=excluded.instructions_es,
                    instruction_steps_es_json=excluded.instruction_steps_es_json,
                    media_relative_path=excluded.media_relative_path,
                    media_attribution=excluded.media_attribution,
                    media_license_status=excluded.media_license_status, source_url=excluded.source_url,
                    review_note=excluded.review_note, imported_at=excluded.imported_at
                """,
                values,
            )
        return len(values)

    def list_for_exercise(self, canonical_exercise_id: str) -> list[dict]:
        if not self.database_path.is_file():
            return []
        with sqlite3.connect(self.database_path) as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                "SELECT * FROM external_exercises WHERE canonical_exercise_id = ? ORDER BY discipline, name",
                (canonical_exercise_id,),
            ).fetchall()
        return [self._decode(row) for row in rows]

    def get(self, source: str, source_exercise_id: str) -> dict | None:
        if not self.database_path.is_file():
            return None
        with sqlite3.connect(self.database_path) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute(
                "SELECT * FROM external_exercises WHERE source = ? AND source_exercise_id = ? LIMIT 1",
                (source, source_exercise_id),
            ).fetchone()
        return self._decode(row) if row else None

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict:
        item = dict(row)
        item["merge_into_standards"] = bool(item["merge_into_standards"])
        item["secondary_muscles"] = json.loads(item.pop("secondary_muscles_json"))
        item["instruction_steps_es"] = json.loads(item.pop("instruction_steps_es_json"))
        return item
