import type { KnowledgeSourceReference } from "../types";

function timestamp(value: number): string {
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function hasTime(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function knowledgeSourceKind(source: KnowledgeSourceReference): string | null {
  if (source.source_type !== "video") return null;
  const labels: Record<string, string> = {
    fault: "Error mostrado: no imitar",
    execution: "Demostración de ejecución",
    correction: "Corrección explicada",
    progression: "Progresión explicada",
    explanation: "Explicación de coaching",
  };
  return labels[source.content_kind ?? ""] ?? "Fuente audiovisual";
}

export function knowledgeSourceLocation(source: KnowledgeSourceReference): string {
  if (source.source_type === "video") {
    if (!hasTime(source.start_seconds)) return "Video completo";
    const start = timestamp(source.start_seconds);
    return hasTime(source.end_seconds) && source.end_seconds > source.start_seconds ? `${start}–${timestamp(source.end_seconds)}` : start;
  }
  return source.page != null ? `pág. ${source.page}` : "Fuente sin página";
}

export function knowledgeSourceHref(source: KnowledgeSourceReference, apiUrl: string): string | null {
  if (source.source_type !== "video") return null;
  const start = hasTime(source.start_seconds) ? Math.floor(source.start_seconds) : 0;
  if (source.video_url && /^\/api\/library\/coaching\/[A-Za-z0-9_-]+\/videos\/[A-Za-z0-9_-]+$/.test(source.video_url)) {
    return `${apiUrl}${source.video_url}#t=${start}`;
  }
  if (source.source_url && /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(source.source_url)) {
    return `${source.source_url}&t=${start}s`;
  }
  return null;
}
