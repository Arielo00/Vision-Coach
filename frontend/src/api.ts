import type {
  BiomechanicsResult,
  CatalogCoveragePayload,
  CoachingResult,
  CoachingLibraryPayload,
  ExerciseLibraryPayload,
  HealthStatus,
  LLMModelsResponse,
  PipelineStatus,
  PoseFrame,
  PoseFramesPage,
  ProgressPayload,
  ReferenceInfo,
  ReferencePayload,
  UploadInput,
  VideoJob,
} from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

function errorMessage(xhr: XMLHttpRequest): string {
  try {
    const payload = JSON.parse(xhr.responseText) as { detail?: string };
    return payload.detail ?? "No fue posible guardar el video.";
  } catch {
    return "No fue posible guardar el video.";
  }
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { detail?: unknown };
    return typeof payload.detail === "string" && payload.detail.trim()
      ? payload.detail
      : fallback;
  } catch {
    return fallback;
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function getHealth(): Promise<HealthStatus> {
  const response = await fetch(`${API_URL}/api/health`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible consultar el estado del backend local."));
  }
  return response.json() as Promise<HealthStatus>;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const response = await fetch(`${API_URL}/api/pipeline/status`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible consultar las capacidades declaradas."));
  }
  return response.json() as Promise<PipelineStatus>;
}

export async function getCatalogCoverage(): Promise<CatalogCoveragePayload> {
  const response = await fetch(`${API_URL}/api/catalog/coverage`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible consultar la cobertura biomecánica."));
  }
  return response.json() as Promise<CatalogCoveragePayload>;
}

export async function getJobs(): Promise<VideoJob[]> {
  const response = await fetch(`${API_URL}/api/jobs`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible consultar los trabajos locales."));
  }
  return response.json() as Promise<VideoJob[]>;
}

export async function getExerciseLibrary(): Promise<ExerciseLibraryPayload> {
  const response = await fetch(`${API_URL}/api/library/exercises`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible cargar la biblioteca técnica."));
  }
  return response.json() as Promise<ExerciseLibraryPayload>;
}

export async function getCoachingLibrary(): Promise<CoachingLibraryPayload> {
  const response = await fetch(`${API_URL}/api/library/coaching`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible cargar los videos de coaching."));
  }
  return response.json() as Promise<CoachingLibraryPayload>;
}

export function uploadVideo(
  input: UploadInput,
  onProgress: (progress: number) => void,
): Promise<VideoJob> {
  return new Promise((resolve, reject) => {
    const payload = new FormData();
    payload.append("file", input.file);
    payload.append("camera_view", input.cameraView);
    payload.append("requested_exercise", input.exercise);

    const request = new XMLHttpRequest();
    request.open("POST", `${API_URL}/api/videos`);
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as VideoJob);
      } else {
        reject(new Error(errorMessage(request)));
      }
    });
    request.addEventListener("error", () => {
      reject(new Error("No se pudo conectar con el backend local."));
    });
    request.send(payload);
  });
}

export async function getPoseFramePage(jobId: string, offset = 0, limit = 3000): Promise<PoseFramesPage> {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/pose/frames?${query}`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible leer los keypoints del análisis."));
  }
  return response.json() as Promise<PoseFramesPage>;
}

export async function getPoseFrames(jobId: string): Promise<PoseFrame[]> {
  const items: PoseFrame[] = [];
  let offset = 0;

  while (true) {
    const page = await getPoseFramePage(jobId, offset, 3000);
    items.push(...page.items);
    const nextOffset = page.offset + page.items.length;
    if (!page.truncated || page.items.length === 0 || nextOffset >= page.total) {
      return items;
    }
    offset = nextOffset;
  }
}

export async function reanalyzeJob(jobId: string): Promise<VideoJob> {
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/reanalyze`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible volver a analizar el video."));
  }
  return response.json() as Promise<VideoJob>;
}

export async function getBiomechanics(jobId: string): Promise<BiomechanicsResult> {
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/biomechanics`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible calcular el diagnóstico biomecánico."));
  }
  return response.json() as Promise<BiomechanicsResult>;
}

export async function changeJobExercise(jobId: string, exercise: string): Promise<VideoJob> {
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/exercise`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exercise }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible cambiar el ejercicio aplicado."));
  }
  return response.json() as Promise<VideoJob>;
}

/** Corrige la vista de cámara de un análisis ya hecho. No repite la pose: las
    reglas se vuelven a aplicar la próxima vez que se pide el diagnóstico. */
export async function changeJobCameraView(jobId: string, cameraView: VideoJob["camera_view"]): Promise<VideoJob> {
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/camera_view`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ camera_view: cameraView }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible cambiar la vista de cámara."));
  }
  return response.json() as Promise<VideoJob>;
}

export async function getLLMModels(): Promise<LLMModelsResponse> {
  const response = await fetch(`${API_URL}/api/llm/models`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible consultar los modelos locales."));
  }
  return response.json() as Promise<LLMModelsResponse>;
}

export async function generateCoaching(jobId: string, model: string | null, allowRemote = false, allowRemoteEmbeddings = false): Promise<CoachingResult> {
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/coaching`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, allow_remote: allowRemote, allow_remote_embeddings: allowRemoteEmbeddings }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible generar la retroalimentación."));
  }
  return response.json() as Promise<CoachingResult>;
}

export async function getReferences(exercise: string): Promise<ReferenceInfo[]> {
  const response = await fetch(`${API_URL}/api/references?exercise=${encodeURIComponent(exercise)}`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible consultar las referencias."));
  }
  const payload = await response.json() as { items: ReferenceInfo[] };
  return payload.items;
}

export async function getReferenceFrames(referenceId: string): Promise<ReferencePayload> {
  const response = await fetch(`${API_URL}/api/references/${encodeURIComponent(referenceId)}/frames`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible cargar la referencia."));
  }
  return response.json() as Promise<ReferencePayload>;
}

export async function getProgress(exercise: string | null = null): Promise<ProgressPayload> {
  const query = exercise ? `?exercise=${encodeURIComponent(exercise)}` : "";
  const response = await fetch(`${API_URL}/api/progress${query}`);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible calcular el historial longitudinal."));
  }
  return response.json() as Promise<ProgressPayload>;
}

export async function markHardExample(jobId: string, payload: {
  frame_index: number;
  repetition_number: number | null;
  correction_type: string;
  note?: string;
}): Promise<{ id: string; frame_index_saved: number }> {
  const response = await fetch(`${API_URL}/api/jobs/${jobId}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "No fue posible guardar el caso difícil."));
  }
  return response.json() as Promise<{ id: string; frame_index_saved: number }>;
}
