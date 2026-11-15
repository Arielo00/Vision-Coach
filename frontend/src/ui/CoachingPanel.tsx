/* ---------------------------------------------------------------------------
   04·E · Coaching del modelo de lenguaje.

   Frontera declarada explícitamente en la interfaz, no solo en la documentación:
   el modelo recibe el diagnóstico ya calculado por las reglas y fragmentos de
   texto recuperados. No ve el video, no ve los keypoints y no decide si una
   repetición es correcta.

   Los modelos disponibles pueden llamarse "gemma-4-*". Son modelos de TEXTO.
   La revisión visual multimodal de segunda opinión no está implementada y esta
   pantalla no debe sugerir lo contrario.
   --------------------------------------------------------------------------- */

import type { CoachingResult, LLMModelsResponse } from "../types";
import Disclosure from "./Disclosure";
import KnowledgeSourceLocation from "./KnowledgeSourceLocation";
import { knowledgeSourceKind } from "./knowledgeSources";
import { SourceTag, StateBadge, TechnicalLabel } from "./StatusAtoms";
import type { Tone } from "./uiTypes";

const STATUS_PRESENTATION: Record<
  CoachingResult["status"],
  { label: string; tone: Tone; detail: string }
> = {
  generated: {
    label: "GENERADO POR MODELO",
    tone: "evaluable",
    detail: "El texto se produjo con el modelo seleccionado sobre el diagnóstico determinista.",
  },
  fallback_no_llm: {
    label: "RESPALDO SIN MODELO",
    tone: "uncertain",
    detail: "No hubo modelo disponible. El texto proviene directamente del motor de reglas.",
  },
  fallback_no_rag: {
    label: "RESPALDO SIN RECUPERACIÓN",
    tone: "uncertain",
    detail: "No hubo contexto documental recuperado. El texto proviene del motor de reglas.",
  },
  fallback_ungrounded: {
    label: "RESPALDO POR FALTA DE CITAS",
    tone: "uncertain",
    detail:
      "La respuesta del modelo no citó fuentes verificables, así que se entregó el texto determinista.",
  },
  fallback_no_evaluable_repetitions: {
    label: "SIN REPETICIONES EVALUABLES",
    tone: "uncertain",
    detail: "No hay evidencia suficiente para generar orientación sobre la técnica. Revisa la vista y las articulaciones visibles.",
  },
};

interface CoachingPanelProps {
  models: LLMModelsResponse | null;
  selectedModel: string;
  onSelectModel: (value: string) => void;
  allowRemote: boolean;
  onAllowRemoteChange: (value: boolean) => void;
  allowRemoteEmbeddings: boolean;
  onAllowRemoteEmbeddingsChange: (value: boolean) => void;
  coaching: CoachingResult | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
}

export default function CoachingPanel({
  models,
  selectedModel,
  onSelectModel,
  allowRemote,
  onAllowRemoteChange,
  allowRemoteEmbeddings,
  onAllowRemoteEmbeddingsChange,
  coaching,
  loading,
  error,
  onGenerate,
}: CoachingPanelProps) {
  const chatModels = models?.items.filter((item) => item.kind === "chat") ?? [];
  const selectedInfo = models?.items.find((item) => item.id === selectedModel);
  const remoteRequiresConsent = Boolean(selectedInfo?.remote && !allowRemote);
  const status = coaching ? STATUS_PRESENTATION[coaching.status] : null;

  return (
    <section className="rail-section coaching-section" aria-labelledby="rail-coaching">
      <header className="rail-section-head">
        <span className="rail-step" aria-hidden="true">E</span>
        <div>
          <TechnicalLabel>Coaching del modelo</TechnicalLabel>
          <h3 id="rail-coaching">Explicación redactada</h3>
        </div>
        <SourceTag source="generado" />
      </header>

      <p className="coaching-boundary">
        El modelo redacta y organiza los hallazgos que ya produjeron las reglas
        deterministas. Recibe texto: el diagnóstico calculado y fragmentos
        recuperados de los documentos. <strong>No analiza el video ni los
        keypoints</strong>, y no determina si una repetición es correcta.
      </p>

      <div className="coaching-controls">
        <label className="model-selector">
          <TechnicalLabel>Modelo de texto</TechnicalLabel>
          <select
            value={selectedModel}
            onChange={(event) => {
              onSelectModel(event.target.value);
              onAllowRemoteChange(false);
            }}
            disabled={!models?.available}
          >
            {chatModels.map((item) => (
              <option value={item.id} key={item.id} disabled={!item.available}>
                {item.name} · {item.remote ? "Google remoto" : "Ollama local"}
                {!item.available ? " · requiere clave" : ""}
              </option>
            ))}
            {!models?.available && (
              <option value={selectedModel}>{selectedModel || "Sin modelo disponible"}</option>
            )}
          </select>
        </label>

        <button
          type="button"
          className="coaching-generate"
          onClick={onGenerate}
          disabled={loading || remoteRequiresConsent}
        >
          {loading ? "Generando…" : coaching ? "Regenerar" : "Generar coaching"}
        </button>
      </div>

      <div className="remote-consent">
        <label className="remote-consent-check">
          <input type="checkbox" checked={allowRemoteEmbeddings}
            onChange={(event) => onAllowRemoteEmbeddingsChange(event.target.checked)} />
          <span>Permitir que Google Embedding procese la consulta de búsqueda documental.</span>
        </label>
        <p>La consulta contiene el ejercicio y los hallazgos técnicos. Sin este permiso, se usan vectores ya guardados o recuperación local. Este permiso es independiente del modelo de coaching.</p>
      </div>

      {models && !models.available && (
        <div className="coaching-provider-note">
          <StateBadge tone="uncertain" pattern="dashed">
            SIN MODELO DISPONIBLE
          </StateBadge>
          <p>
            {models.message ??
              "No hay proveedor de texto disponible en este momento."}{" "}
            El botón entregará el texto determinista del motor de reglas.
          </p>
        </div>
      )}

      {selectedInfo?.remote && (
        <div className="remote-consent">
          <StateBadge tone="uncertain" pattern="hatched">
            PROCESAMIENTO EXTERNO
          </StateBadge>
          <p>
            Google recibirá el diagnóstico textual y hasta cuatro fragmentos
            recuperados de los PDF. No se enviarán video, imágenes, keypoints ni
            rutas de archivos.
          </p>
          <label className="remote-consent-check">
            <input
              type="checkbox"
              checked={allowRemote}
              onChange={(event) => onAllowRemoteChange(event.target.checked)}
            />
            <span>Confirmo el envío de estos datos textuales a Google GenAI.</span>
          </label>
          {remoteRequiresConsent && (
            <p className="remote-consent-blocked">
              La generación está detenida hasta que confirmes el envío.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}

      {coaching && status && (
        <div className="coaching-result">
          <div className="coaching-status">
            <StateBadge tone={status.tone} pattern={coaching.status === "generated" ? "solid" : "dashed"}>
              {status.label}
            </StateBadge>
            <span>{status.detail}</span>
            {coaching.model && <code>{coaching.model}</code>}
          </div>

          <p className="coaching-summary">{coaching.summary}</p>

          <div className={`rag-audit ${coaching.rag_trace.grounded ? "is-grounded" : "is-unverified"}`}>
            <StateBadge
              tone={coaching.rag_trace.grounded ? "evaluable" : "uncertain"}
              pattern={coaching.rag_trace.grounded ? "solid" : "hatched"}
            >
              {coaching.rag_trace.grounded ? "IDENTIFICADORES DE CITAS VÁLIDOS" : "SIN CITAS VERIFICABLES"}
            </StateBadge>
            <dl>
              <div>
                <dt>Fragmentos enviados</dt>
                <dd>{coaching.rag_trace.chunks_sent.length}</dd>
              </div>
              <div>
                <dt>Citas válidas</dt>
                <dd>{coaching.rag_trace.citations_returned.length}</dd>
              </div>
              <div>
                <dt>Procesamiento</dt>
                <dd>{coaching.rag_trace.remote ? "Proveedor remoto" : "Local"}</dd>
              </div>
            </dl>
            <code className="rag-hash" title="Huella del contexto enviado al modelo">
              {coaching.rag_trace.context_sha256.slice(0, 16)}
            </code>
          </div>

          <p className="coaching-authority-note">
            Se comprueba que las citas apunten a fragmentos enviados; todavía no
            se verifica que respalden cada afirmación. El resumen conserva los
            resultados de las reglas y la primera corrección de cada hallazgo
            proviene de ellas. Las sugerencias adicionales requieren revisión.
          </p>

          {coaching.repetitions.filter((rep) => rep.corrections.length > 0).length > 0 && (
            <div className="coaching-repetitions">
              {coaching.repetitions
                .filter((rep) => rep.corrections.length > 0)
                .map((rep) => (
                  <article key={rep.number}>
                    <strong>Repetición {rep.number}</strong>
                    <ul>
                      {rep.corrections.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    {rep.progressions_suggested.map((item) => (
                      <p key={item} className="coaching-progression">
                        Progresión: {item}
                      </p>
                    ))}
                  </article>
                ))}
            </div>
          )}

          {coaching.general_recommendations.length > 0 && (
            <div className="coaching-general">
              <TechnicalLabel as="h4">Recomendaciones generales</TechnicalLabel>
              <ul>
                {coaching.general_recommendations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {coaching.sources.length > 0 && (
            <Disclosure summary="Fuentes utilizadas como contexto" meta={`${coaching.sources.length}`}>
              <ul className="coaching-sources">
                {coaching.sources.map((source, index) => (
                  <li key={`${source.filename}-${source.page}-${source.start_seconds}-${index}`}>
                    {source.title ?? source.filename} · <KnowledgeSourceLocation source={source} />
                    {knowledgeSourceKind(source) && <> · {knowledgeSourceKind(source)}</>}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}

          <p className="coaching-safety">{coaching.safety_notice}</p>
        </div>
      )}
    </section>
  );
}
