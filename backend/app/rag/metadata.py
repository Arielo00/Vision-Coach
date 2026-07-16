from __future__ import annotations


CFJ_LEVEL1_SECTIONS = (
    (111, 114, "biomechanics_foundation", "anatomy_and_physiology"),
    (115, 123, "movement_execution_and_coaching", "squat_family"),
    (124, 131, "movement_execution", "overhead_squat"),
    (132, 136, "movement_execution", "press_family"),
    (137, 140, "movement_execution", "deadlift"),
    (141, 144, "movement_execution", "medicine_ball_clean"),
    (145, 156, "movement_execution", "ghd"),
    (188, 188, "coach_guide", "fundamental_movements_summary"),
    (189, 193, "coach_guide", "air_squat"),
    (194, 195, "coach_guide", "front_squat"),
    (196, 197, "coach_guide", "overhead_squat"),
    (198, 201, "coach_guide", "shoulder_press"),
    (202, 205, "coach_guide", "push_press"),
    (206, 211, "coach_guide", "push_jerk"),
    (212, 218, "coach_guide", "deadlift"),
    (219, 225, "coach_guide", "sumo_deadlift_high_pull"),
    (226, 235, "coach_guide", "medicine_ball_clean"),
    (236, 236, "coach_guide", "additional_movements_summary"),
    (237, 244, "coach_guide", "pull_up"),
    (245, 249, "coach_guide", "thruster"),
    (250, 257, "coach_guide", "ring_muscle_up"),
    (258, 265, "coach_guide", "snatch"),
)

IWF_TCRR_SECTIONS = (
    (5, 5, "competition_validity", "snatch"),
    (6, 6, "competition_validity", "clean_and_jerk"),
    (7, 8, "competition_validity", "olympic_lifts"),
)

DOCUMENT_LANGUAGES = {
    "CFJ_Level1_Spanish_Latin_American.pdf": "es-419",
    "CFJ_Level2_Spanish_TrainingGuide.pdf": "es-419",
    "Manual de Calistenia SND_ 2023.pdf": "es-419",
    "IWF_TCRR_2025-11-05.pdf": "en",
}


def chunk_metadata(filename: str, page: int) -> dict:
    result = {"knowledge_role": "technical_reference", "movement": None}
    sections = {
        "CFJ_Level1_Spanish_Latin_American.pdf": CFJ_LEVEL1_SECTIONS,
        "IWF_TCRR_2025-11-05.pdf": IWF_TCRR_SECTIONS,
    }.get(filename, ())
    for start, end, role, movement in sections:
        if start <= page <= end:
            return {"knowledge_role": role, "movement": movement}
    return result


def document_language(filename: str) -> str:
    return DOCUMENT_LANGUAGES.get(filename, "und")


def should_index_page(filename: str, page: int) -> bool:
    """Aplica inclusión curada a fuentes extensas con secciones fuera de alcance."""
    if filename == "IWF_TCRR_2025-11-05.pdf":
        return 5 <= page <= 8
    return True
