import type { ExerciseId } from "./types";

export type ExerciseCategory = "automatic" | "crossfit" | "calisthenics" | "hyrox";

export interface ExerciseCatalogItem {
  id: ExerciseId;
  label: string;
  category: ExerciseCategory;
  categories?: ExerciseCategory[];
  keywords?: string[];
}

export const categoryLabels: Record<ExerciseCategory, string> = {
  automatic: "Detección automática",
  crossfit: "CrossFit",
  calisthenics: "Calistenia",
  hyrox: "Hyrox",
};

export const exercises: ExerciseCatalogItem[] = [
  { id: "auto", label: "Detectar automáticamente", category: "automatic", keywords: ["automático", "reconocer"] },

  { id: "wall_ball_shot", label: "Wall ball shot", category: "crossfit", keywords: ["balón", "wallball"] },
  { id: "back_squat", label: "Sentadilla trasera", category: "crossfit", keywords: ["back squat"] },
  { id: "front_squat", label: "Sentadilla frontal", category: "crossfit", keywords: ["front squat"] },
  { id: "air_squat", label: "Air squat", category: "crossfit", keywords: ["sentadilla aire"] },
  { id: "overhead_squat", label: "Sentadilla overhead", category: "crossfit", keywords: ["overhead squat", "ohs"] },
  { id: "snatch", label: "Arranque / Snatch", category: "crossfit", keywords: ["halterofilia"] },
  { id: "clean_and_jerk", label: "Clean & jerk / Envión", category: "crossfit", keywords: ["halterofilia", "cargada"] },
  { id: "push_press", label: "Push press", category: "crossfit" },
  { id: "split_jerk", label: "Split jerk", category: "crossfit" },
  { id: "kettlebell_swing_russian", label: "Kettlebell swing ruso", category: "crossfit", keywords: ["pesa rusa"] },
  { id: "kettlebell_swing_american", label: "Kettlebell swing americano", category: "crossfit", keywords: ["pesa rusa"] },
  { id: "kettlebell_snatch", label: "Kettlebell snatch", category: "crossfit" },
  { id: "goblet_squat", label: "Goblet squat", category: "crossfit" },
  { id: "turkish_get_up", label: "Turkish get-up", category: "crossfit" },
  { id: "dumbbell_snatch", label: "Dumbbell snatch", category: "crossfit", keywords: ["mancuerna"] },
  { id: "dumbbell_thruster", label: "Dumbbell thruster", category: "crossfit", keywords: ["mancuerna"] },
  { id: "dumbbell_clean_and_jerk", label: "Dumbbell clean & jerk", category: "crossfit" },
  { id: "devil_press", label: "Devil press", category: "crossfit" },
  { id: "double_under", label: "Double unders", category: "crossfit", keywords: ["saltos dobles", "cuerda"] },
  { id: "box_jump", label: "Box jump", category: "crossfit", keywords: ["salto cajón"] },
  { id: "box_jump_step_down", label: "Box jump con step-down", category: "crossfit" },
  { id: "burpee", label: "Burpee estándar", category: "crossfit" },
  { id: "sit_up", label: "Sit-up", category: "crossfit" },
  { id: "ghd_sit_up", label: "GHD sit-up", category: "crossfit" },
  { id: "wall_walk", label: "Wall walk", category: "crossfit" },
  { id: "rope_climb", label: "Rope climb", category: "crossfit", keywords: ["subir cuerda"] },

  { id: "strict_pull_up", label: "Dominada estricta", category: "calisthenics", keywords: ["pull-up"] },
  { id: "kipping_pull_up", label: "Dominada kipping", category: "calisthenics", keywords: ["pull-up"] },
  { id: "bar_muscle_up", label: "Muscle-up estricto en barra", category: "calisthenics", categories: ["crossfit", "calisthenics"] },
  { id: "ring_muscle_up", label: "Muscle-up estricto en anillas", category: "calisthenics", categories: ["crossfit", "calisthenics"] },
  { id: "parallel_dip", label: "Fondos en paralelas", category: "calisthenics", keywords: ["dips"] },
  { id: "push_up", label: "Flexiones", category: "calisthenics", keywords: ["push-up"] },
  { id: "pistol_squat", label: "Sentadilla pistol", category: "calisthenics" },
  { id: "planche", label: "Plancha / Planche", category: "calisthenics" },
  { id: "l_sit", label: "L-sit", category: "calisthenics" },
  { id: "handstand_push_up", label: "Handstand push-up", category: "calisthenics", keywords: ["press militar pino", "hspu"] },
  { id: "toes_to_bar", label: "Toes-to-bar", category: "calisthenics" },
  { id: "knees_to_elbow", label: "Knees-to-elbow", category: "calisthenics" },

  { id: "hyrox_wall_balls", label: "Wall balls", category: "hyrox" },
  { id: "burpee_broad_jump", label: "Burpee broad jump", category: "hyrox" },
  { id: "sled_push", label: "Sled push", category: "hyrox", keywords: ["empuje trineo"] },
  { id: "sled_pull", label: "Sled pull", category: "hyrox", keywords: ["arrastre trineo"] },
  { id: "farmers_carry", label: "Farmer's carry", category: "hyrox", keywords: ["acarreo granjero"] },
  { id: "sandbag_lunges", label: "Sandbag lunges", category: "hyrox", keywords: ["zancadas saco"] },
  { id: "rowing", label: "Remo / Rowing", category: "hyrox", categories: ["crossfit", "hyrox"], keywords: ["ergómetro"] },
  { id: "ski_erg", label: "Ski erg", category: "hyrox" },
];

export function exerciseLabel(id: ExerciseId): string {
  return exercises.find((exercise) => exercise.id === id)?.label ?? id;
}
