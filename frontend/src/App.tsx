/* ---------------------------------------------------------------------------
   Contenedor de la aplicación.

   NAVEGACIÓN SIN REMONTAJE
   Las vistas se montan la primera vez que se visitan y a partir de ahí
   permanecen montadas, ocultas con `hidden`. El banco de análisis nunca se
   desmonta, así que cambiar de sección no reinicia la reproducción, el cuadro
   seleccionado, la repetición elegida ni el estado del canvas.

   ESTADO REAL, NO AFIRMACIONES FIJAS
   El aviso de privacidad se deriva del host configurado en `API_URL` y de la
   respuesta de `/api/health`. No existe ningún indicador de disponibilidad
   escrito a mano.
   --------------------------------------------------------------------------- */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";

import {
  API_URL,
  checkHealth,
  getCatalogCoverage,
  getHealth,
  getJobs,
  getLLMModels,
  getPipelineStatus,
  reanalyzeJob,
  uploadVideo,
} from "./api";
import ExerciseLibrary from "./ExerciseLibrary";
import ExercisePicker from "./ExercisePicker";
import { exerciseLabel } from "./exerciseCatalog";
import PosePlayer from "./PosePlayer";
import ProgressPanel from "./ProgressPanel";
import type {
  CameraView,
  CatalogCoveragePayload,
  ExerciseId,
  HealthStatus,
  LLMModelsResponse,
  PipelineStatus,
  VideoJob,
} from "./types";
import ProcessingPipeline from "./ui/ProcessingPipeline";
import { CAMERA_VIEW_OPTIONS, CameraViewPicker } from "./ui/SessionReading";
import SystemStatusPanel from "./ui/SystemStatusPanel";
import { DataPair, StateBadge, TechnicalLabel } from "./ui/StatusAtoms";
import { morphFrom, withViewTransition } from "./ui/motion";
import { backendAvailability, processingLocality } from "./ui/presentationAdapters";
import gonioAppMark from "./assets/gonio-app-mark.svg";

type ProductView = "analyzer" | "library" | "progress" | "system";

/**
 * Numeración consecutiva de lo que el usuario ve.
 *
 * El banco de análisis, la línea de tiempo y el riel de diagnóstico viven
 * dentro de la pestaña Análisis, así que no ocupan un número propio aquí.
 */
const NAV_ITEMS: Array<{ id: ProductView; label: string; index: string }> = [
  { id: "analyzer", label: "Sesiones", index: "01" },
  { id: "library", label: "Biblioteca", index: "02" },
  { id: "progress", label: "Progreso", index: "03" },
  { id: "system", label: "Sistema", index: "04" },
];

const views: Array<{ value: CameraView; label: string }> = [
  { value: "unspecified", label: "Automática" },
  { value: "side", label: "Lateral" },
  { value: "front", label: "Frontal" },
  { value: "three_quarter", label: "Tres cuartos" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function viewLabel(id: CameraView): string {
  return views.find((view) => view.value === id)?.label ?? id;
}

const JOB_STATUS_LABEL: Record<VideoJob["status"], string> = {
  completed: "Pose terminada",
  failed: "Falló el análisis",
  processing: "Procesando",
  queued: "En espera",
};

export default function App() {
  const [productView, setProductView] = useState<ProductView>("analyzer");
  const [visited, setVisited] = useState<Set<ProductView>>(() => new Set<ProductView>(["analyzer"]));
  const [file, setFile] = useState<File | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>("unspecified");
  const [exercise, setExercise] = useState<ExerciseId>("auto");
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [coverage, setCoverage] = useState<CatalogCoveragePayload | null>(null);
  const [models, setModels] = useState<LLMModelsResponse | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeJob, setActiveJob] = useState<VideoJob | null>(null);
  const [reanalyzingJobId, setReanalyzingJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);
  /** Región viva reservada a cambios de estado con significado, no al progreso continuo. */
  const [announcement, setAnnouncement] = useState("");

  const dropRef = useRef<HTMLLabelElement>(null);
  /* Trabajo desde cuya tarjeta se abrió el análisis. Se guarda el id, no la
     caja: el marco tarda en existir —hay que traer los keypoints— y para
     entonces una medida vieja estaría desfasada por el scroll. */
  const origenAnalisisRef = useRef<string | null>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const refreshJobs = useCallback(async () => {
    try {
      setJobs(await getJobs());
      setJobsError(null);
    } catch {
      setJobsError("No se pudieron consultar los trabajos locales. Comprueba que el backend esté iniciado y vuelve a actualizar.");
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    const refreshHealth = async () => {
      const online = await checkHealth();
      setBackendOnline(online);
      if (!online) {
        setLoadingJobs(false);
        setHealth(null);
        setModels(null);
        return;
      }
      try {
        setHealth(await getHealth());
      } catch {
        setHealth(null);
      }
      /* Los proveedores de texto cambian en caliente: arrancar o detener Ollama
         debe reflejarse sin recargar la página. Se consultan con la misma
         cadencia que la salud del backend. */
      try {
        setModels(await getLLMModels());
      } catch {
        setModels(null);
      }
    };
    void refreshHealth();
    void refreshJobs();
    const jobsInterval = window.setInterval(() => void refreshJobs(), 3000);
    const healthInterval = window.setInterval(() => void refreshHealth(), 30000);
    return () => {
      window.clearInterval(jobsInterval);
      window.clearInterval(healthInterval);
    };
  }, [refreshJobs]);

  /* Los manifiestos se recuperan al conectar con el backend, también si este
     se inicia después de abrir la interfaz. */
  useEffect(() => {
    if (backendOnline !== true) return;
    let active = true;
    void getPipelineStatus().then((result) => { if (active) setPipeline(result); }).catch(() => undefined);
    void getCatalogCoverage().then((result) => { if (active) setCoverage(result); }).catch(() => undefined);
    return () => { active = false; };
  }, [backendOnline]);

  /**
   * El marco del video crece desde la tarjeta que lo abrió.
   *
   * Se ejecuta en `useLayoutEffect` para medir el destino ya colocado pero
   * antes de que el navegador pinte, así no hay parpadeo. Solo se animan
   * `transform` y `opacity`: el video y el canvas no se remontan y su
   * `clientWidth` no cambia, de modo que el bucle de dibujo sigue escalando
   * con la misma geometría.
   */
  const onStageReady = useCallback(() => {
    const jobId = origenAnalisisRef.current;
    origenAnalisisRef.current = null;
    if (!jobId) return;
    const tarjeta = document.querySelector<HTMLElement>(`.job-card[data-job-id="${jobId}"]`);
    const marco = document.querySelector<HTMLElement>(".video-canvas-shell");
    if (!tarjeta || !marco) return;
    morphFrom(tarjeta.getBoundingClientRect(), marco, { content: marco.querySelector("video") });
  }, []);

  function abrirAnalisis(job: VideoJob) {
    /* La sesión ocupa su propia pantalla: la lista se oculta mientras está
       abierta, así que ya no hay tarjeta desde la cual animar el marco. */
    setActiveJob(job);
    window.scrollTo({ top: 0 });
  }

  function navigate(next: ProductView) {
    withViewTransition(() => {
      setProductView(next);
      setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
    });
  }

  function acceptFile(candidate?: File) {
    if (!candidate) return;
    const extension = candidate.name.split(".").pop()?.toLowerCase();
    if (extension !== "mp4" && extension !== "mov") {
      setError("Selecciona un archivo MP4 o MOV.");
      setAnnouncement("Archivo rechazado: se requiere MP4 o MOV.");
      return;
    }
    setFile(candidate);
    setError(null);
    setMessage(null);
    setAnnouncement(`Video aceptado: ${candidate.name}.`);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    dropRef.current?.classList.remove("is-dragging");
    acceptFile(event.dataTransfer.files?.[0]);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!file || uploading) return;

    setUploading(true);
    setUploadProgress(0);
    setMessage(null);
    setError(null);
    setAnnouncement("Carga iniciada.");
    try {
      const job = await uploadVideo({ file, cameraView, exercise }, setUploadProgress);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setMessage("Video guardado localmente. El análisis de pose comenzó en este equipo.");
      setAnnouncement("Video guardado. El análisis de pose comenzó.");
      setFile(null);
      setUploadProgress(100);
    } catch (uploadError) {
      const text = uploadError instanceof Error ? uploadError.message : "No fue posible cargar el video.";
      setError(text);
      setAnnouncement(`La carga falló: ${text}`);
    } finally {
      setUploading(false);
    }
  }

  async function onReanalyze(job: VideoJob) {
    if (reanalyzingJobId) return;
    setReanalyzingJobId(job.id);
    setMessage(null);
    setError(null);
    setActiveJob(null);
    try {
      const updated = await reanalyzeJob(job.id);
      setJobs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMessage("El video volvió a la cola. La pose se recalculará con el modelo corregido.");
      setAnnouncement("El video volvió a la cola de análisis.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No fue posible volver a analizar el video.");
    } finally {
      setReanalyzingJobId(null);
    }
  }

  const locality = processingLocality(API_URL, health);
  const backendState = backendAvailability(backendOnline, health);

  return (
    <>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className="app-header">
        <div className="app-brand">
          <img className="app-mark" src={gonioAppMark} width={36} height={36} alt="" aria-hidden="true" />
          <span className="app-brand-text">
            <strong>BIOMECH COACH</strong>
            <small>Análisis de técnica y apoyo a la prevención de lesiones</small>
          </span>
        </div>
        <div className={`app-backend tone-${backendState.tone}`}>
          <span className="app-backend-dot" aria-hidden="true" />
          <span className="app-backend-label">{backendState.label}</span>
        </div>
      </header>

      <nav className="app-nav" aria-label="Secciones principales">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={productView === item.id ? "is-active" : ""}
                aria-current={productView === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <span className="nav-index" aria-hidden="true">{item.index}</span>
                <span className="nav-label">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main id="contenido">
        {/* ---- 01 · Entrada de análisis ------------------------------- */}
        <div className="sessions-layout" hidden={productView !== "analyzer"}>
          <section className="entry" aria-label="Analizar un video" hidden={Boolean(activeJob)}>
            <div className="entry-heading">
              <h1>Analizar un video</h1>
              <p>
                Sube un video ya grabado, con una sola persona y la cámara fija.
                Verás la pose cuadro a cuadro, las repeticiones y qué pudo
                evaluar cada regla.
              </p>
            </div>

            <form className="entry-console" onSubmit={onSubmit}>
              <div className="console-head">
                <TechnicalLabel as="h2">Video de la sesión</TechnicalLabel>
                <StateBadge tone={locality.tone} pattern="solid">{locality.label}</StateBadge>
              </div>

              <label
                ref={dropRef}
                className={`drop-zone ${file ? "has-file" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  dropRef.current?.classList.add("is-dragging");
                }}
                onDragLeave={() => dropRef.current?.classList.remove("is-dragging")}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  accept=".mp4,.mov,video/mp4,video/quicktime"
                  onChange={onFileChange}
                />
                {previewUrl ? (
                  <video src={previewUrl} controls preload="metadata" />
                ) : (
                  <span className="drop-copy">
                    <span className="drop-line" aria-hidden="true" />
                    <strong>Arrastra un MP4 o MOV</strong>
                    <small>o haz clic para elegirlo</small>
                  </span>
                )}
              </label>

              {file && (
                <div className="file-summary">
                  <div>
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                  <button type="button" onClick={() => setFile(null)}>Quitar</button>
                </div>
              )}

              <div className="console-fields">
                <div className="console-field">
                  <TechnicalLabel>¿Desde dónde se grabó?</TechnicalLabel>
                  <CameraViewPicker value={cameraView} onChange={setCameraView} includeUnknown label="Vista de cámara" />
                  <small>{CAMERA_VIEW_OPTIONS.find((option) => option.value === cameraView)?.enables}</small>
                </div>
                <div className="console-field">
                  <TechnicalLabel>Ejercicio esperado</TechnicalLabel>
                  <ExercisePicker value={exercise} onChange={setExercise} coverage={coverage} />
                  <small>Siempre podrás corregir la detección automática.</small>
                </div>
              </div>

              {uploading && (
                <div className="upload-progress">
                  <div>
                    <span>Guardando video</span>
                    <strong>{uploadProgress}%</strong>
                  </div>
                  <progress max="100" value={uploadProgress} />
                </div>
              )}

              {message && <p className="form-message success">{message}</p>}
              {error && <p className="form-message error" role="alert">{error}</p>}

              <button
                className="console-submit"
                type="submit"
                disabled={!file || uploading || backendOnline !== true}
              >
                {uploading ? "Guardando…" : "Analizar video"}
              </button>

              <p className="console-privacy">{locality.detail}</p>
            </form>
          </section>

          {/* ---- Trabajos locales -------------------------------------- */}
          <section className="jobs" aria-label="Sesiones" hidden={Boolean(activeJob)}>
            <header className="jobs-head">
              <TechnicalLabel as="h2">Sesiones en este equipo</TechnicalLabel>
              <button type="button" className="text-action" onClick={() => void refreshJobs()}>
                Actualizar
              </button>
            </header>

            {jobsError && <p className="form-message error" role="alert">{jobsError}</p>}
            {loadingJobs ? (
              <p className="empty-state">Leyendo trabajos…</p>
            ) : jobs.length === 0 ? (
              !jobsError && <div className="empty-state">
                <strong>Aún no hay videos</strong>
                <span>El primer trabajo aparecerá aquí después de guardarlo.</span>
              </div>
            ) : (
              <ul className="job-list">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <article className={`job-card status-${job.status}`} data-job-id={job.id}>
                      <header>
                        <span className="job-status">
                          <span className="job-status-dot" aria-hidden="true" />
                          {JOB_STATUS_LABEL[job.status]}
                        </span>
                        <h3>{job.original_filename}</h3>
                      </header>
                      <dl className="job-facts">
                        <DataPair label="Ejercicio" value={exerciseLabel(job.requested_exercise)} />
                        <DataPair label="Vista" value={<span className="job-camera-view">{viewLabel(job.camera_view)}</span>} />
                        {job.duration_seconds != null && (
                          <DataPair label="Duración" value={`${job.duration_seconds.toFixed(1)} s`} />
                        )}
                      </dl>
                      {(job.status === "processing" || job.status === "queued") && (
                        <ProcessingPipeline
                          stage={job.stage}
                          progress={job.progress}
                          status={job.status}
                        />
                      )}
                      {job.error_message && <p className="job-error">{job.error_message}</p>}
                      {job.status === "completed" && (
                        <div className="job-actions">
                          <button
                            type="button"
                            className="job-primary"
                            onClick={() => abrirAnalisis(job)}
                          >
                            Abrir
                          </button>
                          <button
                            type="button"
                            className="job-secondary"
                            disabled={reanalyzingJobId === job.id}
                            onClick={() => void onReanalyze(job)}
                          >
                            {reanalyzingJobId === job.id ? "Preparando…" : "Reanalizar"}
                          </button>
                          <a
                            className="job-link"
                            href={`${API_URL}/api/jobs/${job.id}/video`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Original
                          </a>
                        </div>
                      )}
                      <time dateTime={job.created_at}>{formatDate(job.created_at)}</time>
                    </article>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- 02 · Banco de análisis -------------------------------- */}
          {activeJob && (
            <PosePlayer
              key={activeJob.id}
              job={activeJob}
              coverage={coverage}
              active={productView === "analyzer"}
              onClose={() => setActiveJob(null)}
              onStageReady={onStageReady}
              onJobUpdated={(updated) => {
                setActiveJob((current) => current?.id === updated.id ? updated : current);
                setJobs((current) => current.map((item) => (item.id === updated.id ? updated : item)));
              }}
            />
          )}
        </div>

        {/* ---- 05 · Biblioteca --------------------------------------- */}
        {visited.has("library") && (
          <div hidden={productView !== "library"}>
            <ExerciseLibrary
              onAnalyze={(exerciseId) => {
                setExercise(exerciseId);
                navigate("analyzer");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </div>
        )}

        {/* ---- 06 · Progreso ---------------------------------------- */}
        {visited.has("progress") && (
          <div hidden={productView !== "progress"}>
            <ProgressPanel
              refreshKey={jobs
                .filter((job) => job.status === "completed")
                .map((job) => `${job.id}:${job.updated_at}:${job.requested_exercise}`)
                .join("|")}
            />
          </div>
        )}

        {/* ---- 07 · Sistema ----------------------------------------- */}
        {visited.has("system") && (
          <div hidden={productView !== "system"}>
            <SystemStatusPanel
              apiUrl={API_URL}
              backendOnline={backendOnline}
              health={health}
              pipeline={pipeline}
              models={models}
              coverage={coverage}
            />
          </div>
        )}
      </main>

      <footer className="app-footer">
        <section className="safety-notice" aria-label="Aviso de responsabilidad">
          <TechnicalLabel as="h2">Herramienta de apoyo, no diagnóstico</TechnicalLabel>
          <p>
            Biomech Coach es una herramienta de visión por computadora. No
            diagnostica lesiones ni sustituye la supervisión de un entrenador
            certificado —por ejemplo, USAW o CrossFit L1/L2— ni la evaluación de un
            profesional de salud. Los movimientos bajo carga, en particular la
            halterofilia olímpica, implican riesgo real de lesión. Detén el
            ejercicio si sientes dolor o inseguridad.
          </p>
        </section>
      </footer>
    </>
  );
}
