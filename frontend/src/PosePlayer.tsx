/* ---------------------------------------------------------------------------
   02 · Banco de análisis.

   El visor administra la reproducción, el dibujo y la evaluación de la sesión.
   El video y el canvas viven en un componente memoizado. Las mediciones usan
   la pose original y el trazo puede usar coordenadas y confianza suavizadas.
   --------------------------------------------------------------------------- */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  API_URL,
  changeJobCameraView,
  changeJobExercise,
  generateCoaching,
  getBiomechanics,
  getLLMModels,
  getPoseFrames,
  getReferenceFrames,
  getReferences,
  markHardExample,
} from "./api";
import ExercisePicker from "./ExercisePicker";
import { exerciseLabel } from "./exerciseCatalog";
import type {
  BiomechanicsRepetition,
  BiomechanicsResult,
  CameraView,
  CatalogCoveragePayload,
  CoachingResult,
  EquipmentDetection,
  ExerciseId,
  LLMModelsResponse,
  PoseFrame,
  PosePerson,
  ReferenceInfo,
  VideoJob,
} from "./types";
import ChronoPlate from "./ui/ChronoPlate";
import CoachingPanel from "./ui/CoachingPanel";
import DiagnosticRail from "./ui/DiagnosticRail";
import LiveReadouts, { type AngleRow, type JointRow } from "./ui/LiveReadouts";
import MotionScore from "./ui/MotionScore";
import SessionReading from "./ui/SessionReading";
import { TechnicalLabel } from "./ui/StatusAtoms";
import { TransportClock, TransportControls } from "./ui/Transport";
import VideoCanvasShell from "./ui/VideoCanvasShell";
import { comparisonTorso, drawConfidence, drawableJoint, MIN_DRAW_CONFIDENCE } from "./ui/poseFigure";
import {
  chooseReference,
  comparisonPose,
  comparisonReference,
  equipmentCapability,
  phaseAtFrame,
  type ReferenceMatch,
} from "./ui/presentationAdapters";
import { computeSignals, planLanes, thresholdsFromRuleConfig, type SignalKey } from "./ui/signals";
import { athleteBounds, computeCrop } from "./ui/stageFit";
import { jointLabel } from "./ui/metricLabels";
import type { RenderPoseFrame, RenderPosePerson } from "./ui/uiTypes";

const SKELETON_EDGES: Array<[number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

const IMPORTANT_JOINTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const NO_REPETITIONS: BiomechanicsRepetition[] = [];
const INSTANT_PHASES = new Set(["bottom", "peak", "top", "lockout", "catch", "release"]);
const JOINT_INDEX: Record<string, number> = {
  left_shoulder: 5, right_shoulder: 6, left_elbow: 7, right_elbow: 8,
  left_wrist: 9, right_wrist: 10, left_hip: 11, right_hip: 12,
  left_knee: 13, right_knee: 14, left_ankle: 15, right_ankle: 16,
};

/* --- Paleta del canvas -----------------------------------------------------
   Alineada al sistema semántico. El rojo solo aparece en hallazgos de riesgo. */
const CANVAS_COLORS = {
  poseHigh: "#2be3ce",
  poseMedium: "#ffb347",
  poseLow: "#6f7672",
  reference: "#4ac8ff",
  /* Ámbar, no rojo: una separación 2D respecto a la referencia es evidencia
     incierta, no un hallazgo confirmado por las reglas. El rojo queda reservado
     a la severidad "riesgo" del motor determinista. */
  referenceDeviation: "#ffb347",
  outline: "rgba(7, 9, 9, 0.9)",
  equipment: "#4ac8ff",
  equipmentTarget: "#c9a6ff",
  severity: {
    riesgo: "#ff4b45",
    media: "#ff8b3d",
    leve: "#ffb347",
  } as Record<string, string>,
};

type SeverityKey = "leve" | "media" | "riesgo";
const SEVERITY_WEIGHT: Record<SeverityKey, number> = { leve: 1, media: 2, riesgo: 3 };

const CAMERA_VIEW_LABELS: Record<string, string> = {
  side: "lateral",
  front: "frontal",
  three_quarter: "tres cuartos",
  unspecified: "sin especificar",
};

function cameraViewLabel(view: string): string {
  return CAMERA_VIEW_LABELS[view] ?? view;
}


function closestFrame(frames: PoseFrame[], time: number): PoseFrame | null {
  if (!frames.length) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].timestamp_seconds < time) low = middle + 1;
    else high = middle;
  }
  if (low > 0) {
    const before = frames[low - 1];
    const after = frames[low];
    return time - before.timestamp_seconds <= after.timestamp_seconds - time ? before : after;
  }
  return frames[low];
}

function activeRepetition(result: BiomechanicsResult, frameIndex: number): BiomechanicsRepetition | null {
  return result.repetitions.find((rep) => frameIndex >= rep.start_frame && frameIndex <= rep.end_frame) ?? null;
}

function alignReference(reference: RenderPosePerson, referenceTorso: NonNullable<ReturnType<typeof comparisonTorso>>, currentTorso: NonNullable<ReturnType<typeof comparisonTorso>>): Array<[number, number] | null> {
  const scale = currentTorso.length / referenceTorso.length;
  return reference.xy.map((_, index) => {
    const point = drawableJoint(reference, index);
    return point && [
      currentTorso.hip[0] + (point[0] - referenceTorso.hip[0]) * scale,
      currentTorso.hip[1] + (point[1] - referenceTorso.hip[1]) * scale,
    ];
  });
}

/** Mismos umbrales de siempre (0.75 / 0.4); solo cambia el color asignado. */
function confidenceColor(confidence: number): string {
  if (confidence >= 0.75) return CANVAS_COLORS.poseHigh;
  if (confidence >= 0.4) return CANVAS_COLORS.poseMedium;
  return CANVAS_COLORS.poseLow;
}

/**
 * Suavizado temporal.
 *
 * Las coordenadas se filtran para que el trazo no vibre. La confianza se deja
 * exactamente como llegó de la API y su versión suavizada se guarda aparte,
 * porque el número que ve el usuario debe ser el del modelo.
 */
function smoothPoseFrames(frames: PoseFrame[]): RenderPoseFrame[] {
  const previousPoints: Array<[number, number] | null> = Array.from({ length: 17 }, () => null);
  const previousConfidence: Array<number | null> = Array.from({ length: 17 }, () => null);
  const alpha = 0.58;
  return frames.map((frame) => {
    const primary = frame.people[0];
    if (!primary) return frame as RenderPoseFrame;
    const xy = primary.xy.map((point, index) => {
      const confidence = primary.keypoint_confidence[index] ?? 0;
      if (point[0] == null || point[1] == null || confidence < MIN_DRAW_CONFIDENCE) return point;
      const current: [number, number] = [point[0], point[1]];
      const previous = previousPoints[index];
      const smoothed: [number, number] = previous
        ? [alpha * current[0] + (1 - alpha) * previous[0], alpha * current[1] + (1 - alpha) * previous[1]]
        : current;
      previousPoints[index] = smoothed;
      return smoothed;
    });
    const renderConfidence = primary.keypoint_confidence.map((value, index) => {
      if (value == null) return value;
      const previous = previousConfidence[index];
      const smoothed = previous == null ? value : alpha * value + (1 - alpha) * previous;
      previousConfidence[index] = smoothed;
      return smoothed;
    });
    const person: RenderPosePerson = {
      ...primary,
      xy,
      render_confidence: renderConfidence,
    };
    return { ...frame, people: [person, ...frame.people.slice(1)] };
  });
}

/** Media de la confianza CRUDA de las articulaciones relevantes. */
function meanConfidence(person: PosePerson | undefined): number | null {
  if (!person) return null;
  const values = IMPORTANT_JOINTS
    .map((index) => person.keypoint_confidence[index])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function angle(a?: [number | null, number | null], b?: [number | null, number | null], c?: [number | null, number | null]): number | null {
  if (!a || !b || !c || [...a, ...b, ...c].some((value) => value == null)) return null;
  const bax = Number(a[0]) - Number(b[0]);
  const bay = Number(a[1]) - Number(b[1]);
  const bcx = Number(c[0]) - Number(b[0]);
  const bcy = Number(c[1]) - Number(b[1]);
  const denominator = Math.hypot(bax, bay) * Math.hypot(bcx, bcy);
  if (!denominator) return null;
  const cosine = Math.max(-1, Math.min(1, (bax * bcx + bay * bcy) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

/**
 * Índice de equipo por `track_id`.
 *
 * Sustituye el recorrido completo del arreglo de cuadros que hacía el bucle de
 * dibujo en cada tick. Con la paginación nueva ese arreglo puede tener miles de
 * entradas. La salida conserva el mismo orden ascendente por cuadro.
 */
type EquipmentTrackIndex = Map<string, Array<{ frameIndex: number; detection: EquipmentDetection }>>;

function buildEquipmentIndex(frames: PoseFrame[]): EquipmentTrackIndex {
  const index: EquipmentTrackIndex = new Map();
  frames.forEach((frame) => {
    frame.equipment?.forEach((detection) => {
      const bucket = index.get(detection.track_id);
      const entry = { frameIndex: frame.frame_index, detection };
      if (bucket) bucket.push(entry);
      else index.set(detection.track_id, [entry]);
    });
  });
  return index;
}

interface PosePlayerProps {
  job: VideoJob;
  coverage: CatalogCoveragePayload | null;
  active: boolean;
  onClose: () => void;
  /**
   * Se invoca cuando el <video> y el <canvas> ya están en el DOM.
   *
   * El contenedor lo necesita para animar el marco desde la tarjeta que abrió
   * el análisis: al pulsar todavía no existe, porque primero hay que traer los
   * keypoints.
   */
  onStageReady?: () => void;
  /** El trabajo cambió en el backend (por ejemplo, su vista de cámara). */
  onJobUpdated?: (job: VideoJob) => void;
}

interface LoadedReference {
  exercise: string;
  view: CameraView;
  info: ReferenceInfo | null;
  frames: RenderPoseFrame[];
  match: ReferenceMatch;
}

type DiagnosticRetry = { view: CameraView } | { exercise: ExerciseId };

export default function PosePlayer({ job, coverage, active, onClose, onStageReady, onJobUpdated }: PosePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesRef = useRef<RenderPoseFrame[]>([]);
  const equipmentIndexRef = useRef<EquipmentTrackIndex>(new Map());
  const highlightRef = useRef<Map<number, SeverityKey>>(new Map());
  const lastFrameIndex = useRef<number>(-1);
  const diagnosticsRequest = useRef(0);
  const updatingDiagnostics = useRef(false);

  const [frames, setFrames] = useState<RenderPoseFrame[]>([]);
  /* Keypoints tal como llegaron de la API: las señales se calculan con ellos,
     no con las coordenadas suavizadas que solo existen para el trazo. */
  const [rawFrames, setRawFrames] = useState<PoseFrame[]>([]);
  const [currentFrame, setCurrentFrame] = useState<RenderPoseFrame | null>(null);
  /* Apagada por omisión: la covarianza del modelo no está calibrada como error
     de medición y sus elipses hacen ver inestable una pose que no lo es. */
  const [showUncertainty, setShowUncertainty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<BiomechanicsResult | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [changingExercise, setChangingExercise] = useState(false);
  const [changingView, setChangingView] = useState(false);
  const [retryDiagnostics, setRetryDiagnostics] = useState<DiagnosticRetry | null>(null);
  const [showReference, setShowReference] = useState(false);
  const [loadedReference, setLoadedReference] = useState<LoadedReference | null>(null);
  const [llmModels, setLlmModels] = useState<LLMModelsResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [allowRemote, setAllowRemote] = useState(false);
  const [allowRemoteEmbeddings, setAllowRemoteEmbeddings] = useState(false);
  const [coaching, setCoaching] = useState<CoachingResult | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [coachingError, setCoachingError] = useState<string | null>(null);
  const [correctionType, setCorrectionType] = useState("keypoints");
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [selectedRepetition, setSelectedRepetition] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState<string>("");

  useEffect(() => {
    let active = true;
    const request = ++diagnosticsRequest.current;
    setLoading(true);
    setError(null);
    setFrames([]);
    setRawFrames([]);
    setCurrentFrame(null);
    setDiagnostics(null);
    setDiagnosticsError(null);
    setChangingExercise(false);
    setChangingView(false);
    setRetryDiagnostics(null);
    setCoaching(null);
    setCoachingLoading(false);
    setCoachingError(null);
    setLoadedReference(null);
    setSelectedRepetition(null);
    setShowReference(false);
    setAllowRemote(false);
    setAllowRemoteEmbeddings(false);
    framesRef.current = [];
    updatingDiagnostics.current = false;
    equipmentIndexRef.current = new Map();
    highlightRef.current = new Map();
    lastFrameIndex.current = -1;
    void getPoseFrames(job.id)
      .then((items) => {
        if (!active) return;
        const smoothed = smoothPoseFrames(items);
        framesRef.current = smoothed;
        equipmentIndexRef.current = buildEquipmentIndex(smoothed);
        setFrames(smoothed);
        setRawFrames(items);
        setAnnouncement(`Pose cargada: ${smoothed.length} cuadros.`);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No fue posible cargar la pose.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void getBiomechanics(job.id)
      .then((result) => {
        if (!active || request !== diagnosticsRequest.current) return;
        setDiagnostics(result);
        const abstained = result.repetitions.filter((rep) => !rep.valid).length;
        setAnnouncement(
          abstained > 0
            ? `Diagnóstico listo. ${abstained} repetición(es) sin confianza suficiente para evaluarse.`
            : `Diagnóstico listo: ${result.summary.repetitions_detected} repetición(es).`,
        );
      })
      .catch((reason) => {
        if (active && request === diagnosticsRequest.current) setDiagnosticsError(reason instanceof Error ? reason.message : "No fue posible calcular el diagnóstico.");
      });
    return () => { active = false; diagnosticsRequest.current += 1; };
  }, [job.id]);

  useEffect(() => {
    let active = true;
    void getLLMModels().then((result) => {
      if (!active) return;
      setLlmModels(result);
      const chatModels = result.items.filter((item) => item.kind === "chat" && item.available);
      setSelectedModel(chatModels.find((item) => item.id === result.default_model)?.id ?? chatModels[0]?.id ?? result.default_model);
    }).catch(() => {
      if (active) setLlmModels({ available: false, provider: "ollama", default_model: "qwen3:4b", items: [] });
    });
    return () => { active = false; };
  }, [job.id]);

  const resolution = diagnostics?.camera_view_resolution;
  const effectiveView = resolution?.effective_view ?? job.camera_view;
  const referenceExercise = diagnostics?.repetitions.length ? diagnostics.exercise : null;

  /* Una respuesta solo sirve para el ejercicio y la vista que la solicitaron. */
  useEffect(() => {
    if (!referenceExercise) return;
    let active = true;
    const request = { exercise: referenceExercise, view: effectiveView };
    void getReferences(referenceExercise).then(async (references) => {
      if (!active) return;
      const { reference: chosen, match } = chooseReference(references, effectiveView);
      if (!chosen) {
        setLoadedReference({ ...request, match, info: null, frames: [] });
        return;
      }
      const payload = await getReferenceFrames(chosen.id);
      if (!active) return;
      const loaded = chooseReference([payload.reference], effectiveView);
      if (payload.reference.exercise !== referenceExercise) throw new Error("Cambió el ejercicio de la referencia.");
      setLoadedReference({
        ...request,
        match: loaded.match,
        info: loaded.reference,
        frames: loaded.reference ? smoothPoseFrames(payload.items) : [],
      });
    }).catch(() => {
      if (active) setLoadedReference({ ...request, match: "error_referencia", info: null, frames: [] });
    });
    return () => { active = false; };
  }, [referenceExercise, effectiveView]);

  const currentReference = loadedReference?.exercise === referenceExercise && loadedReference.view === effectiveView ? loadedReference : null;
  const referenceMatch = currentReference?.match === "vista_coincide" && resolution?.source === "estimated"
    ? "vista_no_verificada" : currentReference?.match ?? "desconocido";

  const comparison = useMemo(() => comparisonReference({
    repetitions: diagnostics?.repetitions ?? null,
    diagnosticStatus: diagnostics?.status,
    sessionFrames: frames,
    reference: currentReference?.info ?? null,
    referenceFrames: currentReference?.frames ?? [],
    match: referenceMatch,
    updating: changingExercise || changingView,
    diagnosticError: diagnosticsError != null,
  }), [diagnostics, frames, currentReference, referenceMatch, changingExercise, changingView, diagnosticsError]);

  /* Resaltado por articulación. Mismo conjunto de articulaciones que antes;
     ahora se conserva la severidad máxima para elegir el color del trazo. */
  useEffect(() => {
    const frameIndex = currentFrame?.frame_index;
    const joints = new Map<number, SeverityKey>();
    if (frameIndex != null && diagnostics) {
      diagnostics.repetitions.flatMap((rep) => rep.errors).forEach((issue) => {
        if (issue.frames.some((value) => value === frameIndex)) {
          const severity = (issue.severity as SeverityKey) ?? "leve";
          issue.joints.forEach((name) => {
            const index = JOINT_INDEX[name];
            if (index == null) return;
            const existing = joints.get(index);
            if (!existing || SEVERITY_WEIGHT[severity] > SEVERITY_WEIGHT[existing]) {
              joints.set(index, severity);
            }
          });
        }
      });
    }
    highlightRef.current = joints;
  }, [currentFrame, diagnostics]);

  useEffect(() => {
    if (!active) return;

    let rafId = 0;
    let videoCallbackId = 0;
    let looping = false;
    let redrawPending = false;
    let cancelled = false;

    /**
     * Cuerpo de dibujo. Idéntico al original salvo que ahora informa si pudo
     * dibujar, en lugar de reprogramarse a sí mismo: la programación se decidió
     * fuera para poder detenerse cuando no hay nada que actualizar.
     */
    const drawFrame = (): boolean => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !job.width || !job.height) {
        return false;
      }

      const displayWidth = video.clientWidth;
      const displayHeight = video.clientHeight;
      const pixelRatio = window.devicePixelRatio || 1;
      const targetWidth = Math.round(displayWidth * pixelRatio);
      const targetHeight = Math.round(displayHeight * pixelRatio);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) return false;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, displayWidth, displayHeight);

      const frame = closestFrame(framesRef.current, video.currentTime) as RenderPoseFrame | null;
      if (frame && frame.frame_index !== lastFrameIndex.current) {
        lastFrameIndex.current = frame.frame_index;
        setCurrentFrame(frame);
      }
      const person = frame?.people[0];
      if (frame?.equipment?.length) {
        const scaleX = displayWidth / job.width;
        const scaleY = displayHeight / job.height;
        frame.equipment.forEach((item) => {
          const [x1, y1, x2, y2] = item.xyxy;
          const color = item.label === "wall_ball_target" ? CANVAS_COLORS.equipmentTarget : CANVAS_COLORS.equipment;
          context.strokeStyle = color;
          context.lineWidth = 2;
          context.strokeRect(x1 * scaleX, y1 * scaleY, (x2 - x1) * scaleX, (y2 - y1) * scaleY);
          context.fillStyle = color;
          context.font = "11px ui-monospace, Consolas, monospace";
          context.fillText(`${item.label.replaceAll("_", " ")} ${Math.round(item.confidence * 100)}%`, x1 * scaleX, Math.max(14, y1 * scaleY - 5));

          const track = equipmentIndexRef.current.get(item.track_id);
          const recent = track
            ? track.filter((entry) => entry.frameIndex <= frame.frame_index && entry.frameIndex >= frame.frame_index - 45)
            : [];
          if (recent.length > 1) {
            context.beginPath();
            recent.forEach((entry, index) => {
              const x = entry.detection.center[0] * scaleX;
              const y = entry.detection.center[1] * scaleY;
              if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            context.strokeStyle = `${color}aa`;
            context.lineWidth = 2;
            context.stroke();
          }
        });
      }
      if (person) {
        const scaleX = displayWidth / job.width;
        const scaleY = displayHeight / job.height;

        if (showUncertainty && person.covariance) {
          person.xy.forEach((point, index) => {
            const confidence = drawConfidence(person, index);
            const covariance = person.covariance?.[index];
            if (!covariance || confidence < MIN_DRAW_CONFIDENCE || point[0] == null || point[1] == null) return;
            const a = Number(covariance[0][0]);
            const b = Number(covariance[0][1]);
            const d = Number(covariance[1][1]);
            if (![a, b, d].every(Number.isFinite)) return;
            const trace = a + d;
            const delta = Math.sqrt(Math.max(0, (a - d) ** 2 + 4 * b ** 2));
            const radiusX = Math.min(80, Math.sqrt(Math.max(0, (trace + delta) / 2)) * 2 * scaleX);
            const radiusY = Math.min(80, Math.sqrt(Math.max(0, (trace - delta) / 2)) * 2 * scaleY);
            const rotation = 0.5 * Math.atan2(2 * b, a - d);
            context.beginPath();
            context.ellipse(point[0] * scaleX, point[1] * scaleY, radiusX, radiusY, rotation, 0, Math.PI * 2);
            context.strokeStyle = `${confidenceColor(confidence)}70`;
            context.lineWidth = 1;
            context.stroke();
          });
        }

        context.lineCap = "round";
        SKELETON_EDGES.forEach(([start, end]) => {
          const startPoint = person.xy[start];
          const endPoint = person.xy[end];
          const startConfidence = drawConfidence(person, start);
          const endConfidence = drawConfidence(person, end);
          if (
            !startPoint || !endPoint || startPoint[0] == null || startPoint[1] == null ||
            endPoint[0] == null || endPoint[1] == null ||
            startConfidence < MIN_DRAW_CONFIDENCE || endConfidence < MIN_DRAW_CONFIDENCE
          ) return;
          const edgeConfidence = Math.min(startConfidence, endConfidence);
          const startSeverity = highlightRef.current.get(start);
          const endSeverity = highlightRef.current.get(end);
          const highlighted = startSeverity != null && endSeverity != null;
          const severity = highlighted
            ? (SEVERITY_WEIGHT[startSeverity] >= SEVERITY_WEIGHT[endSeverity] ? startSeverity : endSeverity)
            : null;
          context.beginPath();
          context.moveTo(startPoint[0] * scaleX, startPoint[1] * scaleY);
          context.lineTo(endPoint[0] * scaleX, endPoint[1] * scaleY);
          context.strokeStyle = severity ? CANVAS_COLORS.severity[severity] : confidenceColor(edgeConfidence);
          context.lineWidth = severity ? 5 : 2.5;
          context.stroke();
        });

        person.xy.forEach((point, index) => {
          const confidence = drawConfidence(person, index);
          if (!point || point[0] == null || point[1] == null || confidence < MIN_DRAW_CONFIDENCE) return;
          const severity = highlightRef.current.get(index);
          context.beginPath();
          context.arc(point[0] * scaleX, point[1] * scaleY, 3.5, 0, Math.PI * 2);
          context.fillStyle = severity ? CANVAS_COLORS.severity[severity] : confidenceColor(confidence);
          context.fill();
          context.strokeStyle = CANVAS_COLORS.outline;
          context.lineWidth = 1.5;
          context.stroke();
        });

        if (showReference && diagnostics && frame && comparison.reason === "available") {
          const currentRep = activeRepetition(diagnostics, frame.frame_index);
          const referenceFrames = comparison.source === "external" ? currentReference?.frames ?? [] : framesRef.current;
          const referencePerson = currentRep ? comparisonPose(currentRep, comparison, frame.frame_index, referenceFrames) : undefined;
          const currentTorso = comparisonTorso(person);
          const referenceTorso = comparisonTorso(referencePerson);
          if (referencePerson && currentTorso && referenceTorso) {
            const aligned = alignReference(referencePerson, referenceTorso, currentTorso);
            const markDifferences = comparison.source === "session" || referenceMatch === "vista_coincide";
            const deviates = (index: number) => {
              if (!markDifferences) return false;
              const target = aligned[index];
              const actual = drawableJoint(person, index);
              return target != null && actual != null
                && Math.hypot(target[0] - actual[0], target[1] - actual[1]) / (currentTorso.length * 3) > 0.08;
            };
            SKELETON_EDGES.forEach(([start, end]) => {
              const a = aligned[start];
              const b = aligned[end];
              if (!a || !b) return;
              const off = deviates(start) || deviates(end);
              context.beginPath();
              context.moveTo(a[0] * scaleX, a[1] * scaleY);
              context.lineTo(b[0] * scaleX, b[1] * scaleY);
              context.strokeStyle = off ? CANVAS_COLORS.referenceDeviation : CANVAS_COLORS.reference;
              context.lineWidth = off ? 4 : 2.5;
              context.setLineDash([8, 5]);
              context.stroke();
              context.setLineDash([]);
            });
            aligned.forEach((point, index) => {
              if (!point) return;
              context.beginPath();
              context.arc(point[0] * scaleX, point[1] * scaleY, 3, 0, Math.PI * 2);
              context.fillStyle = deviates(index) ? CANVAS_COLORS.referenceDeviation : CANVAS_COLORS.reference;
              context.fill();
            });
          }
        }
      }
      return true;
    };

    /* Solo se redibuja de forma continua mientras el video avanza y la pestaña
       está visible. Con el video pausado, oculto o terminado, el lienzo ya
       muestra el cuadro correcto y seguir redibujándolo solo consume GPU que
       hace falta para la inferencia. */
    const shouldRunContinuously = (): boolean => {
      const video = videoRef.current;
      return Boolean(video && !video.paused && !video.ended && !document.hidden);
    };

    const scheduleNext = (callback: () => void) => {
      const video = videoRef.current;
      /* `requestVideoFrameCallback` dispara una vez por cuadro presentado del
         video, así que un clip de 30 fps en una pantalla de 60 Hz no provoca el
         doble de dibujos. Si no existe, rAF hace el mismo trabajo. */
      if (video && typeof video.requestVideoFrameCallback === "function") {
        videoCallbackId = video.requestVideoFrameCallback(() => callback());
      } else {
        rafId = requestAnimationFrame(() => callback());
      }
    };

    const loop = () => {
      if (cancelled) return;
      const drew = drawFrame();
      /* Si aún no hay geometría o metadatos, se sigue intentando: es la misma
         tolerancia que tenía el bucle original al montar. */
      if (!drew || shouldRunContinuously()) {
        scheduleNext(loop);
      } else {
        looping = false;
      }
    };

    const startLoop = () => {
      if (cancelled || looping) return;
      looping = true;
      loop();
    };

    /** Un solo repintado, para seek, resize o cambio de panel estando en pausa. */
    const redrawOnce = () => {
      if (cancelled || looping || redrawPending) return;
      redrawPending = true;
      rafId = requestAnimationFrame(() => {
        redrawPending = false;
        if (!cancelled) drawFrame();
      });
    };

    startLoop();

    const video = videoRef.current;
    const onPlay = () => startLoop();
    video?.addEventListener("play", onPlay);
    video?.addEventListener("playing", onPlay);
    video?.addEventListener("seeking", redrawOnce);
    video?.addEventListener("seeked", redrawOnce);
    video?.addEventListener("pause", redrawOnce);
    video?.addEventListener("loadedmetadata", redrawOnce);
    video?.addEventListener("loadeddata", redrawOnce);
    document.addEventListener("visibilitychange", onPlay);
    window.addEventListener("resize", redrawOnce);

    /* El bucle continuo ya no está para absorber cambios de tamaño, así que el
       redimensionado se observa de forma explícita. */
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(redrawOnce) : null;
    if (video && observer) observer.observe(video);

    return () => {
      cancelled = true;
      looping = false;
      redrawPending = false;
      cancelAnimationFrame(rafId);
      if (video && videoCallbackId && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(videoCallbackId);
      }
      video?.removeEventListener("play", onPlay);
      video?.removeEventListener("playing", onPlay);
      video?.removeEventListener("seeking", redrawOnce);
      video?.removeEventListener("seeked", redrawOnce);
      video?.removeEventListener("pause", redrawOnce);
      video?.removeEventListener("loadedmetadata", redrawOnce);
      video?.removeEventListener("loadeddata", redrawOnce);
      document.removeEventListener("visibilitychange", onPlay);
      window.removeEventListener("resize", redrawOnce);
      observer?.disconnect();
    };
  }, [active, diagnostics, job.height, job.width, comparison, currentReference, referenceMatch, showReference, showUncertainty]);

  const person = currentFrame?.people[0];
  const overallConfidence = meanConfidence(person);
  const currentRepetition = diagnostics && currentFrame ? activeRepetition(diagnostics, currentFrame.frame_index) : null;
  const frameTotal = job.frame_count ?? (frames.length ? frames[frames.length - 1].frame_index : 0);

  const currentAngles = useMemo<AngleRow[]>(() => {
    if (!person) return [];
    const confidentPoint = (index: number) => (person.keypoint_confidence[index] ?? 0) >= 0.4 ? person.xy[index] : undefined;
    return [
      { label: "Rodilla izq.", value: angle(confidentPoint(11), confidentPoint(13), confidentPoint(15)) },
      { label: "Rodilla der.", value: angle(confidentPoint(12), confidentPoint(14), confidentPoint(16)) },
      { label: "Codo izq.", value: angle(confidentPoint(5), confidentPoint(7), confidentPoint(9)) },
      { label: "Codo der.", value: angle(confidentPoint(6), confidentPoint(8), confidentPoint(10)) },
    ];
  }, [person]);

  const jointRows = useMemo<JointRow[]>(() => {
    if (!person) return [];
    return IMPORTANT_JOINTS.map((index) => ({
      name: jointLabel(person.keypoint_names[index] ?? `punto ${index}`),
      confidence: person.keypoint_confidence[index] ?? null,
      occluded: drawConfidence(person, index) < MIN_DRAW_CONFIDENCE,
    }));
  }, [person]);

  const equipmentState = useMemo(
    () => equipmentCapability(currentFrame ?? frames[0] ?? null),
    [currentFrame, frames],
  );

  const referenceAvailable = comparison.repetition != null;
  const referenceNotice = comparison.notice;

  /* Layout effect: el escenario ya está colocado, pero el navegador aún no
     pinta, así que el contenedor puede medir y animar sin parpadeo. */
  useLayoutEffect(() => {
    if (loading || error) return;
    onStageReady?.();
  }, [loading, error, onStageReady]);

  const seekToFrame = useCallback((frame: number) => {
    const video = videoRef.current;
    if (!video || !job.fps) return;
    video.currentTime = frame / job.fps;
  }, [job.fps]);

  const onSelectRepetition = useCallback((repetitionNumber: number, frame: number) => {
    setSelectedRepetition(repetitionNumber);
    seekToFrame(frame);
  }, [seekToFrame]);

  const applyDiagnosticSelection = useCallback(async (selection: DiagnosticRetry) => {
    const changeView = "view" in selection;
    const alreadySaved = changeView ? job.camera_view === selection.view : job.requested_exercise === selection.exercise;
    if (updatingDiagnostics.current || (alreadySaved && !diagnosticsError)) return;
    updatingDiagnostics.current = true;
    const request = ++diagnosticsRequest.current;
    setChangingView(changeView);
    setChangingExercise(!changeView);
    setDiagnostics(null);
    setDiagnosticsError(null);
    setRetryDiagnostics(null);
    setCoaching(null);
    setCoachingLoading(false);
    setCoachingError(null);
    let saved = alreadySaved;
    try {
      if (!alreadySaved) {
        const updated = changeView
          ? await changeJobCameraView(job.id, selection.view)
          : await changeJobExercise(job.id, selection.exercise);
        if (request !== diagnosticsRequest.current) return;
        saved = true;
        onJobUpdated?.(updated);
      }
      const result = await getBiomechanics(job.id);
      if (request !== diagnosticsRequest.current) return;
      setDiagnostics(result);
      if (changeView) {
        const camera = result.camera_view_resolution;
        const viewLabel = camera?.source === "estimated" ? `estimada como ${cameraViewLabel(camera.effective_view)}`
          : selection.view === "unspecified" ? "sin determinar" : cameraViewLabel(selection.view);
        setAnnouncement(`Vista de cámara ${viewLabel}. Evaluación actualizada.`);
      } else {
        setAnnouncement(`Ejercicio cambiado a ${exerciseLabel(selection.exercise)}. Evaluación actualizada.`);
      }
    } catch (reason) {
      if (request !== diagnosticsRequest.current) return;
      setRetryDiagnostics(selection);
      const message = reason instanceof Error ? reason.message : "La solicitud falló.";
      setDiagnosticsError(saved ? `La selección se guardó. ${message}` : message);
    } finally {
      if (request === diagnosticsRequest.current) {
        updatingDiagnostics.current = false;
        setChangingView(false);
        setChangingExercise(false);
      }
    }
  }, [diagnosticsError, job.camera_view, job.id, job.requested_exercise, onJobUpdated]);

  const onChangeView = useCallback((view: CameraView) => {
    void applyDiagnosticSelection({ view });
  }, [applyDiagnosticSelection]);

  async function onGenerateCoaching() {
    if (coachingLoading || updatingDiagnostics.current) return;
    const request = diagnosticsRequest.current;
    setCoachingLoading(true);
    setCoachingError(null);
    try {
      const result = await generateCoaching(job.id, selectedModel || null, allowRemote, allowRemoteEmbeddings);
      if (request === diagnosticsRequest.current) setCoaching(result);
    } catch (reason) {
      if (request === diagnosticsRequest.current) setCoachingError(reason instanceof Error ? reason.message : "No fue posible generar la retroalimentación.");
    } finally {
      if (request === diagnosticsRequest.current) setCoachingLoading(false);
    }
  }

  async function onMarkHardExample() {
    if (!currentFrame || feedbackSaving) return;
    setFeedbackSaving(true);
    setFeedbackMessage(null);
    try {
      const saved = await markHardExample(job.id, {
        frame_index: currentFrame.frame_index,
        repetition_number: currentRepetition?.number ?? null,
        correction_type: correctionType,
      });
      setFeedbackMessage(`Caso guardado localmente en el cuadro ${saved.frame_index_saved}.`);
    } catch (reason) {
      setFeedbackMessage(reason instanceof Error ? reason.message : "No fue posible guardar la corrección.");
    } finally {
      setFeedbackSaving(false);
    }
  }

  /* --- Señales, encuadre y transporte ----------------------------------------
     Presentación pura: todo se deriva de los keypoints y del resultado que ya
     están en memoria. El bucle de dibujo de arriba no cambia.                 */
  const signals = useMemo(() => (rawFrames.length ? computeSignals(rawFrames) : null), [rawFrames]);
  const thresholds = useMemo(() => thresholdsFromRuleConfig(diagnostics?.rule_config), [diagnostics?.rule_config]);
  const lanes = useMemo(() => (signals ? planLanes(signals, thresholds) : []), [signals, thresholds]);
  const mutedLanes = useMemo(() => {
    const muted = new Set<SignalKey>();
    const repetitions = diagnostics?.repetitions ?? [];
    if (!repetitions.length || effectiveView === "unspecified") return muted;
    lanes.forEach((plan) => {
      if (!plan.thresholds.length) return;
      const everyRuleAbstains = plan.thresholds.every((threshold) => repetitions.every(
        (rep) => rep.rule_evaluations?.[threshold.ruleId]?.status === "not_evaluable",
      ));
      if (everyRuleAbstains) muted.add(plan.spec.key);
    });
    return muted;
  }, [diagnostics?.repetitions, lanes, effectiveView]);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [fitMode, setFitMode] = useState<"athlete" | "full">("athlete");
  const stageReady = !loading && !error;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stageReady || !stage) return undefined;
    const measure = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      setStageSize((current) => (current.width === width && current.height === height ? current : { width, height }));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageReady]);

  const bounds = useMemo(() => athleteBounds(frames), [frames]);
  const crop = useMemo(
    () => computeCrop(stageSize, job.width, job.height, fitMode === "athlete" ? bounds : null),
    [stageSize, job.width, job.height, fitMode, bounds],
  );

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [loopRepetition, setLoopRepetition] = useState(false);
  const [focusLane, setFocusLane] = useState<SignalKey | null>(null);
  const [focusRule, setFocusRule] = useState<string | null>(null);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!stageReady || !video) return undefined;
    const sync = () => setPlaying(!video.paused && !video.ended);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("ended", sync);
    video.addEventListener("click", togglePlay);
    sync();
    return () => {
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("ended", sync);
      video.removeEventListener("click", togglePlay);
    };
  }, [stageReady, togglePlay, job.id]);

  const stepFrames = useCallback((count: number) => {
    const video = videoRef.current;
    if (!video || !job.fps) return;
    video.pause();
    const base = lastFrameIndex.current >= 0 ? lastFrameIndex.current : 0;
    /* El desfase de 0.4 cuadros deja el tiempo dentro del cuadro pedido, lejos
       del borde donde el navegador podría presentar el anterior. */
    video.currentTime = Math.max(0, (base + count + 0.4) / job.fps);
  }, [job.fps]);

  const changeRate = useCallback((next: number) => {
    setRate(next);
    if (videoRef.current) videoRef.current.playbackRate = next;
  }, []);

  const stepRepetition = useCallback((direction: -1 | 1) => {
    const repetitions = diagnostics?.repetitions ?? [];
    if (!repetitions.length) return;
    const frame = lastFrameIndex.current;
    const target = direction > 0
      ? repetitions.find((rep) => rep.start_frame > frame) ?? repetitions[repetitions.length - 1]
      : [...repetitions].reverse().find((rep) => rep.start_frame < frame - 2) ?? repetitions[0];
    onSelectRepetition(target.number, target.start_frame);
  }, [diagnostics, onSelectRepetition]);

  const toggleLoop = useCallback(() => setLoopRepetition((current) => !current), []);

  /* Repetir una repetición: al pasar su final se regresa a poco antes de su
     inicio. Solo actúa mientras el video avanza. */
  useEffect(() => {
    if (!loopRepetition || selectedRepetition == null || !diagnostics || !currentFrame) return;
    const repetition = diagnostics.repetitions.find((rep) => rep.number === selectedRepetition);
    const video = videoRef.current;
    if (!repetition || !video || video.paused) return;
    if (currentFrame.frame_index > repetition.end_frame + 10 || currentFrame.frame_index < repetition.start_frame - 12) {
      seekToFrame(Math.max(repetition.start_frame - 6, 0));
    }
  }, [currentFrame, diagnostics, loopRepetition, selectedRepetition, seekToFrame]);

  useEffect(() => {
    if (!active || !stageReady) return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("input, select, textarea, summary, [role='listbox'], [role='combobox'], [role='option'], [role='menu'], [role='dialog']")) return;
      if (event.key === " ") {
        if (target?.closest("button, a")) return;
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepFrames(event.shiftKey ? -10 : -1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepFrames(event.shiftKey ? 10 : 1);
      } else if (event.key === "[") {
        stepRepetition(-1);
      } else if (event.key === "]") {
        stepRepetition(1);
      } else if (event.key.toLowerCase() === "l") {
        toggleLoop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, stageReady, togglePlay, stepFrames, stepRepetition, toggleLoop]);

  const onFocusLane = useCallback((lane: SignalKey | null) => {
    setFocusLane(lane);
    setFocusRule(lane ? thresholds.find((item) => item.lane === lane)?.ruleId ?? null : null);
  }, [thresholds]);

  const onFocusRule = useCallback((ruleId: string | null) => {
    setFocusRule(ruleId);
    setFocusLane(ruleId ? thresholds.find((item) => item.ruleId === ruleId)?.lane ?? null : null);
  }, [thresholds]);

  /* Repetición que muestra la cronofotografía: la que se está viendo; si el
     cuadro cae entre repeticiones, la elegida o la más cercana. */
  const plateRepetition = useMemo(() => {
    const repetitions = diagnostics?.repetitions ?? [];
    if (!repetitions.length) return null;
    if (currentRepetition) return currentRepetition;
    const selected = repetitions.find((rep) => rep.number === selectedRepetition);
    if (selected) return selected;
    const frame = currentFrame?.frame_index ?? 0;
    const distance = (rep: BiomechanicsRepetition) => Math.abs(frame - Math.min(Math.max(frame, rep.start_frame), rep.end_frame));
    return repetitions.reduce((best, rep) => (distance(rep) < distance(best) ? rep : best), repetitions[0]);
  }, [diagnostics, currentRepetition, selectedRepetition, currentFrame]);

  /* Un marcador como «punto bajo» es un instante, no un tramo: pasado ese
     cuadro, el rótulo dice que ya quedó atrás en lugar de seguir afirmándolo. */
  const phaseMarker = currentRepetition && currentFrame ? phaseAtFrame(currentRepetition, currentFrame.frame_index) : null;
  const phaseText = phaseMarker && currentFrame
    ? (INSTANT_PHASES.has(phaseMarker.key) && currentFrame.frame_index > phaseMarker.frame + 1
      ? `después del ${phaseMarker.label.toLowerCase()}`
      : phaseMarker.label.toLowerCase())
    : null;
  const sessionDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" }).format(new Date(job.created_at));

  const exercisePickerSlot = (
    <ExercisePicker
      value={job.requested_exercise}
      coverage={coverage}
      onChange={(exercise) => void applyDiagnosticSelection({ exercise })}
    />
  );

  /* El coaching es la salida que más le importa a quien entrena: vive en la
     columna principal, justo debajo de la partitura, y no dentro de una pestaña. */
  const coachingRef = useRef<HTMLElement>(null);
  const goToCoaching = useCallback(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    coachingRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, []);

  const coachingSlot = (
    <CoachingPanel
      models={llmModels}
      selectedModel={selectedModel}
      onSelectModel={setSelectedModel}
      allowRemote={allowRemote}
      onAllowRemoteChange={setAllowRemote}
      allowRemoteEmbeddings={allowRemoteEmbeddings}
      onAllowRemoteEmbeddingsChange={setAllowRemoteEmbeddings}
      coaching={coaching}
      loading={coachingLoading}
      error={coachingError}
      onGenerate={() => void onGenerateCoaching()}
    />
  );

  const videoOverlay = useMemo(
    () => (!person && !loading ? (
      <span className="pose-absent-badge">
        <span aria-hidden="true" />
        SIN PERSONA CONFIABLE EN ESTE CUADRO
      </span>
    ) : null),
    [person, loading],
  );

  return (
    <section className="workbench is-session" aria-label="Análisis de la sesión">
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className="session-bar">
        <button type="button" className="session-back" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M9.5 3.5L5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sesiones
        </button>
        <div className="session-title">
          <h2>{job.original_filename}</h2>
          <p>
            {sessionDate}
            {job.duration_seconds != null && ` · ${job.duration_seconds.toFixed(1)} s`}
            {job.fps && ` · ${job.fps.toFixed(0)} fps · ${job.width}×${job.height}`}
          </p>
        </div>
        <dl className="session-facts">
          <div>
            <dt>Ejercicio</dt>
            <dd>
              {exerciseLabel(diagnostics?.exercise ?? job.requested_exercise)}{" "}
              <small>{diagnostics?.exercise_source === "automatic" ? "detectado" : "elegido"}</small>
            </dd>
          </div>
          <div>
            <dt>Vista</dt>
            <dd className={effectiveView === "unspecified" ? "is-missing" : ""}>
              {changingView ? "Actualizando…" : effectiveView === "unspecified"
                ? (diagnostics ? "Sin determinar" : "Automática")
                : cameraViewLabel(effectiveView).replace(/^./, (letter) => letter.toUpperCase())}
              {!changingView && resolution?.source === "estimated" && <> <small>estimada</small></>}
            </dd>
          </div>
          {job.pose_model && (
            <div>
              <dt>Modelo de pose</dt>
              <dd><code>{job.pose_model}</code></dd>
            </div>
          )}
        </dl>
        {diagnostics && !loading && !error && (
          <button type="button" className="session-coach" onClick={goToCoaching}>
            {coaching ? "Ver coaching" : "Pedir coaching"}
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 3v9M4 8.5L8 12.5l4-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </header>

      {loading ? (
        <p className="workbench-loading" role="status">Cargando keypoints…</p>
      ) : error ? (
        <p className="form-message error" role="alert">{error}</p>
      ) : (
        <div className="workbench-grid">
          <div className="workbench-stage">
            <div className="stage-row">
              <div className="stage-cell" ref={stageRef}>
                <VideoCanvasShell
                  videoRef={videoRef}
                  canvasRef={canvasRef}
                  src={`${API_URL}/api/jobs/${job.id}/video`}
                  width={job.width}
                  height={job.height}
                  overlay={videoOverlay}
                  crop={crop}
                />
                <div className="stage-hud is-top" role="group" aria-label="Capas del visor">
                  <button
                    type="button"
                    aria-pressed={showUncertainty}
                    title="Elipses de covarianza que entrega el modelo. No están calibradas como error de medición."
                    onClick={() => setShowUncertainty((current) => !current)}
                  >
                    Covarianza
                  </button>
                  <button
                    type="button"
                    aria-pressed={showReference && referenceAvailable}
                    disabled={!referenceAvailable}
                    title="Superpone una referencia en los cuadros que se pueden alinear por fases."
                    onClick={() => setShowReference((current) => !current)}
                  >
                    Referencia
                  </button>
                </div>
                <div className="stage-hud is-bottom" role="group" aria-label="Encuadre">
                  <button type="button" aria-pressed={fitMode === "athlete"} onClick={() => setFitMode("athlete")}>Atleta</button>
                  <button type="button" aria-pressed={fitMode === "full"} onClick={() => setFitMode("full")}>Cuadro completo</button>
                </div>
                <p className="stage-phase">
                  {currentRepetition
                    ? `Rep. ${currentRepetition.number}${phaseText ? ` · ${phaseText}` : ""}`
                    : "Entre repeticiones"}
                </p>
              </div>

              <ChronoPlate
                frames={frames}
                repetition={plateRepetition}
                currentFrame={currentFrame?.frame_index ?? null}
                nearSide={signals?.nearSide ?? "right"}
                onSeekToFrame={seekToFrame}
              />
            </div>

            <div className="transport">
              <TransportControls
                playing={playing}
                rate={rate}
                loop={loopRepetition}
                canLoop={Boolean(diagnostics?.repetitions.length)}
                hasRepetitions={Boolean(diagnostics?.repetitions.length)}
                onTogglePlay={togglePlay}
                onStep={stepFrames}
                onStepRepetition={stepRepetition}
                onRate={changeRate}
                onToggleLoop={toggleLoop}
              />
              <TransportClock
                frameIndex={currentFrame?.frame_index ?? null}
                frameTotal={frameTotal}
                fps={job.fps}
              />
            </div>

            {signals && lanes.length > 0 && (
              <MotionScore
                signals={signals}
                lanes={lanes}
                frames={frames}
                repetitions={diagnostics?.repetitions ?? NO_REPETITIONS}
                frameTotal={frameTotal}
                fps={job.fps}
                currentFrame={currentFrame?.frame_index ?? null}
                selectedRepetition={selectedRepetition}
                focusLane={focusLane}
                mutedLanes={mutedLanes}
                onSeekToFrame={seekToFrame}
                onSelectRepetition={onSelectRepetition}
                onFocusLane={onFocusLane}
              />
            )}

            {diagnostics && (
              <section className="coaching-stage" ref={coachingRef} aria-label="Coaching del modelo">
                {coachingSlot}
              </section>
            )}

            {referenceNotice && (
              <p className="stage-note is-unavailable" role={comparison.reason === "pending" ? "status" : undefined}>
                <strong>{comparison.reason === "pending" ? "PREPARANDO COMPARACIÓN" : "COMPARACIÓN NO DISPONIBLE"}</strong> {referenceNotice}
              </p>
            )}

            {showReference && comparison.reason === "available" ? (
              <div className="stage-note reference-note">
                <p>
                  <strong>Referencia</strong>{" "}
                  {comparison.source === "external" ? currentReference?.info?.label : `Repetición ${comparison.repetition.number} de esta sesión, sin hallazgos en las reglas evaluadas`}
                  {comparison.source === "external" && currentReference?.info && ` · vista ${cameraViewLabel(currentReference.info.camera_view)}`}.
                </p>
                {comparison.source === "session" && <p>Usa esta referencia para observar la consistencia entre repeticiones de la sesión.</p>}
                {comparison.source === "external" && referenceMatch === "vista_no_verificada" && (
                  <p className="reference-caveat">
                    <strong>VISTA NO VERIFICADA.</strong> El visor superpone el trazo azul cuando hay fases y pose compatibles. Las diferencias de perspectiva pueden afectar la alineación.
                  </p>
                )}
                <p className="reference-legend">
                  El trazo azul punteado muestra la referencia alineada por fases.
                  {(comparison.source === "session" || referenceMatch === "vista_coincide") && " El ámbar en el trazo punteado indica separación 2D. Los hallazgos del motor se marcan en el esqueleto de la sesión."}
                </p>
                <p className="reference-limits">
                  La alineación ajusta la posición y la escala con la cadera y los hombros. El ángulo y el encuadre de la cámara afectan la comparación.
                </p>
              </div>
            ) : null}

            <div className="stage-extras">
              <LiveReadouts
                person={person}
                overallConfidence={overallConfidence}
                angles={currentAngles}
                joints={jointRows}
                frameIndex={currentFrame?.frame_index ?? null}
                frameTotal={frameTotal}
              />

              {/* Marcado de detección incorrecta */}
              <section className="hard-example" aria-label="Marcar detección incorrecta">
                <div className="hard-example-copy">
                  <TechnicalLabel as="h3">¿La detección es incorrecta?</TechnicalLabel>
                  <p>Guarda este cuadro y su diagnóstico para revisión local.</p>
                </div>
                <label className="hard-example-type">
                  <span className="visually-hidden">Tipo de corrección</span>
                  <select value={correctionType} onChange={(event) => setCorrectionType(event.target.value)}>
                    <option value="keypoints">Keypoints mal ubicados</option>
                    <option value="false_positive_error">Error biomecánico falso positivo</option>
                    <option value="false_negative_error">Error no detectado</option>
                    <option value="exercise_classification">Ejercicio mal clasificado</option>
                    <option value="phase_or_count">Fase o conteo incorrecto</option>
                    <option value="other">Otro</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void onMarkHardExample()}
                  disabled={!currentFrame || feedbackSaving}
                >
                  {feedbackSaving ? "Guardando…" : "Marcar cuadro"}
                </button>
                {feedbackMessage && (
                  <p className="hard-example-message" role="status">{feedbackMessage}</p>
                )}
              </section>
            </div>
          </div>

          {diagnosticsError ? (
            <div className="form-message error" role="alert">
              <p>{diagnosticsError}</p>
              <button type="button" onClick={() => void applyDiagnosticSelection(retryDiagnostics ?? { view: job.camera_view })}>Reintentar evaluación</button>
            </div>
          ) : !diagnostics ? (
            <p className="workbench-loading" role="status">Calculando fases y repeticiones…</p>
          ) : (
            <SessionReading
              job={job}
              diagnostics={diagnostics}
              signals={signals}
              frames={rawFrames}
              thresholds={thresholds}
              selectedRepetition={selectedRepetition}
              focusRule={focusRule}
              changingView={changingView}
              viewError={null}
              onChangeView={onChangeView}
              onFocusRule={onFocusRule}
              onSelectRepetition={onSelectRepetition}
              detailSlot={(
                <DiagnosticRail
                  diagnostics={diagnostics}
                  equipment={equipmentState}
                  onSeekToFrame={seekToFrame}
                  exercisePickerSlot={exercisePickerSlot}
                  changingExercise={changingExercise}
                  coachingSlot={null}
                />
              )}
            />
          )}
        </div>
      )}
    </section>
  );
}
