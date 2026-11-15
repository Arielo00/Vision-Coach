import { API_URL } from "../api";
import type { KnowledgeSourceReference } from "../types";
import { knowledgeSourceHref, knowledgeSourceLocation } from "./knowledgeSources";

export default function KnowledgeSourceLocation({ source }: { source: KnowledgeSourceReference }) {
  const href = knowledgeSourceHref(source, API_URL);
  const label = knowledgeSourceLocation(source);
  return href ? <a href={href} target="_blank" rel="noreferrer" aria-label={`Ver ${source.title ?? source.filename}, ${label}`}>{label}</a> : <span>{label}</span>;
}
