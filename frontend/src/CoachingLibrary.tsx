import { useEffect, useId, useState } from "react";

import { API_URL, getCoachingLibrary } from "./api";
import type { CoachingCollection, CoachingLibraryPayload } from "./types";
import Disclosure from "./ui/Disclosure";
import { normalizeForSearch } from "./ui/text";

const statusLabel = {
  indexed_reviewed: "Pasajes revisados disponibles para coaching",
  pending_review: "Transcripción pendiente de revisión para coaching",
  pending_transcript: "Transcripción pendiente para coaching",
};

function CollectionVideos({ collection }: { collection: CoachingCollection }) {
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const selectId = useId();
  const needle = normalizeForSearch(query);
  const videos = collection.videos.filter((video) => normalizeForSearch(video.title).includes(needle));
  const selected = videos.find((video) => video.id === selectedId) ?? videos[0];
  return (
    <div className="library-media">
      <p>{collection.publisher} · {collection.video_count} videos locales · {collection.indexed_video_count} con pasajes revisados.</p>
      <a href={collection.playlist_url} target="_blank" rel="noreferrer">Ver playlist original</a>
      {collection.videos.length > 0 ? (
        <>
          <label>
            Buscar en esta colección
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="Nombre del video…" />
          </label>
          <label htmlFor={selectId}>Video completo</label>
          <select id={selectId} value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} disabled={!videos.length}>
            {videos.length ? videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>) : <option value="">Sin coincidencias</option>}
          </select>
          {selected && (
            <>
              <video key={selected.id} controls preload="metadata" src={`${API_URL}${selected.url}`} aria-label={selected.title}>
                Tu navegador no puede reproducir este formato de video.
              </video>
              <div className="media-attribution">
                <span>{statusLabel[selected.coaching_status]}</span>
                {selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer">Ver en YouTube</a>}
              </div>
              <p className="secondary-boundary">Estos videos pueden mostrar errores intencionales, correcciones y progresiones. Los pasajes revisados conservan esa distinción al orientar al usuario.</p>
            </>
          )}
        </>
      ) : <p>La colección está registrada. Aún no hay videos locales disponibles.</p>}
    </div>
  );
}

export default function CoachingLibrary() {
  const [payload, setPayload] = useState<CoachingLibraryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getCoachingLibrary().then((result) => { if (active) setPayload(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "No se pudo cargar la colección."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  return (
    <Disclosure summary="Videos de coaching" meta={payload ? `${payload.items.reduce((count, item) => count + item.video_count, 0)} locales` : undefined}>
      <div className="library-media">
        <p>Videos completos para aprender, con búsqueda interna por pasajes revisados en el coaching.</p>
        <div className="media-selector">
          <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>{loading ? "Actualizando…" : "Actualizar videos disponibles"}</button>
        </div>
        {error && <p role="alert">{error}</p>}
        {payload?.issues.map((issue) => <p key={issue} role="alert">No se pudo leer una colección: {issue}</p>)}
        {payload?.items.map((collection) => (
          <Disclosure key={collection.id} summary={collection.title} defaultOpen>
            <CollectionVideos collection={collection} />
          </Disclosure>
        ))}
      </div>
    </Disclosure>
  );
}
