from __future__ import annotations

from app.exercise_classifier import classify_exercise
from app.rules_engine.back_squat import analyze_back_squat, analyze_squat
from app.rules_engine.common import metrics_from_frames
from app.rules_engine.kettlebell_swing import analyze_kettlebell_swing
from app.rules_engine.strict_pull_up import analyze_strict_pull_up
from app.rules_engine.kipping_pull_up import analyze_kipping_pull_up
from app.rules_engine.wall_ball import analyze_wall_ball
from app.rules_engine.parallel_dip import analyze_parallel_dip
from app.rules_engine.l_sit import analyze_l_sit
from app.rules_engine.push_press import analyze_push_press


def analyze_exercise(frames: list[dict], camera_view: str, requested_exercise: str) -> dict:
    if requested_exercise == "auto":
        classification = classify_exercise(metrics_from_frames(frames, 0.40))
        detected = classification["exercise"]
        if detected == "unknown":
            return {
                "exercise": "unknown",
                "exercise_source": "automatic",
                "exercise_confidence": classification["confidence"],
                "classification_reason": classification["reason"],
                "classification_candidates": classification.get("candidates", []),
                "classification_features": classification.get("features", {}),
                "status": "unsupported_or_uncertain",
                "warnings": ["La clasificación no es suficientemente confiable. Selecciona el ejercicio manualmente para aplicar reglas."],
                "summary": {"repetitions_detected": 0, "correct_repetitions": 0, "incorrect_repetitions": 0},
                "repetitions": [],
                "equipment": {"required": [], "detected": [], "status": "not_evaluated", "message": "Primero debe confirmarse el ejercicio."},
            }
        result = analyze_exercise(frames, camera_view, detected)
        result.update(
            exercise_source="automatic",
            exercise_confidence=classification["confidence"],
            classification_reason=classification["reason"],
            classification_candidates=classification.get("candidates", []),
            classification_features=classification.get("features", {}),
        )
        return result
    if requested_exercise == "wall_ball_shot":
        result = analyze_wall_ball(frames, camera_view, requested_exercise)
        if result.get("exercise") == "wall_ball_shot" and "equipment" not in result:
            result["equipment"] = {"required": ["wall_ball"], "detected": [], "status": "checkpoint_required", "message": "La trayectoria del balón se habilitará con el checkpoint de equipo."}
        return result
    if requested_exercise == "hyrox_wall_balls":
        result = analyze_wall_ball(frames, camera_view, "wall_ball_shot")
        result["exercise"] = "hyrox_wall_balls"
        if "equipment" not in result:
            result["equipment"] = {"required": ["wall_ball"], "detected": [], "status": "checkpoint_required", "message": "La trayectoria del balón se habilitará con el checkpoint de equipo."}
        return result
    if requested_exercise == "back_squat":
        return analyze_back_squat(frames, camera_view)
    if requested_exercise in {"air_squat", "front_squat", "overhead_squat", "goblet_squat"}:
        return analyze_squat(frames, camera_view, requested_exercise)
    if requested_exercise == "strict_pull_up":
        return analyze_strict_pull_up(frames, camera_view)
    if requested_exercise == "kipping_pull_up":
        return analyze_kipping_pull_up(frames, camera_view)
    if requested_exercise == "parallel_dip":
        return analyze_parallel_dip(frames, camera_view)
    if requested_exercise == "l_sit":
        return analyze_l_sit(frames, camera_view)
    if requested_exercise == "push_press":
        return analyze_push_press(frames, camera_view)
    if requested_exercise in {"kettlebell_swing_russian", "kettlebell_swing_american"}:
        return analyze_kettlebell_swing(frames, camera_view, requested_exercise)
    return {
        "exercise": requested_exercise,
        "exercise_source": "manual",
        "exercise_confidence": 1.0,
        "classification_reason": "Ejercicio seleccionado manualmente.",
        "status": "rules_not_available",
        "warnings": ["La pose está disponible, pero este ejercicio todavía no tiene un archivo de reglas biomecánicas activo."],
        "summary": {"repetitions_detected": 0, "correct_repetitions": 0, "incorrect_repetitions": 0},
        "repetitions": [],
        "equipment": {"required": [], "detected": [], "status": "not_evaluated", "message": "El equipo requerido se definirá junto con las reglas del ejercicio."},
    }
