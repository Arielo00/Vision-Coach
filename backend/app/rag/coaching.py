from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel, Field, ValidationError

from app.llm_provider import LLMProvider


SAFETY_NOTICE = (
    "Esta retroalimentación es una herramienta de apoyo basada en visión por computadora; "
    "no diagnostica lesiones ni sustituye a un entrenador certificado o profesional de salud."
)


class NarrativeFeedback(BaseModel):
    error_type: str
    correction_steps: list[str] = Field(max_length=4)
    progression: str | None = None
    source_ids: list[str] = Field(min_length=1, max_length=4)


class CoachNarrative(BaseModel):
    summary: str
    feedback: list[NarrativeFeedback]
    general_recommendations: list[str] = Field(max_length=4)
    source_ids: list[str] = Field(min_length=1, max_length=4)


def _rag_trace(context: list[dict], payload: str, citations: list[str], provider: str) -> dict:
    return {
        "context_sha256": hashlib.sha256(payload.encode("utf-8")).hexdigest(),
        "chunks_sent": [
            {
                "source_id": f"K{index + 1}",
                "chunk_id": item["id"],
                "filename": item["filename"],
                "page": item["page"],
                "score": item.get("score"),
            }
            for index, item in enumerate(context)
        ],
        "citations_returned": citations,
        "grounded": bool(context) and bool(citations),
        "provider": provider,
        "remote": provider == "google",
    }


def _fallback(diagnostics: dict, context: list[dict], status: str) -> dict:
    repetitions = []
    for repetition in diagnostics.get("repetitions", []):
        repetitions.append({
            "number": repetition["number"],
            "correct": repetition["correct"],
            "errors": [
                {"type": issue["type"], "description": issue["description"], "severity": issue["severity"]}
                for issue in repetition.get("errors", [])
            ],
            "corrections": [issue["correction"] for issue in repetition.get("errors", [])],
            "progressions_suggested": [],
        })
    incorrect = diagnostics.get("summary", {}).get("incorrect_repetitions", 0)
    summary = (
        f"Se detectaron {incorrect} repeticiones que requieren revisión técnica."
        if incorrect
        else "Las repeticiones evaluables no activaron errores en las reglas configuradas."
    )
    serialized_context = json.dumps([
        {"source_id": f"K{index + 1}", "filename": item["filename"], "page": item["page"], "text": item["text"]}
        for index, item in enumerate(context)
    ], ensure_ascii=False, sort_keys=True)
    return {
        "exercise": diagnostics.get("exercise", "unknown"),
        "provider": "rules_engine",
        "model": None,
        "status": status,
        "summary": summary,
        "repetitions": repetitions,
        "general_recommendations": ["Revisa los cuadros de fase clave y conserva una vista de cámara estable."],
        "sources": [{"filename": item["filename"], "page": item["page"]} for item in context],
        "rag_trace": _rag_trace(context, serialized_context, [], "rules_engine"),
        "safety_notice": SAFETY_NOTICE,
    }


def generate_coaching(
    diagnostics: dict,
    context: list[dict],
    provider: LLMProvider,
    model: str,
) -> dict:
    baseline = _fallback(diagnostics, context, "fallback_no_llm")
    if not context:
        baseline["status"] = "fallback_no_rag"
        baseline["general_recommendations"] = [
            "No se generó orientación lingüística porque no hubo contexto documental recuperable; "
            "revisa únicamente el diagnóstico determinista y las fases del video."
        ]
        return baseline
    detected_errors = {
        issue["type"]: issue
        for repetition in diagnostics.get("repetitions", [])
        for issue in repetition.get("errors", [])
    }
    compact_diagnosis = {
        "exercise": diagnostics.get("exercise"),
        "summary": diagnostics.get("summary"),
        "repetitions": diagnostics.get("repetitions"),
        "warnings": diagnostics.get("warnings"),
    }
    source_context = [
        {"source_id": f"K{index + 1}", "source": item["filename"], "page": item["page"], "text": item["text"]}
        for index, item in enumerate(context)
    ]
    serialized_context = json.dumps(source_context, ensure_ascii=False, sort_keys=True)
    system = (
        "Eres un coach de fuerza en Español Latinoamérica. No inventes biomecánica, errores ni lesiones. "
        "El motor de reglas es la única autoridad para decidir si una repetición es correcta y qué errores existen. "
        "Tu tarea es explicar esos hallazgos y proponer pasos accionables apoyados solamente en el contexto documental. "
        "Cada corrección o progresión debe citar al menos un source_id del contexto. "
        "Si falta evidencia, dilo con claridad. No hagas diagnósticos médicos."
    )
    prompt = (
        "Devuelve retroalimentación breve y práctica. Solo puedes usar tipos de error presentes en el diagnóstico.\n"
        f"DIAGNÓSTICO:\n{json.dumps(compact_diagnosis, ensure_ascii=False)}\n"
        f"CONTEXTO DOCUMENTAL:\n{serialized_context}"
    )
    try:
        raw = provider.generate_structured(model, system, prompt, CoachNarrative.model_json_schema())
        narrative = CoachNarrative.model_validate(raw)
    except (RuntimeError, ValidationError):
        return baseline

    allowed_source_ids = {item["source_id"] for item in source_context}
    feedback = {
        item.error_type: item
        for item in narrative.feedback
        if item.error_type in detected_errors and any(source_id in allowed_source_ids for source_id in item.source_ids)
    }
    citations = sorted({
        source_id
        for source_id in narrative.source_ids + [source_id for item in feedback.values() for source_id in item.source_ids]
        if source_id in allowed_source_ids
    })
    if context and not citations:
        baseline["status"] = "fallback_ungrounded"
        return baseline
    for repetition in baseline["repetitions"]:
        corrections: list[str] = []
        progressions: list[str] = []
        for issue in repetition["errors"]:
            item = feedback.get(issue["type"])
            if item:
                corrections.extend(item.correction_steps)
                if item.progression:
                    progressions.append(item.progression)
            else:
                corrections.append(detected_errors[issue["type"]]["correction"])
        repetition["corrections"] = corrections
        repetition["progressions_suggested"] = progressions
    baseline.update(
        provider=provider.name,
        model=model,
        status="generated",
        summary=narrative.summary,
        general_recommendations=narrative.general_recommendations,
        rag_trace=_rag_trace(context, serialized_context, citations, provider.name),
    )
    return baseline


class CoachingRequest(BaseModel):
    model: str | None = None
    allow_remote: bool = False
