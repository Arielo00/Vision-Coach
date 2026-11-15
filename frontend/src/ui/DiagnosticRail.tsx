/* ---------------------------------------------------------------------------
   04 · Riel de diagnóstico y coaching.

   Jerarquía de evidencia, en este orden y sin excepción:
     A. Resultado de reglas deterministas
     B. Evidencia visual y confianza medida
     C. Correcciones
     D. Fuentes recuperadas
     E. Coaching del modelo

   El resultado determinista siempre precede al texto generado. El modelo de
   lenguaje traduce y organiza hallazgos; no decide si una repetición es
   correcta, y la interfaz lo refleja en el orden y en el etiquetado.

   Ningún hallazgo se oculta por razones de maquetación: los de severidad
   "riesgo" se muestran siempre y el resto es accesible con un control
   explícito.
   --------------------------------------------------------------------------- */

import { memo, useMemo, useState, type ReactNode } from "react";

import type { BiomechanicsError, BiomechanicsResult } from "../types";
import { exerciseLabel } from "../exerciseCatalog";
import Disclosure from "./Disclosure";
import KnowledgeSourceLocation from "./KnowledgeSourceLocation";
import { knowledgeSourceKind } from "./knowledgeSources";
import { DataPair, NotEvaluable, SourceTag, StateBadge, TechnicalLabel } from "./StatusAtoms";
import { FEATURE_LABELS, jointLabel, metricLabel, metricValue } from "./metricLabels";
import {
  classificationState,
  confidenceReading,
  humanizeKey,
  phaseAtFrame,
  repetitionCounts,
  repetitionState,
  retrievalState,
  severityPresentation,
} from "./presentationAdapters";
import type { EquipmentCapabilityState } from "./uiTypes";

const INITIAL_NON_RISK_FINDINGS = 3;
export const RULE_LABELS: Record<string, string> = {
  depth: "Profundidad proyectada", lockout: "Extensión final", torso_lean: "Inclinación del tronco",
  knee_asymmetry: "Simetría proyectada de rodillas", overhead_stability: "Posición de ambas muñecas",
  incomplete_pull: "Recorrido del tirón", incomplete_extension: "Extensión de brazos",
  kipping: "Variación de cadera", elbow_asymmetry: "Simetría proyectada de codos",
  leg_initiated_swing: "Orden de movimiento de hombros y cadera", missing_push_away: "Separación tras el tirón",
  excessive_swing_core_loss: "Amplitud de balanceo", bent_knees_loose_body: "Flexión de rodillas durante el ciclo",
  full_extension: "Extensión de piernas", overhead_release: "Muñecas elevadas en el lanzamiento",
  target_miss: "Contacto físico con el blanco", insufficient_depth: "Recorrido del descenso",
  excessive_shoulder_depth: "Ángulo entre brazo y tronco", incomplete_support: "Regreso al soporte",
  leg_height: "Posición de piernas", bent_knees: "Extensión de rodillas", soft_support: "Extensión de codos",
  excessive_dip: "Recorrido del dip", dip_torso_lean: "Tronco durante el dip", early_press: "Coordinación piernas y brazos",
  knee_rebend: "Flexión de rodillas tras el impulso", hip_extension: "Extensión de cadera",
  arm_bend: "Flexión de codos", squat_dominant: "Flexión de rodilla en la bisagra",
  russian_height: "Altura de muñecas, swing ruso", american_height: "Altura de muñecas, swing americano",
};

interface Finding {
  issue: BiomechanicsError;
  repetitionNumber: number;
  repetitionConfidence: number;
  phaseLabel: string | null;
  phaseDerived: boolean;
  seekFrame: number | null;
}

interface DiagnosticRailProps {
  diagnostics: BiomechanicsResult;
  equipment: EquipmentCapabilityState;
  onSeekToFrame: (frame: number) => void;
  exercisePickerSlot: ReactNode;
  changingExercise: boolean;
  coachingSlot: ReactNode;
}

function DiagnosticRailBase({
  diagnostics,
  equipment,
  onSeekToFrame,
  exercisePickerSlot,
  changingExercise,
  coachingSlot,
}: DiagnosticRailProps) {
  const [showAllFindings, setShowAllFindings] = useState(false);

  const findings = useMemo<Finding[]>(() => {
    const collected: Finding[] = [];
    diagnostics.repetitions.forEach((rep) => {
      rep.errors.forEach((issue) => {
        const frame = issue.frames[0] ?? null;
        const phase = frame == null ? null : phaseAtFrame(rep, frame);
        collected.push({
          issue,
          repetitionNumber: rep.number,
          repetitionConfidence: rep.confidence,
          phaseLabel: phase?.label ?? null,
          phaseDerived: phase?.derived ?? false,
          seekFrame: frame,
        });
      });
    });
    return collected.sort((a, b) => {
      const weight =
        severityPresentation(b.issue.severity).weight - severityPresentation(a.issue.severity).weight;
      return weight !== 0 ? weight : a.repetitionNumber - b.repetitionNumber;
    });
  }, [diagnostics]);

  const riskFindings = findings.filter((item) => item.issue.severity === "riesgo");
  const otherFindings = findings.filter((item) => item.issue.severity !== "riesgo");
  const visibleFindings = showAllFindings
    ? findings
    : [...riskFindings, ...otherFindings.slice(0, INITIAL_NON_RISK_FINDINGS)];
  const hiddenCount = findings.length - visibleFindings.length;

  const retrieval = retrievalState(diagnostics.knowledge_status);

  /**
   * Conteo derivado de `repetitions[]`, no de `summary`.
   *
   * El agregado del backend calcula `incorrectas = detectadas − correctas`, así
   * que una repetición no evaluable (`valid:false`, y por tanto `correct:false`)
   * queda contada como incorrecta. Mostrar ese campo junto a un conteo propio de
   * abstenciones haría que la misma repetición apareciera dos veces.
   *
   * Estos tres cubos son excluyentes y suman el total de repeticiones.
   */
  const counts = useMemo(() => repetitionCounts(diagnostics.repetitions), [diagnostics]);

  const notEvaluable = counts.nonEvaluable;
  /** El agregado del backend y el conteo por repetición discrepan al abstenerse. */
  const aggregateConflates =
    notEvaluable > 0 && diagnostics.summary.incorrect_repetitions !== counts.review;

  const classification = useMemo(
    () => classificationState(diagnostics.exercise, diagnostics.exercise_confidence),
    [diagnostics.exercise, diagnostics.exercise_confidence],
  );

  return (
    <div className="diagnostic-rail">
      {/* ---- A · Resultado de reglas ------------------------------------- */}
      <section className="rail-section" aria-labelledby="rail-rules">
        <header className="rail-section-head">
          <span className="rail-step" aria-hidden="true">A</span>
          <div>
            <TechnicalLabel>Resultado de reglas</TechnicalLabel>
            <h3 id="rail-rules">{exerciseLabel(diagnostics.exercise)}</h3>
          </div>
          <SourceTag source="regla" />
        </header>

        <div className="rules-summary">
          <DataPair label="Repeticiones" value={counts.total} />
          <DataPair label="Sin hallazgos" value={counts.correct} tone="evaluable" />
          <DataPair label="Por revisar" value={counts.review} tone="technical" />
          <DataPair label="No evaluables" value={counts.nonEvaluable} tone="uncertain" />
        </div>

        <p className="evaluation-limits">El resultado resume las reglas de pose que esta vista permite evaluar. Los umbrales son provisionales; no certifican seguridad física ni validez competitiva.</p>

        {diagnostics.repetitions.some((rep) => rep.rule_evaluations) && (
          <Disclosure summary="Qué pudo comprobarse por repetición">
            {diagnostics.repetitions.map((rep) => (
              <div key={rep.number}>
                <strong>Repetición {rep.number}</strong>
                <ul>
                  {Object.entries(rep.rule_evaluations ?? {}).map(([rule, evaluation]) => (
                    <li key={rule}>
                      {RULE_LABELS[rule] ?? humanizeKey(rule)}: {evaluation.status === "not_evaluable" ? "no comprobable" : evaluation.status === "fail" ? "hallazgo observado" : "sin hallazgo"}.
                      {evaluation.reason && ` ${evaluation.reason}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Disclosure>
        )}

        {aggregateConflates && (
          <p className="aggregate-note">
            El resumen agregado y el detalle por repetición no coinciden. Se muestran los conteos del detalle, que separan las{" "}
            {counts.nonEvaluable === 1
              ? "repetición no evaluable"
              : `${counts.nonEvaluable} repeticiones no evaluables`}
            . Las abstenciones no cuentan como errores técnicos.
          </p>
        )}

        <div className="rail-exercise-override">
          <TechnicalLabel>
            Ejercicio aplicado{changingExercise ? " · actualizando…" : ""}
          </TechnicalLabel>
          {exercisePickerSlot}
        </div>

        {diagnostics.exercise_source === "automatic" && (
          <div className="classification-block">
            <div className="classification-head">
              <StateBadge tone={classification.tone} pattern={classification.pattern}>
                {classification.label}
              </StateBadge>
            </div>
            {classification.caveat && (
              <p className="classification-caveat">{classification.caveat}</p>
            )}
            <p className="classification-reason">{diagnostics.classification_reason}</p>
            {diagnostics.classification_candidates && diagnostics.classification_candidates.length > 0 && (
              <ol className="classification-candidates" aria-label="Candidatos de clasificación">
                {diagnostics.classification_candidates.map((candidate) => (
                  <li key={candidate.exercise}>
                    <span>{exerciseLabel(candidate.exercise)}</span>
                    <strong>{Math.round(candidate.confidence * 100)}%</strong>
                  </li>
                ))}
              </ol>
            )}
            {diagnostics.classification_features && (
              <Disclosure summary="Evidencia temporal usada">
                <dl className="feature-grid">
                  {Object.entries(diagnostics.classification_features).map(([key, value]) => (
                    <div key={key}>
                      <dt>{FEATURE_LABELS[key] ?? humanizeKey(key)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </Disclosure>
            )}
          </div>
        )}

        {diagnostics.warnings.length > 0 && (
          <div className="evaluation-limits">
            <TechnicalLabel as="h4">Límites de esta evaluación</TechnicalLabel>
            <ul>
              {diagnostics.warnings.map((warning) => (
                <li key={warning}>
                  <span className="limit-mark" aria-hidden="true" />
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---- B · Evidencia visual y confianza ----------------------------- */}
      <section className="rail-section" aria-labelledby="rail-evidence">
        <header className="rail-section-head">
          <span className="rail-step" aria-hidden="true">B</span>
          <div>
            <TechnicalLabel>Evidencia visual</TechnicalLabel>
            <h3 id="rail-evidence">Qué pudo observar el detector</h3>
          </div>
          <SourceTag source="medicion" />
        </header>

        <div className={`capability-boundary tone-${equipment.tone}`}>
          <div className="capability-boundary-head">
            <StateBadge tone={equipment.tone} pattern="hatched">
              {equipment.label}
            </StateBadge>
            {equipment.model && <code>{equipment.model}</code>}
          </div>
          <p>{equipment.detail}</p>
        </div>

        {diagnostics.equipment ? (
          <div className="equipment-evidence">
            <DataPair
              label="Equipo requerido"
              value={
                diagnostics.equipment.required.length
                  ? diagnostics.equipment.required.map(humanizeKey).join(", ")
                  : "Por definir"
              }
            />
            <DataPair
              label="Equipo observado"
              value={
                diagnostics.equipment.detected.length
                  ? diagnostics.equipment.detected.map(humanizeKey).join(", ")
                  : "Ninguno"
              }
              tone={diagnostics.equipment.detected.length ? "evaluable" : "unavailable"}
            />
            <p className="equipment-message">{diagnostics.equipment.message}</p>

            {diagnostics.equipment.trajectory ? (
              <Disclosure
                summary="Trayectoria observada"
                meta={`${diagnostics.equipment.trajectory.observations_total ?? diagnostics.equipment.trajectory.observations} obs.`}
              >
                <dl className="trajectory-grid">
                  <DataPair
                    label="Etiqueta"
                    value={humanizeKey(diagnostics.equipment.trajectory.label)}
                  />
                  <DataPair
                    label="Confianza media"
                    value={`${Math.round(diagnostics.equipment.trajectory.mean_confidence * 100)}%`}
                  />
                  <DataPair
                    label="Rango vertical"
                    value={`${(diagnostics.equipment.trajectory.vertical_range_frame_fraction * 100).toFixed(1)}% del cuadro`}
                  />
                  <DataPair
                    label="Cuadro pico"
                    value={diagnostics.equipment.trajectory.peak_frame}
                  />
                </dl>
              </Disclosure>
            ) : (
              <NotEvaluable title="SIN TRAYECTORIA REPORTADA">
                El motor no entregó un segmento de trayectoria para este análisis.
              </NotEvaluable>
            )}

            {diagnostics.equipment.contact_events && diagnostics.equipment.contact_events.length > 0 && (
              <div className="contact-events">
                <TechnicalLabel as="h4">Evidencia de contacto</TechnicalLabel>
                <ul>
                  {diagnostics.equipment.contact_events.map((contact) => (
                    <li key={`${contact.peak_frame}-${contact.kind}`}>
                      <button type="button" onClick={() => onSeekToFrame(contact.peak_frame)}>
                        <span className="contact-kind">{humanizeKey(contact.kind)}</span>
                        <span className="contact-frame">cuadro {contact.peak_frame}</span>
                        <span className="contact-confidence">
                          {Math.round(contact.confidence * 100)}%
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="contact-note">
                  Es una intersección 2D observada entre cajas detectadas, no una
                  medición física de impacto.
                </p>
              </div>
            )}
          </div>
        ) : (
          <NotEvaluable title="SIN EVIDENCIA DE EQUIPO">
            Este análisis no reportó información de implementos.
          </NotEvaluable>
        )}
      </section>

      {/* ---- C · Correcciones -------------------------------------------- */}
      <section className="rail-section" aria-labelledby="rail-findings">
        <header className="rail-section-head">
          <span className="rail-step" aria-hidden="true">C</span>
          <div>
            <TechnicalLabel>Correcciones</TechnicalLabel>
            <h3 id="rail-findings">
              {findings.length === 0
                ? "Sin hallazgos deterministas"
                : `${findings.length} hallazgo${findings.length === 1 ? "" : "s"}`}
            </h3>
          </div>
          <SourceTag source="regla" />
        </header>

        {findings.length === 0 ? (
          <NotEvaluable title="NINGÚN HALLAZGO EN LAS REPETICIONES EVALUADAS">
            {notEvaluable > 0
              ? `Cuidado: ${notEvaluable} repetición(es) no pudieron evaluarse, así que la ausencia de hallazgos no cubre toda la sesión.`
              : "El motor evaluó las repeticiones detectadas y no encontró desviaciones."}
          </NotEvaluable>
        ) : (
          <>
            <ol className="findings-list">
              {visibleFindings.map((finding) => {
                const severity = severityPresentation(finding.issue.severity);
                const confidence = confidenceReading(finding.repetitionConfidence);
                return (
                  <li key={`${finding.repetitionNumber}-${finding.issue.type}`}>
                    <article className={`finding-card tone-${severity.tone}`}>
                      <header>
                        <StateBadge tone={severity.tone} pattern={severity.pattern}>
                          {severity.label}
                        </StateBadge>
                        <span className="finding-rep">Rep. {finding.repetitionNumber}</span>
                        {finding.phaseLabel && (
                          <span className="finding-phase">
                            {finding.phaseLabel}
                            {finding.phaseDerived && <abbr title="Fase derivada de las anclas reportadas">*</abbr>}
                          </span>
                        )}
                      </header>
                      <h4>{finding.issue.description}</h4>
                      <dl className="finding-meta">
                        <DataPair
                          label="Articulaciones"
                          value={
                            finding.issue.joints.length
                              ? finding.issue.joints.map(jointLabel).join(", ")
                              : "No especificadas"
                          }
                        />
                        <DataPair
                          label="Confianza de la repetición"
                          value={confidence.display}
                          note={confidence.label}
                        />
                        <DataPair
                          label="Cuadros"
                          value={finding.issue.frames.length ? finding.issue.frames.length : "—"}
                        />
                      </dl>
                      <p className="finding-correction">{finding.issue.correction}</p>
                      {finding.seekFrame != null && (
                        <button
                          type="button"
                          className="finding-seek"
                          onClick={() => onSeekToFrame(finding.seekFrame as number)}
                        >
                          Ver cuadro {finding.seekFrame}
                        </button>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>

            {hiddenCount > 0 && (
              <button
                type="button"
                className="findings-expand"
                onClick={() => setShowAllFindings(true)}
              >
                VER TODOS LOS HALLAZGOS ({findings.length})
              </button>
            )}
            {showAllFindings && findings.length > INITIAL_NON_RISK_FINDINGS && (
              <button
                type="button"
                className="findings-expand is-collapse"
                onClick={() => setShowAllFindings(false)}
              >
                Mostrar solo los prioritarios
              </button>
            )}

            <p className="findings-scope-note">
              El motor entrega severidad, articulaciones implicadas y corrección por
              hallazgo. No reporta valor medido, rango esperado ni referencia
              documental a nivel de hallazgo; las mediciones disponibles se listan
              por repetición.
            </p>
          </>
        )}

        <Disclosure summary="Mediciones por repetición" className="repetition-metrics">
          <ol className="repetition-metric-list">
            {diagnostics.repetitions.map((rep) => {
              const state = repetitionState(rep);
              const confidence = confidenceReading(rep.confidence);
              const metrics = Object.entries(rep.metrics);
              return (
                <li key={rep.number}>
                  <div className="repetition-metric-head">
                    <strong>Repetición {rep.number}</strong>
                    <StateBadge tone={state.tone} pattern={state.pattern}>
                      {state.label}
                    </StateBadge>
                    <span>{confidence.display}</span>
                  </div>
                  {metrics.length ? (
                    <dl className="metric-grid">
                      {metrics.map(([key, value]) => (
                        <DataPair
                          key={key}
                          label={metricLabel(key)}
                          value={metricValue(key, value)}
                          tone={value == null ? "unavailable" : undefined}
                        />
                      ))}
                    </dl>
                  ) : (
                    <p className="metric-empty">Sin métricas reportadas.</p>
                  )}
                  {rep.warnings.map((warning) => (
                    <p className="repetition-warning" key={warning}>
                      {warning}
                    </p>
                  ))}
                </li>
              );
            })}
          </ol>
        </Disclosure>
      </section>

      {/* ---- D · Fuentes recuperadas ------------------------------------- */}
      <section className="rail-section" aria-labelledby="rail-sources">
        <header className="rail-section-head">
          <span className="rail-step" aria-hidden="true">D</span>
          <div>
            <TechnicalLabel>Fuentes recuperadas</TechnicalLabel>
            <h3 id="rail-sources">Fundamento documental</h3>
          </div>
          <SourceTag source="recuperacion" />
        </header>

        <div className={`retrieval-state tone-${retrieval.tone}`}>
          <StateBadge tone={retrieval.tone} pattern={retrieval.isFallback ? "dashed" : "solid"}>
            {retrieval.label}
          </StateBadge>
          <dl>
            <DataPair label="Proveedor" value={retrieval.provider ?? "No reportado"} />
            <DataPair label="Modelo" value={retrieval.model ?? "No reportado"} />
          </dl>
          {retrieval.message && <p className="retrieval-message">{retrieval.message}</p>}
        </div>

        {diagnostics.knowledge_context && diagnostics.knowledge_context.length > 0 ? (
          <ol className="knowledge-list">
            {diagnostics.knowledge_context.map((chunk) => (
              <li key={chunk.id}>
                <article>
                  <header>
                    <strong>{chunk.title ?? chunk.filename}</strong>
                    <KnowledgeSourceLocation source={chunk} />
                  </header>
                  <p>{chunk.text.length > 320 ? `${chunk.text.slice(0, 320)}…` : chunk.text}</p>
                  {knowledgeSourceKind(chunk) && <small>{knowledgeSourceKind(chunk)}</small>}
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <NotEvaluable title="SIN FRAGMENTOS RECUPERADOS">
            No se recuperó contexto documental para este diagnóstico.
          </NotEvaluable>
        )}
      </section>

      {/* ---- E · Coaching del modelo ------------------------------------- */}
      {coachingSlot}
    </div>
  );
}

export default memo(DiagnosticRailBase);
