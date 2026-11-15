/* ---------------------------------------------------------------------------
   Tipos exclusivos de presentación.

   Estos tipos NO sustituyen ni reinterpretan los contratos de `src/types.ts`.
   Solo describen cómo se dibuja en pantalla un dato que ya vino de la API.

   Regla del módulo: toda unión de estado incluye una variante explícita para
   "no sabemos". Nunca se colapsa la ausencia de dato en un valor por defecto
   que parezca una afirmación.
   --------------------------------------------------------------------------- */

import type { PoseFrame as PoseFrameContract, PosePerson as PosePersonContract } from "../types";

/** Tono visual. Se traduce a color + patrón, nunca solo a color. */
export type Tone =
  | "evaluable"
  | "reference"
  | "uncertain"
  | "technical"
  | "risk"
  | "unavailable"
  | "active"
  | "neutral";

/** Patrón de trazo, para distinguir estados sin depender del color. */
export type StrokePattern = "solid" | "dashed" | "dotted" | "hatched";

/* --- Repeticiones --------------------------------------------------------- */

/**
 * El motor devuelve dos booleanos independientes:
 *   valid   = la repetición pudo evaluarse (hubo confianza suficiente)
 *   correct = pudo evaluarse Y no se encontraron errores
 * Son tres estados, no dos. Colapsarlos pinta una abstención como si fuera
 * un error de técnica, que es exactamente lo que hay que evitar.
 */
export type RepetitionStateKind = "correcta" | "revisar" | "no_evaluable";

export interface RepetitionState {
  kind: RepetitionStateKind;
  /** Etiqueta visible, siempre presente. */
  label: string;
  /** Texto largo para lectores de pantalla y para el detalle. */
  description: string;
  tone: Tone;
  pattern: StrokePattern;
  /** Marcador técnico corto, monoespaciado. */
  marker: string;
}

/* --- Confianza ------------------------------------------------------------ */

export type ConfidenceLevel = "alta" | "media" | "baja" | "sin_dato";

export interface ConfidenceReading {
  level: ConfidenceLevel;
  /** Valor crudo 0..1 tal como llegó de la API. `null` si no hay dato. */
  value: number | null;
  /** Porcentaje ya redondeado, o "—" cuando no hay dato. */
  display: string;
  label: string;
  tone: Tone;
  pattern: StrokePattern;
}

/**
 * `detection_confidence` de RF-DETR no siempre es una probabilidad: en el
 * modelo actual puede superar 1.0 porque es un score posprocesado. Mostrarlo
 * como porcentaje sería una afirmación falsa.
 */
export interface DetectionScoreReading {
  kind: "probabilidad" | "score" | "sin_dato";
  display: string;
  /** Aclaración de unidades para el usuario. */
  note: string | null;
}

/* --- Fases ---------------------------------------------------------------- */

/**
 * Las fases son específicas por ejercicio: el motor de push press devuelve
 * dip/bottom/drive/lockout, el de kettlebell backswing/extension, el de L-sit
 * hold_start/peak/hold_end. No existe un modelo fijo descenso/fondo/ascenso.
 */
export interface PhaseMarker {
  /** Clave cruda tal como la devolvió `phase_frames`. */
  key: string;
  /** Etiqueta en español, o la clave humanizada si es desconocida. */
  label: string;
  frame: number;
  /** Posición 0..1 dentro de la repetición, para ubicarla en la línea. */
  position: number;
  /** `true` cuando la clave no está en el diccionario y se humanizó. */
  derived: boolean;
}

/* --- Pose para render ------------------------------------------------------ */

/**
 * Persona con una pista extra usada ÚNICAMENTE por el trazo del canvas.
 *
 * `keypoint_confidence` conserva el valor crudo que entregó la API y es el que
 * se muestra en pantalla. `render_confidence` guarda la versión suavizada en el
 * tiempo, que solo sirve para que el esqueleto no parpadee. Separarlas evita
 * que un filtro de dibujo se presente como si fuera la medición del modelo.
 */
export interface RenderPosePerson extends PosePersonContract {
  render_confidence?: Array<number | null>;
}

export interface RenderPoseFrame extends PoseFrameContract {
  people: RenderPosePerson[];
}

/* --- Estado del sistema ---------------------------------------------------- */

/**
 * Disponibilidad en vivo. `desconocido` es un estado de primera clase: se usa
 * mientras no haya llegado la respuesta, y nunca se sustituye por `disponible`.
 */
export type AvailabilityKind =
  | "disponible"
  | "no_disponible"
  | "requiere_consentimiento"
  | "requiere_configuracion"
  | "desconocido";

export interface AvailabilityState {
  kind: AvailabilityKind;
  label: string;
  tone: Tone;
  /** Detalle real devuelto por el backend, si existe. Nunca inventado. */
  detail: string | null;
}

/**
 * Capacidad DECLARADA por el manifiesto del backend (`/api/pipeline/status`).
 *
 * No es disponibilidad en vivo: es un documento curado y versionado que dice
 * qué está construido y con qué límite. Se presenta como tal y jamás se mezcla
 * con los indicadores que sí se sondean en tiempo real.
 */
export interface DeclaredCapability {
  /** Cadena literal del backend, p. ej. "implemented_bootstrap_awaiting_custom". */
  raw: string;
  label: string;
  tone: Tone;
  /** `true` cuando el estado declara trabajo pendiente o alcance parcial. */
  partial: boolean;
}

/** De dónde sale cada pieza del sistema. Se muestran separadas, nunca como "la IA". */
export interface SubsystemStatus {
  id: string;
  label: string;
  /** Categoría a la que pertenece, para agrupar sin mezclar responsabilidades. */
  group: "vision" | "reglas" | "recuperacion" | "generacion" | "captura";
  declared: DeclaredCapability;
  /** Limitación declarada por el backend. Nunca redactada por la interfaz. */
  limitation: string | null;
  evidence: string[];
}

/* --- Procesamiento y privacidad -------------------------------------------- */

export interface ProcessingLocality {
  /** Host real derivado de `API_URL`, no una afirmación fija. */
  host: string;
  isLoopback: boolean;
  label: string;
  detail: string;
  tone: Tone;
  /** Estado del backend, solo cuando `getHealth()` respondió. */
  storage: string | null;
  scope: string | null;
  gpuAvailable: boolean | null;
}

/* --- Recuperación (RAG) ---------------------------------------------------- */

export interface RetrievalState {
  kind: "vectorial" | "mixto" | "lexico_respaldo" | "respaldo_local" | "no_aplica" | "no_disponible";
  label: string;
  tone: Tone;
  provider: string | null;
  model: string | null;
  /** Mensaje literal del backend; no se reescribe. */
  message: string | null;
  isFallback: boolean;
}

/* --- Evidencia de equipo --------------------------------------------------- */

/**
 * El detector de equipo actual es un bootstrap COCO que solo reconoce balón.
 * La frontera se muestra tal como la declara el artefacto, para no sugerir
 * que ya valida barras, blancos, cajones, anillas o trineos.
 */
export interface EquipmentCapabilityState {
  model: string | null;
  capability: string | null;
  label: string;
  detail: string;
  tone: Tone;
  /** `true` solo si el artefacto declara una capacidad reconocida. */
  declared: boolean;
}

/* --- Severidad ------------------------------------------------------------- */

export interface SeverityPresentation {
  label: string;
  tone: Tone;
  pattern: StrokePattern;
  /** Orden para priorizar hallazgos. Mayor = más grave. */
  weight: number;
}

/* --- Series de progreso ---------------------------------------------------- */

/**
 * Un punto de la serie longitudinal. `value: null` significa medición ausente
 * y se dibuja como hueco explícito, nunca como cero.
 */
export interface SeriesPoint {
  label: string;
  value: number | null;
  jobId: string;
  /** Texto accesible del punto, con unidad. */
  readout: string;
}

export interface SeriesGap {
  from: number;
  to: number;
}
