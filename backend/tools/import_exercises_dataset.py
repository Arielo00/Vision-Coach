from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path, PurePosixPath

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.domain.exercise_catalog import ALLOWED_EXERCISES  # noqa: E402
from app.external_catalog import ExternalCatalogStore  # noqa: E402


RAW_ROOT = "https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main"
NORMALIZED_ATTRIBUTION = "© Gymvisual — https://gymvisual.com/"


def build_records(dataset: list[dict], selection: dict, media_dir: Path) -> list[dict]:
    by_id = {str(item["id"]): item for item in dataset}
    records: list[dict] = []
    for selected in selection["records"]:
        source_id = str(selected["id"])
        item = by_id.get(source_id)
        if item is None:
            raise ValueError(f"No existe el ID {source_id} en el dataset de origen")
        canonical_id = selected["canonical_exercise_id"]
        if canonical_id not in ALLOWED_EXERCISES:
            raise ValueError(f"El ejercicio canónico {canonical_id} no existe en el catálogo local")
        gif_name = PurePosixPath(item["gif_url"]).name if item.get("gif_url") else None
        records.append({
            "source": selection["source"],
            "source_exercise_id": source_id,
            "canonical_exercise_id": canonical_id,
            "discipline": selected["discipline"],
            "standard_variant": selected["standard_variant"],
            "relationship": selected["relationship"],
            "review_status": selected["review_status"],
            "merge_into_standards": False,
            "name": item["name"],
            "category": item.get("category"),
            "body_part": item.get("body_part"),
            "equipment": item.get("equipment"),
            "target": item.get("target"),
            "muscle_group": item.get("muscle_group"),
            "secondary_muscles": item.get("secondary_muscles", []),
            "instructions_es": (item.get("instructions") or {}).get("es"),
            "instruction_steps_es": (item.get("instruction_steps") or {}).get("es", []),
            "media_relative_path": str((media_dir / gif_name).relative_to(PROJECT_ROOT)).replace("\\", "/") if gif_name else None,
            "media_attribution": NORMALIZED_ATTRIBUTION,
            "media_license_status": "permission_pending",
            "source_url": f"{selection['source_url']}/blob/main/data/exercises.json",
            "review_note": selected.get("review_note"),
            "_remote_media": f"{RAW_ROOT}/{item['gif_url']}" if item.get("gif_url") else None,
        })
    return records


def download_media(records: list[dict], media_dir: Path) -> int:
    media_dir.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    for record in records:
        remote = record.get("_remote_media")
        relative_path = record.get("media_relative_path")
        if not remote or not relative_path:
            continue
        destination = PROJECT_ROOT / relative_path
        if not destination.is_file():
            urllib.request.urlretrieve(remote, destination)
            downloaded += 1
    return downloaded


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa una selección curada a la SQLite secundaria.")
    parser.add_argument("--source-json", type=Path, required=True)
    parser.add_argument(
        "--selection", type=Path,
        default=BACKEND_ROOT / "app" / "external_catalog" / "selections" / "exercises_dataset.json",
    )
    parser.add_argument("--database", type=Path, default=PROJECT_ROOT / "data" / "external_catalog.db")
    parser.add_argument(
        "--media-dir", type=Path,
        default=PROJECT_ROOT / "inputs" / "external_catalogs" / "exercises_dataset" / "media",
    )
    parser.add_argument("--download-media", action="store_true")
    args = parser.parse_args()

    dataset = json.loads(args.source_json.read_text(encoding="utf-8"))
    selection = json.loads(args.selection.read_text(encoding="utf-8"))
    records = build_records(dataset, selection, args.media_dir.resolve())
    downloaded = download_media(records, args.media_dir.resolve()) if args.download_media else 0
    for record in records:
        record.pop("_remote_media", None)
    imported = ExternalCatalogStore(args.database).upsert(records)
    print(json.dumps({
        "imported": imported,
        "media_downloaded": downloaded,
        "database": str(args.database.resolve()),
        "media_display": "blocked_until_GYMVISUAL_MEDIA_LICENSED",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
