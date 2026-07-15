from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.config import DEFAULT_SETTINGS


def dataset_format(root: Path) -> str:
    if (root / "train" / "_annotations.coco.json").is_file():
        return "coco"
    if (root / "data.yaml").is_file() or (root / "data.yml").is_file():
        return "yolo"
    raise ValueError("Dataset no reconocido: falta train/_annotations.coco.json o data.yaml.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tuning local de RF-DETR para equipo de gimnasio.")
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--model-size", choices=("nano", "small", "medium"), default="nano")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--grad-accum-steps", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    dataset = args.dataset.resolve()
    format_name = dataset_format(dataset)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = DEFAULT_SETTINGS.rfdetr_model_dir / "equipment" / "runs" / timestamp
    plan = {
        "dataset": str(dataset),
        "format": format_name,
        "model_size": args.model_size,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "grad_accum_steps": args.grad_accum_steps,
        "effective_batch_size": args.batch_size * args.grad_accum_steps,
        "learning_rate": args.lr,
        "output": str(output),
        "hardware_note": "Nano + batch 2 + acumulación 8 es el punto de partida conservador para RTX 3060 Laptop.",
    }
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    if args.dry_run:
        return

    from rfdetr import RFDETRMedium, RFDETRNano, RFDETRSmall

    model_class = {"nano": RFDETRNano, "small": RFDETRSmall, "medium": RFDETRMedium}[args.model_size]
    output.mkdir(parents=True, exist_ok=False)
    model = model_class()
    model.train(
        dataset_dir=str(dataset),
        epochs=args.epochs,
        batch_size=args.batch_size,
        grad_accum_steps=args.grad_accum_steps,
        lr=args.lr,
        output_dir=str(output),
        early_stopping=True,
        early_stopping_patience=10,
        run_test=True,
    )
    candidates = sorted(output.glob("**/checkpoint_best_total.pth"))
    if not candidates:
        raise FileNotFoundError("El entrenamiento terminó sin checkpoint_best_total.pth.")
    production = DEFAULT_SETTINGS.equipment_checkpoint
    production.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(candidates[-1], production)
    (output / "training_plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"production_checkpoint": str(production), "source_checkpoint": str(candidates[-1])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
