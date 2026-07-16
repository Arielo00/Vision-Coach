from __future__ import annotations

import json
from pathlib import Path

from app.domain.exercise_catalog import EXERCISE_CATALOG, EXERCISE_DISCIPLINES
from app.external_catalog import ExternalCatalogStore
from app.rules_engine.common import load_config
from app.rules_engine.coverage import load_catalog_coverage
from app.rules_engine.registry import CONFIG_BY_EXERCISE


MATURITY_LABELS = {
    "active_needs_calibration": "Motor activo; calibración pendiente",
    "active_experimental_evidence_needed": "Motor experimental; falta evidencia aprobada",
    "evidence_ready": "Evidencia disponible; motor pendiente",
    "pose_only": "Pose disponible; reglas pendientes",
    "equipment_blocked": "Pendiente detector de implemento",
    "evidence_needed": "Evidencia técnica pendiente",
}

RELATIONSHIP_LABELS = {
    "exact": "Ejecución del ejercicio",
    "advanced_variant": "Variante avanzada del mismo patrón",
    "equipment_variant": "Variante con otro implemento",
    "partial_variant": "Segmento o variante parcial",
    "regression": "Regresión o ejercicio preparatorio",
    "supplemental": "Material complementario",
}

# El vínculo es deliberadamente explícito: no inferimos ejercicios por similitud
# del nombre. Esto permite distinguir evidencia exacta de variantes relacionadas.
VIDEO_SPECS = {
    "wall-ball-shots": ("inputs/videos/Wall Ball Shots.mp4", "Wall Ball Shots", "CrossFit", {
        "wall_ball_shot": "exact", "hyrox_wall_balls": "exact",
    }),
    "shoulder-press": ("inputs/references/videos/El Press De Hombro.mp4", "El press de hombro", "CrossFit", {
        "push_press": "supplemental",
    }),
    "air-squat": ("inputs/references/videos/La Sentadilla.mp4", "La sentadilla", "CrossFit", {
        "air_squat": "exact", "back_squat": "supplemental", "front_squat": "supplemental",
    }),
    "rowing-technique": ("inputs/references/videos/Rowing Technique Tips.mp4", "Rowing Technique Tips", "CrossFit", {
        "rowing": "exact",
    }),
    "abmat-sit-up": ("inputs/references/videos/The AbMat Sit-Up.mp4", "The AbMat Sit-Up", "CrossFit", {
        "sit_up": "exact",
    }),
    "burpee": ("inputs/references/videos/The Burpee.mp4", "The Burpee", "CrossFit", {
        "burpee": "exact", "burpee_broad_jump": "partial_variant",
    }),
    "dumbbell-overhead-squat": ("inputs/references/videos/The Dumbbell Overhead Squat.mp4", "The Dumbbell Overhead Squat", "CrossFit", {
        "overhead_squat": "equipment_variant",
    }),
    "dumbbell-push-jerk": ("inputs/references/videos/The Dumbbell Push Jerk.mp4", "The Dumbbell Push Jerk", "CrossFit", {
        "dumbbell_clean_and_jerk": "partial_variant", "split_jerk": "equipment_variant",
    }),
    "ghd-extensions": ("inputs/references/videos/The GHD Hip, Back, And Hip-Back Extensions.mp4", "GHD Hip, Back, and Hip-Back Extensions", "CrossFit", {
        "ghd_sit_up": "supplemental",
    }),
    "hang-power-clean-push-jerk": ("inputs/references/videos/The Hang Power Clean and Push Jerk.mp4", "Hang Power Clean and Push Jerk", "CrossFit", {
        "clean_and_jerk": "partial_variant", "push_press": "partial_variant",
    }),
    "kipping-chest-to-bar": ("inputs/references/videos/The Kipping Chest-to-Bar Pull-Up.mp4", "Kipping Chest-to-Bar Pull-Up", "CrossFit", {
        "kipping_pull_up": "advanced_variant",
    }),
    "kipping-toes-to-bar": ("inputs/references/videos/The Kipping Toes-to-Bar.mp4", "Kipping Toes-to-Bar", "CrossFit", {
        "toes_to_bar": "exact", "knees_to_elbow": "supplemental",
    }),
    "pull-over": ("inputs/references/videos/The Pull-Over.mp4", "The Pull-Over", "CrossFit", {
        "bar_muscle_up": "supplemental",
    }),
    "ring-dip": ("inputs/references/videos/The Ring Dip.mp4", "The Ring Dip", "CrossFit", {
        "parallel_dip": "equipment_variant", "ring_muscle_up": "supplemental",
    }),
    "ring-row": ("inputs/references/videos/The Ring Row.mp4", "The Ring Row", "CrossFit", {
        "strict_pull_up": "regression", "ring_muscle_up": "regression",
    }),
    "strict-bar-muscle-up": ("inputs/references/videos/The Strict Bar Muscle-Up.mp4", "The Strict Bar Muscle-Up", "CrossFit", {
        "bar_muscle_up": "exact",
    }),
    "strict-chest-to-bar": ("inputs/references/videos/The Strict Chest-to-Bar Pull-Up.mp4", "The Strict Chest-to-Bar Pull-Up", "CrossFit", {
        "strict_pull_up": "advanced_variant",
    }),
    "strict-muscle-up": ("inputs/references/videos/The Strict Muscle-Up.mp4", "The Strict Muscle-Up", "CrossFit", {
        "ring_muscle_up": "exact",
    }),
    "strict-toes-to-bar": ("inputs/references/videos/The Strict Toes-To-Bar.mp4", "The Strict Toes-to-Bar", "CrossFit", {
        "toes_to_bar": "exact", "l_sit": "supplemental",
    }),
}


def _source_key(source: dict) -> tuple:
    return (
        source.get("filename") or source.get("label"),
        tuple(source.get("pages", [])),
        source.get("section"),
        source.get("evidence_kind"),
    )


def _sources(config: dict | None, coverage: dict) -> list[dict]:
    items: list[dict] = []
    if config:
        for source in config.get("sources", []):
            items.append({
                "filename": source.get("filename", "Fuente técnica"),
                "pages": source.get("pages", []),
                "section": source.get("section"),
                "evidence_kind": source.get("evidence_kind", "technical_guidance"),
                "criteria": source.get("criteria", []),
            })
    # Los campos declarativos de cobertura sirven cuando aún no existe un YAML/JSON
    # técnico. Si ya hay config, repetirían la misma guía con otro nombre.
    if not config:
        for field, value in coverage.items():
            if field.startswith("approved_") and field.endswith("_source"):
                items.append({
                    "filename": value,
                    "pages": [],
                    "section": None,
                    "evidence_kind": field.removeprefix("approved_").removesuffix("_source"),
                    "criteria": [],
                })
    unique: list[dict] = []
    seen: set[tuple] = set()
    for item in items:
        key = _source_key(item)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def _videos(project_root: Path, exercise: str) -> list[dict]:
    items: list[dict] = []
    for video_id, (relative_path, label, publisher, relationships) in VIDEO_SPECS.items():
        relationship = relationships.get(exercise)
        if not relationship:
            continue
        path = project_root / relative_path
        items.append({
            "id": video_id,
            "label": label,
            "publisher": publisher,
            "relationship": relationship,
            "relationship_label": RELATIONSHIP_LABELS[relationship],
            "available": path.is_file(),
            "filename": path.name,
            "url": f"/api/library/videos/{video_id}" if path.is_file() else None,
        })
    return items


def _benchmark_state(project_root: Path, exercise: str, rule_names: list[str]) -> dict:
    manifest_path = project_root / "inputs" / "biomechanics_benchmark" / "manifest.jsonl"
    correct = 0
    intentional = 0
    if manifest_path.is_file():
        for raw_line in manifest_path.read_text(encoding="utf-8").splitlines():
            if not raw_line.strip():
                continue
            item = json.loads(raw_line)
            if item.get("exercise") != exercise:
                continue
            if item.get("form_label") == "correct":
                correct += 1
            elif item.get("form_label") == "intentional_error":
                intentional += 1
    return {
        "correct_clips": correct,
        "intentional_error_clips": intentional,
        "intentional_errors_pending": rule_names if rule_names and intentional == 0 else [],
        "status": "needs_intentional_errors" if rule_names and intentional == 0 else (
            "has_validation_clips" if correct or intentional else "not_started"
        ),
    }


def _secondary_sources(
    project_root: Path,
    database_path: Path,
    exercise: str,
    allow_restricted_media: bool,
) -> list[dict]:
    records = ExternalCatalogStore(database_path).list_for_exercise(exercise)
    items: list[dict] = []
    for record in records:
        relative = record.get("media_relative_path")
        path = (project_root / relative).resolve() if relative else None
        staged = bool(path and path.is_file() and path.is_relative_to(project_root.resolve()))
        display_enabled = bool(staged and allow_restricted_media)
        items.append({
            "source": record["source"],
            "source_exercise_id": record["source_exercise_id"],
            "source_url": record["source_url"],
            "name": record["name"],
            "discipline": record["discipline"],
            "standard_variant": record["standard_variant"],
            "relationship": record["relationship"],
            "relationship_label": RELATIONSHIP_LABELS.get(record["relationship"], record["relationship"]),
            "review_status": record["review_status"],
            "review_note": record.get("review_note"),
            "merge_into_standards": False,
            "equipment": record.get("equipment"),
            "target": record.get("target"),
            "instructions_es": record.get("instructions_es"),
            "instruction_steps_es": record.get("instruction_steps_es", []),
            "media": {
                "staged_available": staged,
                "display_enabled": display_enabled,
                "url": f"/api/library/external-media/exercises-dataset/{record['source_exercise_id']}" if display_enabled else None,
                "attribution": record.get("media_attribution"),
                "license_status": record["media_license_status"],
            },
        })
    return items


def build_exercise_library(
    project_root: Path,
    external_database_path: Path | None = None,
    allow_restricted_media: bool = False,
) -> dict:
    coverage_manifest = load_catalog_coverage()
    external_database_path = external_database_path or project_root / "data" / "external_catalog.db"
    items: list[dict] = []
    for exercise, label, category in EXERCISE_CATALOG:
        if exercise == "auto":
            continue
        coverage = coverage_manifest["exercises"][exercise]
        config_name = CONFIG_BY_EXERCISE.get(exercise)
        config = load_config(config_name) if config_name else None
        rules = [
            {
                "id": rule_name,
                "description": rule.get("description", rule_name.replace("_", " ")),
                "correction": rule.get("correction"),
                "severity": rule.get("severity"),
            }
            for rule_name, rule in (config or {}).get("rules", {}).items()
        ]
        sources = _sources(config, coverage)
        criteria = list(dict.fromkeys(
            criterion
            for source in sources
            for criterion in source.get("criteria", [])
        ))
        videos = _videos(project_root, exercise)
        secondary_sources = _secondary_sources(
            project_root, external_database_path, exercise, allow_restricted_media
        )
        items.append({
            "id": exercise,
            "label": label,
            "category": category,
            "categories": list(EXERCISE_DISCIPLINES[exercise]),
            "family": coverage["family"],
            "maturity": coverage["maturity"],
            "maturity_label": MATURITY_LABELS.get(coverage["maturity"], coverage["maturity"]),
            "preferred_views": coverage["preferred_views"],
            "required_equipment": coverage["required_equipment"],
            "limiting_factor": coverage["limiting_factor"],
            "criteria": criteria,
            "rules": rules,
            "sources": sources,
            "videos": videos,
            "secondary_sources": secondary_sources,
            "benchmark": _benchmark_state(project_root, exercise, [rule["id"] for rule in rules]),
            "has_rule_engine": config is not None,
        })
    return {
        "items": items,
        "summary": {
            "exercises": len(items),
            "with_rule_engine": sum(item["has_rule_engine"] for item in items),
            "with_sources": sum(bool(item["sources"]) for item in items),
            "with_video": sum(any(video["available"] for video in item["videos"]) for item in items),
            "with_secondary_sources": sum(bool(item["secondary_sources"]) for item in items),
            "secondary_media_display_enabled": allow_restricted_media,
        },
    }


def library_video_path(project_root: Path, video_id: str) -> Path | None:
    spec = VIDEO_SPECS.get(video_id)
    if not spec:
        return None
    path = (project_root / spec[0]).resolve()
    if not path.is_file() or not path.is_relative_to(project_root.resolve()):
        return None
    return path


def external_media_path(project_root: Path, database_path: Path, source_exercise_id: str) -> Path | None:
    record = ExternalCatalogStore(database_path).get("hasaneyldrm/exercises-dataset", source_exercise_id)
    if not record or not record.get("media_relative_path"):
        return None
    path = (project_root / record["media_relative_path"]).resolve()
    if not path.is_file() or not path.is_relative_to(project_root.resolve()):
        return None
    return path
