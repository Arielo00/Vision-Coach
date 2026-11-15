/* ---------------------------------------------------------------------------
   05 · Biblioteca técnica.

   Índice editorial de movimientos, no una rejilla de tarjetas. Cada renglón es
   una entrada tipográfica de ancho completo con su numeración, disciplinas y
   marcadores de evidencia; el detalle se abre debajo.

   Un ejercicio compartido entre disciplinas aparece en varias vistas de
   categoría pero apunta a un único registro: la guía biomecánica no se
   duplica. Cuando los estándares difieren, la diferencia se muestra en la capa
   de fuentes secundarias, que está explícitamente aislada de los estándares
   primarios.

   Nada se fabrica: si no hay video, fuente, página o criterio, se dice.
   --------------------------------------------------------------------------- */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { API_URL, getExerciseLibrary } from "./api";
import CoachingLibrary from "./CoachingLibrary";
import type {
  ExerciseId,
  ExerciseLibraryItem,
  ExerciseLibraryPayload,
  ExerciseLibraryVideo,
} from "./types";
import Disclosure from "./ui/Disclosure";
import { DataPair, NotEvaluable, StateBadge, TechnicalLabel } from "./ui/StatusAtoms";
import { resolveLibrarySelection } from "./ui/presentationAdapters";
import { normalizeForSearch } from "./ui/text";

const categories = [
  { id: "all", label: "Todos" },
  { id: "crossfit", label: "CrossFit" },
  { id: "calisthenics", label: "Calistenia" },
  { id: "hyrox", label: "Hyrox" },
] as const;

type CategoryId = (typeof categories)[number]["id"];

const categoryLabel: Record<string, string> = {
  crossfit: "CrossFit",
  calisthenics: "Calistenia",
  hyrox: "Hyrox",
};

const viewLabel: Record<string, string> = {
  side: "Lateral",
  front: "Frontal",
  three_quarter: "Tres cuartos",
  unspecified: "Sin especificar",
};

function sourceLocation(pages: number[], section: string | null): string {
  if (section) return section;
  if (!pages.length) return "Referencia declarada";
  if (pages.length === 1) return `Página ${pages[0]}`;
  return `Páginas ${pages[0]}–${pages[pages.length - 1]}`;
}

function availableVideos(item: ExerciseLibraryItem): ExerciseLibraryVideo[] {
  return item.videos.filter((video) => video.available && video.url);
}

export default function ExerciseLibrary({ onAnalyze }: { onAnalyze: (exercise: ExerciseId) => void }) {
  const [payload, setPayload] = useState<ExerciseLibraryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryId>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailId = useId();

  useEffect(() => {
    void getExerciseLibrary()
      .then((result) => {
        setPayload(result);
        const firstWithVideo = result.items.find((item) => availableVideos(item).length) ?? result.items[0];
        setSelectedId(firstWithVideo?.id ?? null);
      })
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "No fue posible cargar la biblioteca."),
      );
  }, []);

  const filtered = useMemo(() => {
    if (!payload) return [];
    const needle = normalizeForSearch(query.trim());
    return payload.items.filter((item) => {
      const matchesCategory = category === "all" || item.categories.includes(category);
      const secondaryText = item.secondary_sources
        .map((source) => `${source.name} ${source.standard_variant} ${source.instructions_es ?? ""}`)
        .join(" ");
      const haystack = normalizeForSearch(
        `${item.label} ${item.family} ${item.required_equipment.join(" ")} ${item.criteria.join(" ")} ${secondaryText}`,
      );
      return matchesCategory && (!needle || haystack.includes(needle));
    });
  }, [payload, query, category]);

  /**
   * La selección se resuelve contra los resultados filtrados, no contra todo el
   * catálogo: si no, el detalle de un ejercicio de CrossFit sigue visible bajo
   * el filtro de Hyrox y contradice al índice.
   */
  const { selected, filteredOut: selectionFilteredOut } = resolveLibrarySelection(
    filtered,
    selectedId,
  );
  const selectedVideos = selected ? availableVideos(selected) : [];
  const selectedVideo = selectedVideos.find((video) => video.id === selectedVideoId) ?? selectedVideos[0] ?? null;
  const selectedSecondary = selected?.secondary_sources[0] ?? null;

  function choose(item: ExerciseLibraryItem) {
    setSelectedId(item.id);
    setSelectedVideoId(null);
    window.requestAnimationFrame(() =>
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  if (error) {
    return (
      <section className="library">
        <p className="form-message error" role="alert">{error}</p>
      </section>
    );
  }
  if (!payload) {
    return (
      <section className="library">
        <p className="empty-state" role="status">Construyendo la biblioteca desde el catálogo local…</p>
      </section>
    );
  }

  return (
    <section className="library" aria-label="Biblioteca técnica">
      <header className="library-header">
        <div>
          <TechnicalLabel>02 · Atlas de movimiento</TechnicalLabel>
          <h2>Aprende el movimiento antes de analizarlo.</h2>
          <p>
            Criterios observables, fuentes documentales y video de referencia, con
            el nivel de evidencia declarado en cada capa.
          </p>
        </div>
        <dl className="library-counts">
          <DataPair label="Ejercicios" value={payload.summary.exercises} />
          <DataPair label="Con video" value={payload.summary.with_video} />
          <DataPair label="Con motor" value={payload.summary.with_rule_engine} />
          <DataPair label="Con fuentes" value={payload.summary.with_sources} />
        </dl>
      </header>

      <CoachingLibrary />

      <div className="library-toolbar">
        <label className="library-search">
          <span className="visually-hidden">Buscar en la biblioteca</span>
          <span className="library-search-glyph" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar ejercicio, implemento o criterio…"
          />
        </label>
        <div className="library-categories" role="group" aria-label="Filtrar por disciplina">
          {categories.map((item) => (
            <button
              type="button"
              key={item.id}
              className={category === item.id ? "is-active" : ""}
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <p className="library-count-line">
        {filtered.length} {filtered.length === 1 ? "entrada" : "entradas"}
        {category !== "all" ? ` en ${categoryLabel[category]}` : ""}
      </p>

      {/* Índice editorial */}
      {filtered.length === 0 ? (
        <NotEvaluable title="SIN COINCIDENCIAS">
          Prueba con otro nombre, implemento o criterio.
        </NotEvaluable>
      ) : (
        <ol className="library-index">
          {filtered.map((item, index) => {
            const videos = availableVideos(item);
            const isSelected = selectedId === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`library-entry ${isSelected ? "is-selected" : ""}`}
                  aria-expanded={isSelected}
                  aria-controls={detailId}
                  onClick={() => choose(item)}
                >
                  <span className="entry-index" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="entry-name">{item.label}</span>
                  <span className="entry-disciplines">
                    {item.categories.map((value) => categoryLabel[value]).join(" · ")}
                  </span>
                  {/* Cuatro ranuras fijas, siempre en el mismo orden y posición.
                      Las ausentes se ocultan pero conservan su espacio, así la
                      columna se puede recorrer en vertical de un vistazo.
                      `visibility: hidden` también las retira del árbol de
                      accesibilidad, así que un lector de pantalla solo oye las
                      que existen. */}
                  <span className="entry-markers">
                    <span className={`entry-marker is-engine ${item.has_rule_engine ? "" : "is-absent"}`}>
                      Motor
                    </span>
                    <span className={`entry-marker is-video ${videos.length ? "" : "is-absent"}`}>
                      Video
                    </span>
                    <span className={`entry-marker is-source ${item.sources.length ? "" : "is-absent"}`}>
                      Fuente
                    </span>
                    <span className={`entry-marker is-secondary ${item.secondary_sources.length ? "" : "is-absent"}`}>
                      Auxiliar
                    </span>
                  </span>
                  <span className="entry-maturity">{item.maturity_label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {selectionFilteredOut && (
        <p className="library-selection-hidden">
          El ejercicio abierto no aparece con el filtro actual. Elige una entrada
          del índice o vuelve a «Todos».
        </p>
      )}

      {/* Detalle */}
      {selected && (
        <article className="library-detail" id={detailId} ref={detailRef}>
          <header className="library-detail-head">
            <div>
              <TechnicalLabel>
                {selected.categories.map((value) => categoryLabel[value]).join(" · ")} ·{" "}
                {selected.family.replaceAll("_", " ")}
              </TechnicalLabel>
              <h3>{selected.label}</h3>
              <p>{selected.limiting_factor}</p>
            </div>
            <button type="button" className="library-analyze" onClick={() => onAnalyze(selected.id)}>
              Analizar este ejercicio
            </button>
          </header>

          <div className="library-detail-grid">
            <div className="library-media">
              {selectedVideo ? (
                <>
                  <video
                    key={selectedVideo.id}
                    controls
                    preload="metadata"
                    src={`${API_URL}${selectedVideo.url}`}
                  />
                  <div className="media-attribution">
                    <StateBadge tone="evaluable" pattern="solid">
                      {selectedVideo.relationship_label}
                    </StateBadge>
                    <span>
                      {selectedVideo.publisher} · {selectedVideo.filename}
                    </span>
                  </div>
                  {selectedVideos.length > 1 && (
                    <div className="media-selector" role="group" aria-label="Videos disponibles">
                      {selectedVideos.map((video) => (
                        <button
                          type="button"
                          key={video.id}
                          className={selectedVideo.id === video.id ? "is-active" : ""}
                          aria-pressed={selectedVideo.id === video.id}
                          onClick={() => setSelectedVideoId(video.id)}
                        >
                          {video.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : selectedSecondary?.media.display_enabled && selectedSecondary.media.url ? (
                <figure className="media-secondary">
                  <img
                    src={`${API_URL}${selectedSecondary.media.url}`}
                    alt={`Demostración secundaria: ${selectedSecondary.name}`}
                  />
                  <figcaption>{selectedSecondary.media.attribution}</figcaption>
                </figure>
              ) : (
                /* Marcador tipográfico y esquelético: nunca un video falso. */
                <div className="media-placeholder">
                  <span className="placeholder-skeleton" aria-hidden="true">
                    <span /><span /><span /><span /><span />
                  </span>
                  <strong>
                    {selectedSecondary?.media.staged_available
                      ? "GIF IMPORTADO · VISUALIZACIÓN BLOQUEADA"
                      : "VIDEO PENDIENTE"}
                  </strong>
                  <p>
                    {selectedSecondary?.media.staged_available
                      ? "El archivo está preparado localmente. Se habilitará únicamente al confirmar la licencia de visualización."
                      : "Cuando se vincule una referencia aprobada al catálogo, aparecerá aquí. No se sustituye por material de terceros sin licencia."}
                  </p>
                </div>
              )}

              <dl className="media-facts">
                <DataPair
                  label="Vistas recomendadas"
                  value={selected.preferred_views.map((view) => viewLabel[view] ?? view).join(" · ")}
                />
                <DataPair
                  label="Implementos"
                  value={
                    selected.required_equipment.length
                      ? selected.required_equipment.join(" · ").replaceAll("_", " ")
                      : "Sin implemento"
                  }
                />
                <DataPair label="Madurez" value={selected.maturity_label} />
              </dl>
            </div>

            <div className="library-knowledge">
              <section>
                <TechnicalLabel as="h4">Criterios observables</TechnicalLabel>
                {selected.criteria.length ? (
                  <ol className="criteria-list">
                    {selected.criteria.map((criterion) => (
                      <li key={criterion}>{criterion}</li>
                    ))}
                  </ol>
                ) : (
                  <NotEvaluable title="SIN CRITERIOS APROBADOS">
                    La biblioteca no completa la técnica por inferencia.
                  </NotEvaluable>
                )}
              </section>

              {selected.rules.length > 0 && (
                <section>
                  <TechnicalLabel as="h4">Errores que puede explicar el motor</TechnicalLabel>
                  <div className="rule-list">
                    {selected.rules.map((rule) => (
                      <Disclosure
                        key={rule.id}
                        summary={rule.description}
                        meta={rule.severity ?? undefined}
                      >
                        {rule.correction ? (
                          <p>
                            <strong>Corrección:</strong> {rule.correction}
                          </p>
                        ) : (
                          <p className="rule-no-correction">Sin corrección declarada.</p>
                        )}
                      </Disclosure>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <TechnicalLabel as="h4">Referencias técnicas</TechnicalLabel>
                {selected.sources.length ? (
                  <ul className="source-list">
                    {selected.sources.map((source, index) => (
                      <li key={`${source.filename}-${index}`}>
                        <span className="source-name">{source.filename}</span>
                        <span className="source-location">
                          {sourceLocation(source.pages, source.section)}
                        </span>
                        <span className="source-kind">{source.evidence_kind.replaceAll("_", " ")}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <NotEvaluable title="FUENTE PRIMARIA PENDIENTE">
                    No hay referencia aprobada vinculada a este ejercicio.
                  </NotEvaluable>
                )}
              </section>

              {selected.secondary_sources.length > 0 && (
                <section>
                  <TechnicalLabel as="h4">Catálogo secundario</TechnicalLabel>
                  <p className="secondary-boundary">
                    Esta capa no modifica estándares, reglas ni umbrales
                    biomecánicos. Las variantes pendientes se mantienen aisladas
                    hasta tener fuente primaria y benchmark.
                  </p>
                  <div className="secondary-list">
                    {selected.secondary_sources.map((source) => (
                      <Disclosure
                        key={`${source.source}-${source.source_exercise_id}-${source.standard_variant}`}
                        summary={
                          <>
                            <strong>{source.name}</strong>
                            <small>
                              {categoryLabel[source.discipline]} ·{" "}
                              {source.standard_variant.replaceAll("_", " ")}
                            </small>
                          </>
                        }
                        meta={
                          <StateBadge
                            tone={source.review_status === "variant_candidate" ? "uncertain" : "evaluable"}
                            pattern={source.review_status === "variant_candidate" ? "hatched" : "solid"}
                          >
                            {source.review_status === "variant_candidate" ? "Variante candidata" : "Revisada"}
                          </StateBadge>
                        }
                      >
                        <p>{source.instructions_es ?? "Sin instrucciones en español."}</p>
                        {source.instruction_steps_es.length > 0 && (
                          <ol className="secondary-steps">
                            {source.instruction_steps_es.map((step) => (
                              <li key={step}>{step}</li>
                            ))}
                          </ol>
                        )}
                        {source.review_note && <p className="secondary-note">{source.review_note}</p>}
                        <a href={source.source_url} target="_blank" rel="noreferrer">
                          Ver registro de origen
                        </a>
                        <small className="secondary-media-state">
                          {source.media.staged_available ? "GIF preparado localmente" : "GIF aún no descargado"}
                          {" · "}
                          {source.media.display_enabled
                            ? "visualización habilitada"
                            : "licencia de visualización pendiente"}
                        </small>
                      </Disclosure>
                    ))}
                  </div>
                </section>
              )}

              <section className="benchmark-block">
                <TechnicalLabel as="h4">Benchmark biomecánico</TechnicalLabel>
                <dl>
                  <DataPair label="Clips correctos" value={selected.benchmark.correct_clips} />
                  <DataPair
                    label="Clips con error intencional"
                    value={selected.benchmark.intentional_error_clips}
                  />
                </dl>
                {selected.benchmark.intentional_errors_pending.length > 0 && (
                  <Disclosure summary="Pendiente: grabar errores intencionales">
                    <p>
                      {selected.benchmark.intentional_errors_pending
                        .map((item) => item.replaceAll("_", " "))
                        .join(" · ")}
                    </p>
                  </Disclosure>
                )}
              </section>
            </div>
          </div>
        </article>
      )}
    </section>
  );
}
