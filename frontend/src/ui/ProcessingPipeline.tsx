/* ---------------------------------------------------------------------------
   Pipeline de procesamiento.

   Medición real en una RTX 3060 Laptop, clip de 9.4 s y 283 cuadros:

     pending_media_probe     1.27 s
     probing_media           0.23 s
     loading_pose_model     24.22 s
     pose_inference        174.77 s
     ─────────────────────────────
     TOTAL                 200.55 s   (21.3x el tiempo real del video)

   O sea que un video de entrenamiento de tres minutos ronda la hora. Esta
   pantalla no es un adorno: es lo que el usuario mira mientras espera.

   Honestidad del estimado: el ritmo se calcula sobre el avance REAL que
   reporta el backend, con una ventana móvil para que se adapte cuando cambia
   de paso —la carga del modelo y la inferencia avanzan a ritmos muy
   distintos—. No se muestra hasta tener suficiente evidencia, y siempre va
   etiquetado como estimación.
   --------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from "react";

import { TechnicalLabel } from "./StatusAtoms";
import { humanizeKey } from "./presentationAdapters";

/** Secuencia real que emite el worker, en orden. */
const STAGE_SEQUENCE = [
  "pending_media_probe",
  "probing_media",
  "metadata_complete",
  "loading_pose_model",
  "pose_inference",
  "pose_complete",
] as const;

const STAGE_LABELS: Record<string, string> = {
  pending_media_probe: "En cola",
  probing_media: "Sonda de medios",
  metadata_complete: "Metadatos del video",
  loading_pose_model: "Carga del modelo de pose",
  pose_inference: "Inferencia de pose",
  pose_complete: "Pose completa",
  reprocessing_invalid_pose: "Reprocesando pose",
  failed: "Falló",
};

/** Pasos que suelen dominar el tiempo total, según la medición. */
const SLOW_STAGES = new Set(["loading_pose_model", "pose_inference"]);

const MIN_SAMPLES_FOR_ESTIMATE = 3;
const RATE_WINDOW_MS = 20_000;

/** Tiempo ya ocurrido: se conoce con exactitud, así que se muestra exacto. */
function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/**
 * Tiempo estimado: se redondea a propósito.
 *
 * «3 min 42 s» sugiere una precisión que la extrapolación no tiene e invita a
 * mirar el reloj. Un rango grueso comunica lo único que importa —si te da
 * tiempo de ir por agua o de comer— sin fingir exactitud.
 */
function formatEstimate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 45) return "menos de 1 min";
  if (seconds < 10 * 60) return `~${Math.round(seconds / 60)} min`;
  if (seconds < 60 * 60) return `~${Math.round(seconds / 300) * 5} min`;
  const hours = seconds / 3600;
  return hours < 1.75 ? "~1 h" : `~${Math.round(hours)} h`;
}

interface Sample {
  at: number;
  progress: number;
}

interface ProcessingPipelineProps {
  stage: string;
  progress: number;
  status: "queued" | "processing" | "completed" | "failed";
}

export default function ProcessingPipeline({ stage, progress, status }: ProcessingPipelineProps) {
  /* El reloj arranca cuando esta pantalla empieza a observar el trabajo. Si
     recargas a mitad del proceso, vuelve a cero: el backend todavía no expone
     una duración total de procesamiento. */
  const startedAt = useRef<number>(Date.now());
  const samples = useRef<Sample[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const at = Date.now();
    const previous = samples.current[samples.current.length - 1];
    if (!previous || previous.progress !== progress) {
      samples.current.push({ at, progress });
      /* Solo interesa la ventana reciente: el ritmo cambia mucho entre cargar
         el modelo y correr la inferencia. */
      samples.current = samples.current.filter((sample) => at - sample.at <= RATE_WINDOW_MS * 2);
    }
  }, [progress]);

  const elapsedSeconds = (now - startedAt.current) / 1000;

  /** Estimación derivada del avance medido, nunca de un tiempo fijo. */
  const remainingSeconds = (() => {
    const list = samples.current;
    if (list.length < MIN_SAMPLES_FOR_ESTIMATE || progress <= 0 || progress >= 100) return null;
    const cutoff = Date.now() - RATE_WINDOW_MS;
    const reference = list.find((sample) => sample.at >= cutoff) ?? list[0];
    const deltaProgress = progress - reference.progress;
    const deltaMs = Date.now() - reference.at;
    if (deltaProgress <= 0 || deltaMs < 3000) return null;
    const ratePerMs = deltaProgress / deltaMs;
    const remaining = (100 - progress) / ratePerMs / 1000;
    return Number.isFinite(remaining) && remaining > 0 ? remaining : null;
  })();

  const currentIndex = STAGE_SEQUENCE.indexOf(stage as (typeof STAGE_SEQUENCE)[number]);
  const failed = status === "failed" || stage === "failed";

  return (
    <section className="pipeline" aria-label="Progreso del procesamiento">
      <header className="pipeline-head">
        <TechnicalLabel as="h4">{failed ? "Procesamiento detenido" : "Procesando"}</TechnicalLabel>
        <span className="pipeline-elapsed">
          <span className="pipeline-elapsed-value">{formatElapsed(elapsedSeconds)}</span>
          <span className="pipeline-elapsed-label">transcurrido</span>
        </span>
      </header>

      <ol className="pipeline-steps">
        {STAGE_SEQUENCE.map((step, index) => {
          const state = failed && index === currentIndex
            ? "failed"
            : currentIndex < 0
              ? "pending"
              : index < currentIndex
                ? "done"
                : index === currentIndex
                  ? "running"
                  : "pending";
          return (
            <li key={step} className={`pipeline-step is-${state}`}>
              <span className="pipeline-step-mark" aria-hidden="true" />
              <span className="pipeline-step-label">{STAGE_LABELS[step] ?? humanizeKey(step)}</span>
              {state === "running" && (
                <span className="pipeline-step-state">
                  {progress}%
                  {SLOW_STAGES.has(step) && <span className="pipeline-step-hint"> · paso largo</span>}
                </span>
              )}
              {state === "done" && <span className="pipeline-step-state">listo</span>}
              {state === "failed" && <span className="pipeline-step-state">falló</span>}
            </li>
          );
        })}
      </ol>

      {/* Paso desconocido: se nombra en vez de ocultarlo. */}
      {currentIndex < 0 && !failed && (
        <p className="pipeline-unknown">
          Paso actual: {STAGE_LABELS[stage] ?? humanizeKey(stage)}
        </p>
      )}

      <div className="pipeline-bar">
        <progress max="100" value={progress} aria-label={`Avance del procesamiento: ${progress}%`} />
        <span className="pipeline-bar-value">{progress}%</span>
      </div>

      {/* El dato que convierte la espera en libertad: el trabajo no vive en la
          pestaña. Va antes que el estimado a propósito. */}
      <p className="pipeline-detach">
        Puedes cerrar esta pestaña. El análisis continúa en este equipo y el
        resultado te espera aquí.
      </p>

      {remainingSeconds != null && (
        <p className="pipeline-estimate">
          Faltan <strong>{formatEstimate(remainingSeconds)}</strong>, estimado
          del avance real.
        </p>
      )}
    </section>
  );
}
