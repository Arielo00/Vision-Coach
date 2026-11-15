/* ---------------------------------------------------------------------------
   Adaptadores de presentación.

   Funciones puras que traducen datos reales de la API a valores de pantalla.
   No inventan mediciones, no rellenan huecos y no cambian el significado del
   dato de origen. Cuando falta información, devuelven un estado explícito de
   "sin dato" en lugar de un valor por defecto que parezca una afirmación.
   --------------------------------------------------------------------------- */

import type {
  BiomechanicsError,
  BiomechanicsRepetition,
  BiomechanicsResult,
  CatalogCoveragePayload,
  HealthStatus,
  LLMModelsResponse,
  PipelineStatus,
  PoseFrame,
  PosePerson,
  ProgressSession,
  ReferenceInfo,
} from "../types";
import type {
  AvailabilityState,
  ConfidenceLevel,
  ConfidenceReading,
  DeclaredCapability,
  DetectionScoreReading,
  EquipmentCapabilityState,
  PhaseMarker,
  ProcessingLocality,
  RepetitionState,
  RetrievalState,
  SeriesPoint,
  SeverityPresentation,
  StrokePattern,
  SubsystemStatus,
  Tone,
} from "./uiTypes";
import { comparisonTorso } from "./poseFigure.ts";

/* --- Repeticiones --------------------------------------------------------- */

export function repetitionState(rep: BiomechanicsRepetition): RepetitionState {
  if (!rep.valid) {
    return {
      kind: "no_evaluable",
      label: "NO EVALUABLE",
      description:
        "Falta evidencia suficiente en la vista o en las articulaciones necesarias. Revisa los motivos de cada regla.",
      tone: "uncertain",
      pattern: "dashed",
      marker: "N/E",
    };
  }
  if (rep.correct) {
    return {
      kind: "correcta",
      label: "SIN HALLAZGOS",
      description: "Sin hallazgos en las reglas de pose evaluadas. No certifica seguridad física ni validez competitiva.",
      tone: "evaluable",
      pattern: "solid",
      marker: "OK",
    };
  }
  return {
    kind: "revisar",
    label: "REVISAR TÉCNICA",
    description: "Evaluada por el motor determinista con al menos un hallazgo.",
    tone: "technical",
    pattern: "solid",
    marker: "REV",
  };
}

/**
 * Conteo por repetición en tres cubos excluyentes.
 *
 * Coincide con el contrato del backend: las abstenciones quedan fuera del
 * denominador de calidad y nunca se cuentan como errores técnicos.
 */
export function repetitionCounts(repetitions: BiomechanicsRepetition[]): {
  total: number;
  correct: number;
  review: number;
  nonEvaluable: number;
} {
  return {
    total: repetitions.length,
    correct: repetitions.filter((rep) => rep.valid && rep.correct).length,
    review: repetitions.filter((rep) => rep.valid && !rep.correct).length,
    nonEvaluable: repetitions.filter((rep) => !rep.valid).length,
  };
}

/* --- Clasificación automática ---------------------------------------------- */

export interface ClassificationPresentation {
  label: string;
  tone: Tone;
  pattern: StrokePattern;
  caveat: string | null;
  resolved: boolean;
}

/**
 * Estado visual de la clasificación automática.
 *
 * Un ejercicio desconocido o una confianza baja son justo los casos en los que
 * la interfaz no debe verse resuelta, así que nunca se pinta como confirmada
 * por el mero hecho de que la fuente sea automática.
 */
export function classificationState(
  exercise: string,
  confidence: number,
): ClassificationPresentation {
  const percent = Math.round((Number.isFinite(confidence) ? confidence : 0) * 100);
  if (exercise === "unknown" || !exercise) {
    return {
      label: "SIN CLASIFICAR",
      tone: "unavailable",
      pattern: "dotted",
      caveat:
        "El clasificador no llegó a un ejercicio. Selecciónalo manualmente para que el motor de reglas pueda evaluar.",
      resolved: false,
    };
  }
  if (confidence >= 0.75) {
    return {
      label: `DETECCIÓN AUTOMÁTICA ${percent}%`,
      tone: "active",
      pattern: "solid",
      caveat: null,
      resolved: true,
    };
  }
  if (confidence >= 0.4) {
    return {
      label: `DETECCIÓN AUTOMÁTICA ${percent}% · CONFIANZA MEDIA`,
      tone: "uncertain",
      pattern: "dashed",
      caveat: "Verifica el ejercicio aplicado antes de interpretar los hallazgos.",
      resolved: false,
    };
  }
  return {
    label: `DETECCIÓN AUTOMÁTICA ${percent}% · EVIDENCIA INSUFICIENTE`,
    tone: "uncertain",
    pattern: "hatched",
    caveat:
      "La confianza es demasiado baja para dar por buena la clasificación. Corrige el ejercicio manualmente si no corresponde.",
    resolved: false,
  };
}

/* --- Selección de referencia ------------------------------------------------ */

export type ReferenceMatch =
  | "desconocido"
  | "vista_coincide"
  | "vista_no_verificada"
  | "vista_incompatible"
  | "sin_referencia"
  | "error_referencia";

/**
 * Elige la referencia externa compatible con la vista del trabajo.
 *
 * Que coincida el ejercicio no basta: comparar una ejecución lateral contra una
 * referencia frontal produce separaciones grandes que no son errores técnicos.
 * Si ambas vistas están etiquetadas y difieren, no se devuelve referencia.
 */
export function chooseReference<T extends { camera_view: string }>(
  references: T[],
  jobCameraView: string,
): { reference: T | null; match: ReferenceMatch } {
  if (!references.length) return { reference: null, match: "sin_referencia" };

  const exact = jobCameraView !== "unspecified"
    ? references.find((item) => item.camera_view === jobCameraView)
    : undefined;
  if (exact) return { reference: exact, match: "vista_coincide" };

  const loose = references.find(
    (item) => item.camera_view === "unspecified" || jobCameraView === "unspecified",
  );
  if (loose) return { reference: loose, match: "vista_no_verificada" };

  return { reference: null, match: "vista_incompatible" };
}

/** Anclas reales y ordenadas: no se inventa una fase que el motor no reportó. */
function comparisonAnchors(rep: BiomechanicsRepetition): Array<[string, number]> | null {
  if (!Number.isFinite(rep.start_frame) || !Number.isFinite(rep.end_frame) || rep.end_frame <= rep.start_frame) return null;
  const phases = Object.entries(rep.phase_frames ?? {}).filter(([key]) => key !== "start" && key !== "end");
  if (phases.some(([, frame]) => !Number.isFinite(frame) || frame < rep.start_frame || frame > rep.end_frame)) return null;
  const internal = phases.filter(([, frame]) => frame > rep.start_frame && frame < rep.end_frame).sort((a, b) => a[1] - b[1]);
  if (!internal.length) return null;
  return [["start", rep.start_frame], ...internal, ["end", rep.end_frame]];
}

type AlignmentPoint = [sessionFrame: number, referenceFrame: number];

function comparisonAlignment(current: BiomechanicsRepetition, reference: BiomechanicsRepetition): AlignmentPoint[] | null {
  const currentAnchors = comparisonAnchors(current);
  const referenceAnchors = comparisonAnchors(reference);
  if (!currentAnchors || !referenceAnchors) return null;
  const referenceValues = new Map(referenceAnchors);
  const shared = currentAnchors.flatMap(([name, frame]): AlignmentPoint[] => {
    const target = referenceValues.get(name);
    return target == null ? [] : [[frame, target]];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ordered: AlignmentPoint[] = [];
  for (const anchor of shared) {
    const previous = ordered.at(-1);
    if (previous && anchor[1] < previous[1]) return null;
    if (!previous || (anchor[0] > previous[0] && anchor[1] > previous[1])) ordered.push(anchor);
  }
  return ordered.length >= 3 ? ordered : null;
}

function frameFromAlignment(alignment: AlignmentPoint[], frameIndex: number): number | null {
  for (let index = 0; index < alignment.length - 1; index += 1) {
    const [start, referenceStart] = alignment[index];
    const [end, referenceEnd] = alignment[index + 1];
    if (frameIndex < start || frameIndex > end) continue;
    const progress = (frameIndex - start) / (end - start);
    return Math.round(referenceStart + progress * (referenceEnd - referenceStart));
  }
  return null;
}

/**
 * Exige una fase interior compartida. Dos nombres pueden señalar el mismo cuadro.
 */
export function mapComparisonFrame(
  current: BiomechanicsRepetition,
  reference: BiomechanicsRepetition,
  frameIndex: number,
): number | null {
  const alignment = comparisonAlignment(current, reference);
  return alignment && frameFromAlignment(alignment, frameIndex);
}

function firstFrameAtOrAfter(frames: PoseFrame[], frameIndex: number): number {
  let low = 0;
  let high = frames.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].frame_index < frameIndex) low = middle + 1;
    else high = middle;
  }
  return low;
}

function referenceFrameTolerance(frames: PoseFrame[]): number {
  let stride = Infinity;
  for (let index = 1; index < frames.length && stride > 1; index += 1) {
    const distance = frames[index].frame_index - frames[index - 1].frame_index;
    if (distance > 0) stride = Math.min(stride, distance);
  }
  return frames.length >= 3 && Number.isFinite(stride) ? Math.floor(stride / 2) : 0;
}

function poseNearFrame<T extends PoseFrame>(frames: T[], rep: BiomechanicsRepetition, frameIndex: number, tolerance: number): T["people"][number] | undefined {
  const index = firstFrameAtOrAfter(frames, frameIndex);
  const before = frames[index - 1];
  const after = frames[index];
  const beforeDistance = before && before.frame_index >= rep.start_frame ? frameIndex - before.frame_index : Infinity;
  const afterDistance = after && after.frame_index <= rep.end_frame ? after.frame_index - frameIndex : Infinity;
  if (Math.min(beforeDistance, afterDistance) > tolerance) return undefined;
  return (beforeDistance <= afterDistance ? before : after)?.people[0];
}

type ComparisonUnavailable = "pending" | "diagnostic_error" | "no_repetitions" | "not_evaluable" | "findings" | "phases" | "pose" | "view" | "reference_error" | "exercise";

export type ComparisonReference = {
  source: "session" | "external";
  repetition: BiomechanicsRepetition;
  frameTolerance: number;
  notice: null;
  reason: "available";
} | {
  source: null;
  repetition: null;
  notice: string;
  reason: ComparisonUnavailable;
};

export function comparisonPose<T extends PoseFrame>(
  current: BiomechanicsRepetition,
  comparison: Extract<ComparisonReference, { reason: "available" }>,
  frameIndex: number,
  referenceFrames: T[],
): T["people"][number] | undefined {
  const target = mapComparisonFrame(current, comparison.repetition, frameIndex);
  return target == null ? undefined : poseNearFrame(referenceFrames, comparison.repetition, target, comparison.frameTolerance);
}

/**
 * El aviso y el dibujo usan la misma selección. Una referencia es un recurso
 * para comparar; su ausencia nunca demuestra que la técnica sea incorrecta.
 */
export function comparisonReference({
  repetitions,
  sessionFrames,
  reference,
  referenceFrames,
  match,
  diagnosticStatus,
  updating = false,
  diagnosticError = false,
}: {
  repetitions: BiomechanicsRepetition[] | null;
  sessionFrames: PoseFrame[];
  reference: ReferenceInfo | null;
  referenceFrames: PoseFrame[];
  match: ReferenceMatch;
  diagnosticStatus?: BiomechanicsResult["status"];
  updating?: boolean;
  diagnosticError?: boolean;
}): ComparisonReference {
  const unavailable = (reason: ComparisonUnavailable, notice: string): ComparisonReference => ({ source: null, repetition: null, reason, notice });
  if (updating) return unavailable("pending", "Actualizando la evaluación y la referencia con la vista o el ejercicio elegidos…");
  if (diagnosticError) return unavailable("diagnostic_error", "No se pudo cargar la evaluación necesaria para elegir una referencia.");
  if (repetitions == null) return unavailable("pending", "Esperando el resultado de la evaluación…");
  if (diagnosticStatus === "unsupported_view") return unavailable("view", "El motor necesita otra vista de cámara para segmentar este ejercicio.");
  if (diagnosticStatus === "rules_not_available" || diagnosticStatus === "unsupported_or_uncertain") return unavailable("exercise", "La comparación requiere un ejercicio identificado con reglas de evaluación disponibles.");
  if (!repetitions.length) return unavailable("no_repetitions", "La comparación requiere una repetición completa detectada en esta sesión.");

  const eligible = (rep: BiomechanicsRepetition) => rep.valid && rep.correct;
  const sessionCandidates = repetitions.filter(eligible).sort((a, b) => b.confidence - a.confidence);
  const externalCandidates = (reference?.repetitions ?? []).filter(eligible);
  const session = ["session", sessionCandidates, sessionFrames] as const;
  const external = ["external", externalCandidates, referenceFrames] as const;
  const sources = match === "vista_coincide" ? [external, session]
    : match === "vista_no_verificada" ? [session, external] : [session];
  let hasCandidates = false;
  let hasAlignment = false;
  for (const [source, candidates, frames] of sources) {
    hasCandidates ||= candidates.length > 0;
    const frameTolerance = referenceFrameTolerance(frames);
    for (const candidate of candidates) {
      for (const current of repetitions) {
        const alignment = comparisonAlignment(current, candidate);
        if (!alignment) continue;
        hasAlignment = true;
        const start = firstFrameAtOrAfter(sessionFrames, current.start_frame);
        for (let index = start; index < sessionFrames.length; index += 1) {
          const frame = sessionFrames[index];
          if (frame.frame_index > current.end_frame) break;
          if (!comparisonTorso(frame.people[0])) continue;
          const target = frameFromAlignment(alignment, frame.frame_index);
          if (target != null && comparisonTorso(poseNearFrame(frames, candidate, target, frameTolerance))) {
            return { source, repetition: candidate, frameTolerance, notice: null, reason: "available" };
          }
        }
      }
    }
  }

  if (match === "desconocido") return unavailable("pending", "Buscando una referencia compatible para comparar…");
  if (hasAlignment) return unavailable("pose", "Faltan cuadros alineados con hombros y caderas visibles para dibujar la referencia.");
  if (hasCandidates) return unavailable("phases", "Faltan fases compartidas para alinear las repeticiones con una referencia.");
  const externalNotice = match === "vista_incompatible"
    ? " Las referencias externas disponibles pertenecen a otra vista de cámara."
    : match === "error_referencia"
      ? " No se pudo cargar la biblioteca de referencias."
      : " No hay una referencia externa utilizable para esta vista.";
  const counts = repetitionCounts(repetitions);
  if (counts.nonEvaluable === counts.total) return unavailable("not_evaluable", "La evidencia de esta sesión fue insuficiente para evaluar las repeticiones y elegir una referencia." + externalNotice);
  return unavailable(match === "vista_incompatible" ? "view" : match === "error_referencia" ? "reference_error" : "findings", "Las repeticiones evaluadas tienen hallazgos por revisar y no se usan como referencia." + externalNotice);
}

/**
 * Resuelve el detalle abierto de la biblioteca contra los resultados filtrados.
 *
 * Buscar en el catálogo completo deja visible el detalle de un ejercicio que el
 * filtro actual ya excluyó, contradiciendo al índice que el usuario ve.
 */
export function resolveLibrarySelection<T extends { id: string }>(
  filtered: T[],
  selectedId: string | null,
): { selected: T | null; filteredOut: boolean } {
  if (selectedId == null) return { selected: null, filteredOut: false };
  const selected = filtered.find((item) => item.id === selectedId) ?? null;
  return { selected, filteredOut: selected == null && filtered.length > 0 };
}

/* --- Confianza ------------------------------------------------------------ */

/** Umbrales heredados del motor de dibujo original. No se reinterpretan. */
export function confidenceLevel(value: number | null | undefined): ConfidenceLevel {
  if (value == null || !Number.isFinite(value)) return "sin_dato";
  if (value >= 0.75) return "alta";
  if (value >= 0.4) return "media";
  return "baja";
}

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  alta: "CONFIANZA ALTA",
  media: "CONFIANZA MEDIA",
  baja: "CONFIANZA BAJA",
  sin_dato: "SIN DATO",
};

export function confidenceReading(value: number | null | undefined): ConfidenceReading {
  const level = confidenceLevel(value);
  const numeric = level === "sin_dato" ? null : (value as number);
  return {
    level,
    value: numeric,
    display: numeric == null ? "—" : `${Math.round(numeric * 100)}%`,
    label: CONFIDENCE_LABEL[level],
    tone: level === "alta" ? "evaluable" : level === "media" ? "uncertain" : level === "baja" ? "uncertain" : "unavailable",
    pattern: level === "alta" ? "solid" : level === "media" ? "dashed" : level === "baja" ? "hatched" : "dotted",
  };
}

/**
 * `detection_confidence` es un score posprocesado de RF-DETR, no una
 * probabilidad calibrada.
 *
 * El significado del campo NO cambia al cruzar 1.0: un valor de 0.87 sigue
 * siendo un score, no un 87 % de probabilidad. Convertirlo a porcentaje solo
 * porque cae dentro de [0,1] inventa una calibración que el modelo no entrega,
 * así que siempre se muestra como score con su unidad declarada.
 */
export function detectionScore(person: PosePerson | undefined): DetectionScoreReading {
  if (!person || !Number.isFinite(person.detection_confidence)) {
    return { kind: "sin_dato", display: "—", note: null };
  }
  return {
    kind: "score",
    display: person.detection_confidence.toFixed(2),
    note: "Score posprocesado del detector, no una probabilidad calibrada.",
  };
}

/* --- Fases ---------------------------------------------------------------- */

/**
 * Diccionario de las claves que devuelven los motores actuales. Cualquier clave
 * nueva se humaniza y se marca como derivada, para no ocultar que la interfaz
 * no la conocía.
 */
const PHASE_LABELS: Record<string, string> = {
  start: "Inicio",
  end: "Fin",
  descent: "Descenso",
  bottom: "Punto bajo",
  ascent: "Ascenso",
  extension: "Extensión",
  backswing: "Backswing",
  hold_start: "Inicio del sostén",
  peak: "Punto máximo",
  hold_end: "Fin del sostén",
  support: "Soporte",
  dip: "Dip",
  drive: "Drive",
  lockout: "Bloqueo",
  pull: "Tirón",
  top: "Punto alto",
  kip_arch: "Arco (kip)",
  kip_hollow: "Hollow (kip)",
  push_away: "Empuje de salida",
  hang: "Suspensión",
};

export function humanizeKey(key: string): string {
  const spaced = key.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function phaseMarkers(rep: BiomechanicsRepetition): PhaseMarker[] {
  const span = Math.max(rep.end_frame - rep.start_frame, 1);
  return Object.entries(rep.phase_frames ?? {})
    .filter(([, frame]) => Number.isFinite(frame))
    .sort((a, b) => a[1] - b[1])
    .map(([key, frame]) => ({
      key,
      label: PHASE_LABELS[key] ?? humanizeKey(key),
      frame,
      position: Math.min(Math.max((frame - rep.start_frame) / span, 0), 1),
      derived: PHASE_LABELS[key] == null,
    }));
}

/**
 * Fase en la que cae un cuadro, derivada de las anclas de `phase_frames`.
 *
 * Las anclas son instantes, no intervalos, así que esto es una derivación y se
 * marca como tal. Devuelve `null` cuando el ejercicio no reportó fases o el
 * cuadro es anterior a la primera ancla.
 */
export function phaseAtFrame(
  rep: BiomechanicsRepetition,
  frame: number,
): PhaseMarker | null {
  const markers = phaseMarkers(rep);
  if (!markers.length) return null;
  let found: PhaseMarker | null = null;
  for (const marker of markers) {
    if (marker.frame <= frame) found = marker;
    else break;
  }
  return found;
}

/* --- Severidad ------------------------------------------------------------ */

export function severityPresentation(severity: BiomechanicsError["severity"]): SeverityPresentation {
  switch (severity) {
    case "riesgo":
      return { label: "REVISIÓN PRIORITARIA", tone: "risk", pattern: "solid", weight: 3 };
    case "media":
      return { label: "MEDIA", tone: "technical", pattern: "solid", weight: 2 };
    case "leve":
    default:
      return { label: "LEVE", tone: "uncertain", pattern: "dashed", weight: 1 };
  }
}

/** Ordena hallazgos por gravedad y luego por repetición, sin descartar ninguno. */
export function sortFindingsBySeverity<T extends { severity: BiomechanicsError["severity"] }>(
  findings: T[],
): T[] {
  return [...findings].sort(
    (a, b) => severityPresentation(b.severity).weight - severityPresentation(a.severity).weight,
  );
}

/* --- Procesamiento y privacidad -------------------------------------------- */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * El destino del video se deriva del host real configurado en `API_URL`.
 * No se afirma "100% local" como texto fijo: si alguien apunta el frontend a
 * un backend remoto, la interfaz debe decirlo.
 */
export function processingLocality(
  apiUrl: string,
  health: HealthStatus | null,
): ProcessingLocality {
  let host = apiUrl;
  let isLoopback = false;
  try {
    const parsed = new URL(apiUrl, window.location.origin);
    host = parsed.host || apiUrl;
    isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    host = apiUrl;
    isLoopback = false;
  }

  return {
    host,
    isLoopback,
    label: isLoopback ? "PROCESAMIENTO EN ESTE EQUIPO" : "BACKEND REMOTO CONFIGURADO",
    detail: isLoopback
      ? `El video se envía al backend local en ${host} y la visión por computadora se ejecuta ahí.`
      : `El video se envía a ${host}, que no es este equipo. Verifica que confías en ese destino.`,
    tone: isLoopback ? "evaluable" : "uncertain",
    storage: health?.storage ?? null,
    scope: health?.scope ?? null,
    gpuAvailable: health?.gpu_available ?? null,
  };
}

/* --- Recuperación (RAG) ---------------------------------------------------- */

export function retrievalState(
  status: BiomechanicsResult["knowledge_status"] | undefined,
): RetrievalState {
  if (!status) {
    return {
      kind: "no_disponible",
      label: "RECUPERACIÓN SIN REPORTAR",
      tone: "unavailable",
      provider: null,
      model: null,
      message: null,
      isFallback: false,
    };
  }
  const provider = status.embedding_provider ?? null;
  const model = status.embedding_model ?? null;
  const message = status.message ?? null;

  if (!status.available) {
    const notApplicable = status.retrieval_mode === "not_applicable";
    return {
      kind: notApplicable ? "no_aplica" : "no_disponible",
      label: notApplicable ? "SIN CONSULTA APLICABLE" : "RECUPERACIÓN NO DISPONIBLE",
      tone: "unavailable",
      provider,
      model,
      message,
      isFallback: status.fallback,
    };
  }
  if (status.retrieval_mode === "mixed") {
    return {
      kind: "mixto",
      label: "RECUPERACIÓN COMBINADA",
      tone: "uncertain",
      provider,
      model,
      message,
      isFallback: true,
    };
  }
  if (status.retrieval_mode === "lexical") {
    return {
      kind: "lexico_respaldo",
      label: "RESPALDO LÉXICO LOCAL",
      tone: "uncertain",
      provider,
      model,
      message,
      isFallback: true,
    };
  }
  if (status.fallback) {
    return {
      kind: "respaldo_local",
      label: "RESPALDO VECTORIAL LOCAL",
      tone: "uncertain",
      provider,
      model,
      message,
      isFallback: true,
    };
  }
  return {
    kind: "vectorial",
    label: "RECUPERACIÓN VECTORIAL",
    tone: "evaluable",
    provider,
    model,
    message,
    isFallback: false,
  };
}

/* --- Evidencia de equipo --------------------------------------------------- */

const CAPABILITY_LABELS: Record<string, { label: string; detail: string }> = {
  coco_bootstrap_ball_only: {
    label: "SOLO BALÓN · BOOTSTRAP COCO",
    detail:
      "El detector actual es un arranque con pesos COCO que únicamente reconoce un candidato de balón. Barra, blanco, cajón, anillas, trineo y demás implementos requieren el checkpoint propio, que todavía no existe.",
  },
};

export function equipmentCapability(frame: PoseFrame | null): EquipmentCapabilityState {
  const capability = frame?.equipment_capability ?? null;
  const model = frame?.equipment_model ?? null;
  if (!capability) {
    return {
      model,
      capability: null,
      label: "CAPACIDAD NO DECLARADA",
      detail:
        "El artefacto de pose no declara qué implementos puede reconocer el detector. No se asume ninguna cobertura.",
      tone: "unavailable",
      declared: false,
    };
  }
  const known = CAPABILITY_LABELS[capability];
  return {
    model,
    capability,
    label: known?.label ?? humanizeKey(capability).toUpperCase(),
    detail:
      known?.detail ??
      "El detector declara esta capacidad. La interfaz no infiere cobertura más allá de lo declarado.",
    tone: "uncertain",
    declared: true,
  };
}

/* --- Proveedores de generación --------------------------------------------- */

export function backendAvailability(
  online: boolean | null,
  health: HealthStatus | null,
): AvailabilityState {
  if (online == null) {
    return { kind: "desconocido", label: "CONSULTANDO", tone: "unavailable", detail: null };
  }
  if (!online) {
    return {
      kind: "no_disponible",
      label: "SIN CONEXIÓN",
      tone: "uncertain",
      detail: "El backend local no respondió.",
    };
  }
  return {
    kind: "disponible",
    label: "CONECTADO",
    tone: "active",
    detail: health ? `estado ${health.status} · alcance ${health.scope}` : null,
  };
}

/**
 * Estado real de los proveedores de generación de texto.
 * Nunca se afirma "OLLAMA ONLINE" ni "GOOGLE CONNECTED" sin respuesta previa.
 */
export function providerAvailability(
  models: LLMModelsResponse | null,
  provider: "ollama" | "google",
): AvailabilityState {
  if (!models) {
    return { kind: "desconocido", label: "CONSULTANDO", tone: "unavailable", detail: null };
  }
  const items = models.items.filter((item) => item.provider === provider && item.kind === "chat");
  if (provider === "google") {
    if (!models.google_configured) {
      return {
        kind: "requiere_configuracion",
        label: "SIN CREDENCIAL",
        tone: "unavailable",
        detail: "No hay clave de Google configurada en este equipo.",
      };
    }
    /* El backend no contacta a Google al listar modelos: solo comprueba que
       exista la clave. Decir "disponible" afirmaría una comprobación que no
       ocurrió, así que se nombra exactamente lo que se sabe. */
    return {
      kind: "requiere_consentimiento",
      label: "CREDENCIAL CONFIGURADA",
      tone: "uncertain",
      detail: `${items.length} modelo(s) de texto declarados. No se contacta a Google hasta que confirmes el envío, así que su disponibilidad real no está comprobada.`,
    };
  }
  if (!items.length) {
    return {
      kind: "no_disponible",
      label: "NO DISPONIBLE",
      tone: "uncertain",
      detail: models.message ?? "El servicio local de Ollama no respondió.",
    };
  }
  return {
    kind: "disponible",
    label: "DISPONIBLE",
    tone: "active",
    detail: `${items.length} modelo(s) de texto en este equipo.`,
  };
}

/* --- Capacidades declaradas del pipeline ------------------------------------ */

const DECLARED_LABELS: Record<string, { label: string; partial: boolean }> = {
  implemented: { label: "IMPLEMENTADO", partial: false },
  implemented_bootstrap_awaiting_custom: { label: "BOOTSTRAP · FALTA CHECKPOINT PROPIO", partial: true },
  implemented_with_limitations: { label: "IMPLEMENTADO CON LÍMITES", partial: true },
  implemented_partial: { label: "IMPLEMENTADO PARCIAL", partial: true },
  implemented_alternative: { label: "IMPLEMENTADO · VÍA ALTERNATIVA", partial: true },
  implemented_local_capture: { label: "CAPTURA LOCAL", partial: false },
  partial: { label: "PARCIAL", partial: true },
  partial_catalog: { label: "CATÁLOGO PARCIAL", partial: true },
};

const SUBSYSTEM_GROUPS: Record<string, SubsystemStatus["group"]> = {
  video_input: "captura",
  person_pose: "vision",
  equipment_detection: "vision",
  tracking_smoothing: "vision",
  angles_trajectories: "reglas",
  exercise_classifier: "reglas",
  phases_rules: "reglas",
  reference_comparison: "reglas",
  rag: "recuperacion",
  vector_store: "recuperacion",
  llm_provider: "generacion",
  hard_examples: "captura",
};

export function declaredCapability(raw: string): DeclaredCapability {
  const known = DECLARED_LABELS[raw];
  return {
    raw,
    label: known?.label ?? humanizeKey(raw).toUpperCase(),
    tone: known ? (known.partial ? "uncertain" : "evaluable") : "unavailable",
    partial: known?.partial ?? true,
  };
}

export function subsystemsFromPipeline(status: PipelineStatus | null): SubsystemStatus[] {
  if (!status) return [];
  return status.blocks.map((block) => ({
    id: block.id,
    label: block.label,
    group: SUBSYSTEM_GROUPS[block.id] ?? "captura",
    declared: declaredCapability(block.status),
    limitation: block.limitation?.trim() ? block.limitation : null,
    evidence: block.evidence ?? [],
  }));
}

export const SUBSYSTEM_GROUP_LABELS: Record<SubsystemStatus["group"], string> = {
  captura: "Captura y datos",
  vision: "Visión por computadora",
  reglas: "Motor determinista",
  recuperacion: "Recuperación documental",
  generacion: "Generación de texto",
};

/* --- Cobertura del catálogo ------------------------------------------------ */

export interface ExerciseCoverageState {
  maturity: string | null;
  label: string | null;
  limitingFactor: string | null;
  hasEngine: boolean;
  tone: "evaluable" | "uncertain" | "unavailable";
}

const ENGINE_MATURITIES = new Set([
  "active_needs_calibration",
  "active_experimental_evidence_needed",
]);

/**
 * Sustituye a los conjuntos que antes estaban escritos a mano en la interfaz.
 * Si el backend no reporta el ejercicio, se devuelve un estado sin afirmación.
 */
export function exerciseCoverage(
  coverage: CatalogCoveragePayload | null,
  exerciseId: string,
): ExerciseCoverageState {
  const item = coverage?.exercises?.[exerciseId];
  if (!coverage || !item) {
    return {
      maturity: null,
      label: null,
      limitingFactor: null,
      hasEngine: false,
      tone: "unavailable",
    };
  }
  const hasEngine = ENGINE_MATURITIES.has(item.maturity);
  return {
    maturity: item.maturity,
    label: coverage.maturity_levels?.[item.maturity] ?? humanizeKey(item.maturity),
    limitingFactor: item.limiting_factor?.trim() ? item.limiting_factor : null,
    hasEngine,
    tone: hasEngine ? "evaluable" : item.maturity === "automatic" ? "unavailable" : "uncertain",
  };
}

/* --- Series de progreso ---------------------------------------------------- */

/**
 * Construye la serie preservando los huecos: una sesión sin medición produce
 * `value: null` y se dibuja como interrupción, no como cero ni como línea
 * continua que sugiera continuidad inexistente.
 */
export function buildSeries(
  sessions: ProgressSession[],
  pick: (session: ProgressSession) => number | null,
  format: (value: number) => string,
  dateLabel: (iso: string) => string,
): SeriesPoint[] {
  return sessions.map((session) => {
    const value = pick(session);
    return {
      label: dateLabel(session.date),
      value: value == null || !Number.isFinite(value) ? null : value,
      jobId: session.job_id,
      readout: value == null || !Number.isFinite(value) ? "sin medición" : format(value),
    };
  });
}

/** Cuenta cuántos puntos tienen medición real. */
export function measuredCount(points: SeriesPoint[]): number {
  return points.filter((point) => point.value != null).length;
}
