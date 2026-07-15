from __future__ import annotations

import json

from app.api.routes import KNOWLEDGE_QUERIES
from app.config import DEFAULT_SETTINGS
from app.domain.exercise_catalog import ALLOWED_EXERCISES, EXERCISE_CATALOG
from app.rules_engine import analyze_exercise
from app.rules_engine.common import load_config
from app.rules_engine.coverage import load_catalog_coverage
from app.rules_engine.registry import CONFIG_BY_EXERCISE


def main() -> None:
    payload = load_catalog_coverage()
    coverage = payload["exercises"]
    issues: list[dict] = []
    active = {exercise for exercise, item in coverage.items() if item["maturity"].startswith("active_")}
    if set(coverage) != ALLOWED_EXERCISES:
        issues.append({"type": "catalog_alignment", "detail": "Cobertura y selector no contienen los mismos IDs."})
    for exercise, label, category in EXERCISE_CATALOG:
        item = coverage[exercise]
        for field in ("family", "maturity", "preferred_views", "required_equipment", "limiting_factor"):
            if field not in item or item[field] in (None, ""):
                issues.append({"exercise": exercise, "type": "missing_field", "field": field})
        if exercise not in active:
            continue
        result = analyze_exercise([], "side", exercise)
        if result["status"] != "completed":
            issues.append({"exercise": exercise, "type": "dispatcher_not_active", "status": result["status"]})
        if exercise not in KNOWLEDGE_QUERIES:
            issues.append({"exercise": exercise, "type": "missing_rag_query"})
        config_name = CONFIG_BY_EXERCISE.get(exercise)
        if not config_name:
            issues.append({"exercise": exercise, "type": "missing_config_mapping"})
            continue
        config = load_config(config_name)
        if not config.get("rules"):
            issues.append({"exercise": exercise, "type": "rules_empty"})
        if item["maturity"] == "active_needs_calibration" and not config.get("sources"):
            issues.append({"exercise": exercise, "type": "approved_source_missing"})
        if item["maturity"] == "active_experimental_evidence_needed" and config.get("evidence_status") != "technical_source_needed":
            issues.append({"exercise": exercise, "type": "experimental_evidence_not_declared"})

    report = {
        "schema_version": 1,
        "catalog_items": len(coverage),
        "exercise_items": len(coverage) - 1,
        "active_engines": len(active),
        "active_with_approved_or_direct_evidence": sum(coverage[item]["maturity"] == "active_needs_calibration" for item in active),
        "active_experimental_evidence_needed": sum(coverage[item]["maturity"] == "active_experimental_evidence_needed" for item in active),
        "issues": issues,
        "valid": not issues,
    }
    output = DEFAULT_SETTINGS.data_dir / "catalog_verification.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report | {"output": str(output)}, ensure_ascii=False, indent=2))
    raise SystemExit(0 if not issues else 1)


if __name__ == "__main__":
    main()
