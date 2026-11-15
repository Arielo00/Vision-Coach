/* ---------------------------------------------------------------------------
   07 · Estado técnico del sistema.

   Dos superficies que NO se mezclan:

   · Disponibilidad en vivo — se sondea de verdad (`/api/health`,
     `/api/llm/models`). Mientras no llega la respuesta, el estado es
     "CONSULTANDO", nunca "disponible".

   · Capacidad declarada — manifiesto curado y versionado del backend
     (`/api/pipeline/status`). Dice qué está construido y con qué límite. No es
     una lectura en tiempo real y se etiqueta como tal.

   Cada subsistema se presenta por separado: estimador de pose, detector de
   equipo, tracking, clasificador, motor de reglas, recuperación, almacén
   vectorial y generación de texto. Nunca como "el modelo de IA".

   Deliberadamente ausente: cualquier control de sensibilidad de reglas o de
   selección de proveedor de embeddings. La API no expone esa configuración y
   fabricar el control sugeriría que se pueden mover umbrales biomecánicos.
   --------------------------------------------------------------------------- */

import type { CatalogCoveragePayload, HealthStatus, LLMModelsResponse, PipelineStatus } from "../types";
import Disclosure from "./Disclosure";
import { AvailabilityChip, DataPair, NotEvaluable, StateBadge, TechnicalLabel } from "./StatusAtoms";
import {
  SUBSYSTEM_GROUP_LABELS,
  backendAvailability,
  processingLocality,
  providerAvailability,
  subsystemsFromPipeline,
} from "./presentationAdapters";
import type { SubsystemStatus } from "./uiTypes";

interface SystemStatusPanelProps {
  apiUrl: string;
  backendOnline: boolean | null;
  health: HealthStatus | null;
  pipeline: PipelineStatus | null;
  models: LLMModelsResponse | null;
  coverage: CatalogCoveragePayload | null;
}

export default function SystemStatusPanel({
  apiUrl,
  backendOnline,
  health,
  pipeline,
  models,
  coverage,
}: SystemStatusPanelProps) {
  const locality = processingLocality(apiUrl, health);
  const subsystems = subsystemsFromPipeline(pipeline);
  const grouped = subsystems.reduce<Record<string, SubsystemStatus[]>>((accumulator, item) => {
    (accumulator[item.group] ??= []).push(item);
    return accumulator;
  }, {});

  const coverageCount = coverage ? Object.keys(coverage.exercises).length : null;

  return (
    <section className="system-panel" aria-label="Estado técnico del sistema">
      <header className="system-header">
        <TechnicalLabel>04 · Estado técnico</TechnicalLabel>
        <h2>Qué está midiendo este equipo</h2>
      </header>

      {/* --- Disponibilidad en vivo ------------------------------------- */}
      <section className="system-block" aria-labelledby="system-live">
        <div className="system-block-head">
          <TechnicalLabel as="h3">Estado consultado</TechnicalLabel>
          <p id="system-live">
            Cada indicador espera respuesta antes de afirmar nada. El grado de
            comprobación no es el mismo en todos: el backend y Ollama se
            contactan de verdad; de Google solo se comprueba que exista la
            credencial configurada.
          </p>
        </div>

        <div className="availability-grid">
          <AvailabilityChip
            name="Backend local"
            state={backendAvailability(backendOnline, health)}
            probe="contactado"
          />
          <AvailabilityChip
            name="Ollama (texto local)"
            state={providerAvailability(models, "ollama")}
            probe="contactado"
          />
          <AvailabilityChip
            name="Google GenAI (texto remoto)"
            state={providerAvailability(models, "google")}
            probe="solo configuración"
          />
        </div>

        <div className={`locality-card tone-${locality.tone}`}>
          <StateBadge tone={locality.tone} pattern="solid">
            {locality.label}
          </StateBadge>
          <p>{locality.detail}</p>
          <dl className="locality-facts">
            <DataPair label="Destino configurado" value={<code>{locality.host}</code>} />
            <DataPair label="Almacenamiento" value={locality.storage ?? "No reportado"} />
            <DataPair label="Alcance" value={locality.scope ?? "No reportado"} />
            <DataPair
              label="GPU reportada"
              value={
                locality.gpuAvailable == null
                  ? "No reportado"
                  : locality.gpuAvailable
                    ? "Disponible"
                    : "No disponible"
              }
              tone={locality.gpuAvailable ? "evaluable" : "unavailable"}
            />
          </dl>
        </div>

        {models?.message && (
          <Disclosure summary="Mensaje del proveedor de texto" tone="uncertain">
            <p className="provider-raw-message">{models.message}</p>
          </Disclosure>
        )}
      </section>

      {/* --- Capacidad declarada ---------------------------------------- */}
      <section className="system-block" aria-labelledby="system-declared">
        <div className="system-block-head">
          <TechnicalLabel as="h3">Capacidad declarada</TechnicalLabel>
          <p id="system-declared">
            Manifiesto del backend
            {pipeline ? ` · esquema v${pipeline.schema_version} · alcance ${pipeline.scope}` : ""}.
            Describe qué está construido y con qué límite. No es una lectura en
            tiempo real.
          </p>
        </div>

        {subsystems.length === 0 ? (
          <NotEvaluable title="MANIFIESTO NO DISPONIBLE">
            El backend no entregó el mapa de capacidades.
          </NotEvaluable>
        ) : (
          <div className="subsystem-groups">
            {(Object.keys(SUBSYSTEM_GROUP_LABELS) as Array<SubsystemStatus["group"]>)
              .filter((group) => grouped[group]?.length)
              .map((group) => (
                <section key={group} className="subsystem-group">
                  <TechnicalLabel as="h4">{SUBSYSTEM_GROUP_LABELS[group]}</TechnicalLabel>
                  <ul>
                    {grouped[group].map((item) => (
                      <li key={item.id}>
                        <article className={`subsystem-card tone-${item.declared.tone}`}>
                          <header>
                            <strong>{item.label}</strong>
                            <StateBadge
                              tone={item.declared.tone}
                              pattern={item.declared.partial ? "hatched" : "solid"}
                            >
                              {item.declared.label}
                            </StateBadge>
                          </header>
                          {item.limitation && <p className="subsystem-limitation">{item.limitation}</p>}
                          {item.evidence.length > 0 && (
                            <Disclosure summary="Evidencia" meta={`${item.evidence.length}`}>
                              <ul className="subsystem-evidence">
                                {item.evidence.map((entry) => (
                                  <li key={entry}>
                                    <code>{entry}</code>
                                  </li>
                                ))}
                              </ul>
                            </Disclosure>
                          )}
                        </article>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </section>

      {/* --- Cobertura del catálogo -------------------------------------- */}
      <section className="system-block" aria-labelledby="system-coverage">
        <div className="system-block-head">
          <TechnicalLabel as="h3">Cobertura del catálogo</TechnicalLabel>
          <p id="system-coverage">
            Niveles de madurez por ejercicio, tal como los reporta el backend.
          </p>
        </div>
        {coverage ? (
          <>
            <DataPair label="Ejercicios con cobertura declarada" value={coverageCount ?? "—"} />
            <dl className="maturity-legend">
              {Object.entries(coverage.maturity_levels).map(([key, label]) => (
                <div key={key}>
                  <dt>
                    <code>{key}</code>
                  </dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <NotEvaluable title="COBERTURA NO DISPONIBLE">
            No se pudo consultar la cobertura por ejercicio.
          </NotEvaluable>
        )}
      </section>

      <p className="system-absent-note">
        Esta pantalla no ofrece control de sensibilidad de reglas ni selección de
        proveedor de embeddings: la API no expone esa configuración y un control
        así sugeriría que se pueden mover umbrales biomecánicos desde la
        interfaz.
      </p>
    </section>
  );
}
