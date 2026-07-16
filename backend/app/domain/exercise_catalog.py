from __future__ import annotations


EXERCISE_CATALOG = [
    ("auto", "Detectar automáticamente", "automatic"),
    ("wall_ball_shot", "Wall ball shot", "crossfit"),
    ("back_squat", "Sentadilla trasera", "crossfit"),
    ("front_squat", "Sentadilla frontal", "crossfit"),
    ("air_squat", "Air squat", "crossfit"),
    ("overhead_squat", "Sentadilla overhead", "crossfit"),
    ("snatch", "Arranque / Snatch", "crossfit"),
    ("clean_and_jerk", "Clean & jerk / Envión", "crossfit"),
    ("push_press", "Push press", "crossfit"),
    ("split_jerk", "Split jerk", "crossfit"),
    ("kettlebell_swing_russian", "Kettlebell swing ruso", "crossfit"),
    ("kettlebell_swing_american", "Kettlebell swing americano", "crossfit"),
    ("kettlebell_snatch", "Kettlebell snatch", "crossfit"),
    ("goblet_squat", "Goblet squat", "crossfit"),
    ("turkish_get_up", "Turkish get-up", "crossfit"),
    ("dumbbell_snatch", "Dumbbell snatch", "crossfit"),
    ("dumbbell_thruster", "Dumbbell thruster", "crossfit"),
    ("dumbbell_clean_and_jerk", "Dumbbell clean & jerk", "crossfit"),
    ("devil_press", "Devil press", "crossfit"),
    ("double_under", "Double unders", "crossfit"),
    ("box_jump", "Box jump", "crossfit"),
    ("box_jump_step_down", "Box jump con step-down", "crossfit"),
    ("burpee", "Burpee estándar", "crossfit"),
    ("sit_up", "Sit-up", "crossfit"),
    ("ghd_sit_up", "GHD sit-up", "crossfit"),
    ("wall_walk", "Wall walk", "crossfit"),
    ("rope_climb", "Rope climb", "crossfit"),
    ("strict_pull_up", "Dominada estricta", "calisthenics"),
    ("kipping_pull_up", "Dominada kipping", "calisthenics"),
    ("bar_muscle_up", "Muscle-up estricto en barra", "calisthenics"),
    ("ring_muscle_up", "Muscle-up estricto en anillas", "calisthenics"),
    ("parallel_dip", "Fondos en paralelas", "calisthenics"),
    ("push_up", "Flexiones", "calisthenics"),
    ("pistol_squat", "Sentadilla pistol", "calisthenics"),
    ("planche", "Plancha / Planche", "calisthenics"),
    ("l_sit", "L-sit", "calisthenics"),
    ("handstand_push_up", "Handstand push-up", "calisthenics"),
    ("toes_to_bar", "Toes-to-bar", "calisthenics"),
    ("knees_to_elbow", "Knees-to-elbow", "calisthenics"),
    ("hyrox_wall_balls", "Wall balls", "hyrox"),
    ("burpee_broad_jump", "Burpee broad jump", "hyrox"),
    ("sled_push", "Sled push", "hyrox"),
    ("sled_pull", "Sled pull", "hyrox"),
    ("farmers_carry", "Farmer's carry", "hyrox"),
    ("sandbag_lunges", "Sandbag lunges", "hyrox"),
    ("rowing", "Remo / Rowing", "hyrox"),
    ("ski_erg", "Ski erg", "hyrox"),
]

ALLOWED_EXERCISES = {exercise_id for exercise_id, _, _ in EXERCISE_CATALOG}

# Una disciplina es una clasificación de navegación, no la identidad del ejercicio.
# Los IDs compartidos conservan una sola configuración, reglas, fuentes e historial.
EXERCISE_DISCIPLINES = {
    exercise_id: (category,)
    for exercise_id, _, category in EXERCISE_CATALOG
}
EXERCISE_DISCIPLINES.update({
    "bar_muscle_up": ("crossfit", "calisthenics"),
    "ring_muscle_up": ("crossfit", "calisthenics"),
    "rowing": ("crossfit", "hyrox"),
})
