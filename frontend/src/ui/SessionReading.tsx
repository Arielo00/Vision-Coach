/* ---------------------------------------------------------------------------
   Lectura de la sesión.

   Lo primero que se lee es el veredicto en una frase y, si falta un dato para
   evaluar, la pregunta que lo resuelve. Antes ese motivo aparecía al final de
   una lista de avisos y no había forma de corregirlo sin volver a subir el
   video.

   Debajo, tres pestañas:
   - Reglas: una tabla regla × repetición. Cada celda es el estado que devolvió
     el motor; cuando el backend publicó el umbral, se dibuja además la medición
     de cada repetición respecto a ese umbral y su tolerancia.
   - Repeticiones: qué tan parecidas son entre sí y cuánto duran sus fases.
   - Detalle: el riel de diagnóstico de siempre (evidencia, correcciones,
     fuentes y coaching), sin cambios.

   Aquí no se evalúa nada. «En tolerancia» es la única lectura derivada: la
   repetición cumple según el motor, pero su medición cae dentro del margen que
   la propia regla declara.
   --------------------------------------------------------------------------- */

import { memo, useMemo, useState, type ReactNode } from "react";

import type { BiomechanicsRepetition, BiomechanicsResult, CameraView, PoseFrame, VideoJob } from "../types";
import { RULE_LABELS } from "./DiagnosticRail";
import { metricValue } from "./metricLabels";
import { humanizeKey, repetitionCounts } from "./presentationAdapters";
import {
  SIGNAL_SPECS,
  betweenRepetitionSpread,
  metricInLaneUnits,
  primarySignal,
  repetitionCurve,
  repetitionTempo,
  robustRange,
  withinToleranceOnly,
  type LaneThreshold,
  type MotionSignals,
} from "./signals";

/* --- Vista de cámara ---------------------------------------------------------- */

export const CAMERA_VIEW_OPTIONS: Array<{ value: CameraView; label: string; enables: string }> = [
  { value: "side", label: "Lateral", enables: "Reglas de perfil: profundidad, tronco y extensión." },
  { value: "three_quarter", label: "Tres cuartos", enables: "Reglas de perfil: profundidad, tronco y extensión." },
  { value: "front", label: "Frontal", enables: "Reglas de frente: simetría entre lados." },
  { value: "unspecified", label: "Automática", enables: "Estima la vista a partir de la pose. Si no puede distinguirla, te pedirá indicarla." },
];

const VIEW_FIGURES: Record<CameraView, string> = {
  side: "M14 10l-1.5 9M12.5 19l5 5.5-1 7M12.5 19l-1 6.5 3 6.5M13.6 12.5l6 3 3.5-2",
  three_quarter: "M9.5 11.5l8.5 1.5M10 19.5l6.5.8M13.8 12.2l-.6 7.8M10 19.5l-1 12.5M16.5 20.3l2.5 11.7M9.5 11.5l-2 8M18 13l3.5 6.5",
  front: "M7.5 12h13M9.5 20h9M14 12v8M9.5 20l-1.5 12M18.5 20l1.5 12M7.5 12l-2 8.5M20.5 12l2 8.5",
  unspecified: "M11.4 11.3a2.8 2.8 0 115 1.8c-.9.8-2.2 1.3-2.2 2.9M14.2 19.3v.2",
};

function ViewFigure({ view }: { view: CameraView }) {
  return (
    <svg viewBox="0 0 28 34" width="28" height="34" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {view === "unspecified"
        ? <circle cx={14} cy={14} r={9} strokeDasharray="3 3.5" />
        : <circle cx={view === "side" ? 15 : 14} cy={6} r={3.4} />}
      <path d={VIEW_FIGURES[view]} />
    </svg>
  );
}

export function CameraViewPicker({ value, onChange, disabled = false, includeUnknown = false, label }: {
  value: CameraView;
  onChange: (view: CameraView) => void;
  disabled?: boolean;
  includeUnknown?: boolean;
  label: string;
}) {
  const options = CAMERA_VIEW_OPTIONS.filter((option) => includeUnknown || option.value !== "unspecified");
  return (
    <div className="view-picker" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          <ViewFigure view={option.value} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/* --- Reglas × repeticiones ---------------------------------------------------- */

type CellState = "pass" | "tolerance" | "fail" | "not_evaluable" | "absent";

const CELL_WORD: Record<CellState, string> = {
  pass: "cumple",
  tolerance: "cumple dentro de la tolerancia",
  fail: "por revisar",
  not_evaluable: "no evaluable",
  absent: "sin dato",
};

function CellIcon({ state }: { state: CellState }) {
  switch (state) {
    case "pass":
      return (
        <svg className="cell-icon is-pass" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <circle cx={9} cy={9} r={8} fill="currentColor" />
          <path d="M5.2 9.4l2.6 2.6 5-5.6" fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "tolerance":
      return (
        <svg className="cell-icon is-pass" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <circle cx={9} cy={9} r={7.2} fill="none" stroke="currentColor" strokeWidth={1.6} />
          <path d="M5.6 9.4l2.4 2.3 4.4-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "fail":
      return (
        <svg className="cell-icon is-fail" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <rect x={1.5} y={1.5} width={15} height={15} rx={3} fill="currentColor" />
          <path d="M6 6l6 6M12 6l-6 6" stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" />
        </svg>
      );
    case "not_evaluable":
      return (
        <svg className="cell-icon is-abstain" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <rect x={2} y={2} width={14} height={14} rx={3} fill="none" stroke="currentColor" strokeWidth={1.2} />
          <path d="M2 10l8-8M2 16L16 2M8 16l8-8" stroke="currentColor" strokeWidth={1.2} />
        </svg>
      );
    default:
      return (
        <svg className="cell-icon is-abstain" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
          <path d="M5.5 9h7" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
        </svg>
      );
  }
}

interface RuleRow {
  id: string;
  label: string;
  threshold: LaneThreshold | null;
  description: string | null;
  cells: Array<{ repetition: BiomechanicsRepetition; state: CellState; value: number | null; reason: string | null }>;
}

function buildRuleRows(repetitions: BiomechanicsRepetition[], thresholds: LaneThreshold[]): RuleRow[] {
  const ids: string[] = [];
  repetitions.forEach((rep) => Object.keys(rep.rule_evaluations ?? {}).forEach((id) => {
    if (!ids.includes(id)) ids.push(id);
  }));
  return ids.map((id) => {
    const threshold = thresholds.find((item) => item.ruleId === id) ?? null;
    let description: string | null = null;
    const cells = repetitions.map((repetition) => {
      const evaluation = repetition.rule_evaluations?.[id];
      const value = threshold ? metricInLaneUnits(threshold, repetition.metrics) : null;
      if (evaluation?.description) description = evaluation.description;
      let state: CellState = "absent";
      if (evaluation?.status === "fail") state = "fail";
      else if (evaluation?.status === "not_evaluable") state = "not_evaluable";
      else if (evaluation?.status === "pass") {
        state = threshold && value != null && withinToleranceOnly(threshold, value) ? "tolerance" : "pass";
      }
      return { repetition, state, value, reason: evaluation?.reason ?? null };
    });
    return { id, label: RULE_LABELS[id] ?? humanizeKey(id), threshold, description, cells };
  });
}

function StripPlot({ row }: { row: RuleRow }) {
  const threshold = row.threshold;
  const values = row.cells.map((cell) => cell.value).filter((value): value is number => value != null);
  if (!threshold || !values.length) return null;
  const low = Math.min(...values, threshold.value, threshold.tolerance);
  const high = Math.max(...values, threshold.value, threshold.tolerance);
  const pad = Math.max((high - low) * 0.18, 1);
  const width = 96;
  const height = 24;
  const x = (value: number) => 4 + ((value - (low - pad)) / (high - low + 2 * pad)) * (width - 8);
  const unit = SIGNAL_SPECS[threshold.lane].unit;
  const summary = row.cells
    .map((cell) => `repetición ${cell.repetition.number}: ${cell.value == null ? "sin dato" : `${cell.value.toFixed(1)}${unit}`}`)
    .join(", ");
  return (
    <svg className="strip-plot" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${summary}; umbral ${threshold.label}`}>
      <line className="strip-axis" x1={2} x2={width - 2} y1={height / 2} y2={height / 2} />
      {threshold.tolerance !== threshold.value && (
        <rect className="strip-tolerance" x={Math.min(x(threshold.value), x(threshold.tolerance))} y={5} width={Math.abs(x(threshold.value) - x(threshold.tolerance))} height={height - 10} />
      )}
      <line className="strip-threshold" x1={x(threshold.value)} x2={x(threshold.value)} y1={3} y2={height - 3} />
      {row.cells.map((cell) => (cell.value == null ? null : (
        <circle key={cell.repetition.number} className={`strip-dot is-${cell.state}`} cx={x(cell.value)} cy={height / 2} r={4}>
          <title>{`Rep. ${cell.repetition.number}: ${cell.value.toFixed(1)}${unit}`}</title>
        </circle>
      )))}
    </svg>
  );
}

function RuleMatrix({ diagnostics, thresholds, focusRule, onFocusRule, onSelectRepetition }: {
  diagnostics: BiomechanicsResult;
  thresholds: LaneThreshold[];
  focusRule: string | null;
  onFocusRule: (ruleId: string | null) => void;
  onSelectRepetition: (repetitionNumber: number, frame: number) => void;
}) {
  const rows = useMemo(() => buildRuleRows(diagnostics.repetitions, thresholds), [diagnostics.repetitions, thresholds]);
  const focused = rows.find((row) => row.id === focusRule) ?? null;

  if (!diagnostics.repetitions.length) {
    return <p className="reading-empty">El motor no detectó repeticiones en este video, así que no hay reglas que mostrar.</p>;
  }
  if (!rows.length) {
    return <p className="reading-empty">Este ejercicio todavía no reporta sus reglas una por una. El resultado está en la pestaña Detalle.</p>;
  }
  const hasThresholds = rows.some((row) => row.threshold);

  return (
    <>
      <div className="reading-intro">
        <h4>Cada regla, repetición por repetición</h4>
        {hasThresholds && <p>Los puntos son las repeticiones; la raya es el umbral y la franja, su tolerancia.</p>}
      </div>
      <div className="rule-table-wrap">
        <table className="rule-table">
          <thead>
            <tr>
              <th scope="col">Regla</th>
              <th scope="col">{hasThresholds ? "Medición" : ""}</th>
              {diagnostics.repetitions.map((rep) => <th scope="col" className="is-rep" key={rep.number}>R{rep.number}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={focusRule === row.id ? "is-focus" : ""}>
                <th scope="row">
                  <button type="button" className="rule-name" aria-expanded={focusRule === row.id} onClick={() => onFocusRule(focusRule === row.id ? null : row.id)}>
                    <span>{row.label}</span>
                    {row.threshold && <small>{row.threshold.label}</small>}
                  </button>
                </th>
                <td className="is-strip"><StripPlot row={row} /></td>
                {row.cells.map((cell) => (
                  <td className="is-cell" key={cell.repetition.number}>
                    <button
                      type="button"
                      title={`Rep. ${cell.repetition.number}: ${CELL_WORD[cell.state]}${cell.reason ? `. ${cell.reason}` : ""}`}
                      aria-label={`${row.label}, repetición ${cell.repetition.number}: ${CELL_WORD[cell.state]}`}
                      onClick={() => {
                        onFocusRule(row.id);
                        onSelectRepetition(cell.repetition.number, cell.repetition.bottom_frame);
                      }}
                    >
                      <CellIcon state={cell.state} />
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="rule-legend">
        <li><CellIcon state="pass" />Cumple</li>
        {hasThresholds && <li><CellIcon state="tolerance" />En tolerancia</li>}
        <li><CellIcon state="fail" />Por revisar</li>
        <li><CellIcon state="not_evaluable" />No evaluable</li>
      </ul>

      {focused && (
        <div className="rule-detail">
          <strong>{focused.label}</strong>
          {focused.description && <p>Se marca cuando: {focused.description.charAt(0).toLowerCase() + focused.description.slice(1)}</p>}
          <dl>
            {focused.cells.map((cell) => (
              <div key={cell.repetition.number}>
                <dt>Rep. {cell.repetition.number}</dt>
                <dd>
                  {focused.threshold && cell.value != null
                    ? `${metricValue(focused.threshold.metric, cell.repetition.metrics[focused.threshold.metric] ?? null)} · `
                    : ""}
                  {CELL_WORD[cell.state]}
                  {cell.state === "not_evaluable" && cell.reason ? `: ${cell.reason}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {diagnostics.warnings.length > 0 && (
        <details className="reading-limits">
          <summary>Límites de esta medición <span>{diagnostics.warnings.length}</span></summary>
          <ul>{diagnostics.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      )}
    </>
  );
}

/* --- Comparación entre repeticiones ------------------------------------------ */

function RepetitionCompare({ diagnostics, signals, fps, selectedRepetition, onSelectRepetition }: {
  diagnostics: BiomechanicsResult;
  signals: MotionSignals;
  fps: number | null;
  selectedRepetition: number | null;
  onSelectRepetition: (repetitionNumber: number, frame: number) => void;
}) {
  const data = useMemo(() => {
    const key = primarySignal(signals);
    const spec = SIGNAL_SPECS[key];
    const curves = diagnostics.repetitions
      .map((repetition) => ({ repetition, curve: repetitionCurve(signals, key, repetition) }))
      .filter((item): item is { repetition: BiomechanicsRepetition; curve: number[] } => item.curve != null);
    const range = robustRange(signals.series[key]);
    const bottoms = diagnostics.repetitions.map((rep) => rep.bottom_frame);
    const cycles = fps ? bottoms.slice(1).map((frame, index) => (frame - bottoms[index]) / fps) : [];
    return {
      spec,
      curves,
      low: range ? range.low - 6 : 0,
      high: range ? range.high + 6 : 180,
      spread: betweenRepetitionSpread(curves.map((item) => item.curve)),
      cycle: cycles.length ? cycles.reduce((sum, value) => sum + value, 0) / cycles.length : null,
      tempos: fps ? diagnostics.repetitions.map((rep) => repetitionTempo(rep, fps)).filter((item) => item != null) : [],
    };
  }, [diagnostics.repetitions, signals, fps]);

  if (!diagnostics.repetitions.length) {
    return <p className="reading-empty">Sin repeticiones detectadas no hay nada que comparar.</p>;
  }

  const width = 340;
  const height = 150;
  const left = 38;
  const x = (index: number) => left + (index / 50) * (width - left - 8);
  const y = (value: number) => 8 + (1 - (value - data.low) / Math.max(data.high - data.low, 1)) * (height - 30);
  const ticks = [0.15, 0.5, 0.85].map((fraction) => Math.round((data.low + (data.high - data.low) * fraction) / 10) * 10);
  const ordered = [...data.curves].sort((a, b) => Number(a.repetition.number === selectedRepetition) - Number(b.repetition.number === selectedRepetition));
  const longest = Math.max(...data.tempos.map((tempo) => tempo.down + tempo.up), 0.001);

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <strong>{data.cycle == null ? "—" : data.cycle.toFixed(2)}{data.cycle != null && <small>s</small>}</strong>
          <span>ciclo medio entre puntos bajos</span>
        </div>
        <div className="stat">
          <strong>{data.spread == null ? "—" : data.spread.toFixed(1)}{data.spread != null && <small>{data.spec.unit}</small>}</strong>
          <span>variación de {data.spec.name.toLowerCase()} entre repeticiones</span>
        </div>
        <div className="stat">
          <strong>{diagnostics.repetitions.length}</strong>
          <span>repeticiones detectadas</span>
        </div>
      </div>

      {data.curves.length > 0 && (
        <>
          <div className="reading-intro">
            <h4>{data.spec.name} a lo largo de la repetición</h4>
            <p>Cuanto más se enciman las curvas, más repetible es el gesto. Elige una para resaltarla.</p>
          </div>
          <div className="chart-card">
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.spec.name} de cada repetición, del inicio al final de su ventana`}>
              {ticks.map((value) => (
                <g key={value}>
                  <line className="chart-grid" x1={left} x2={width - 8} y1={y(value)} y2={y(value)} />
                  <text className="chart-axis" x={left - 6} y={y(value) + 4} textAnchor="end">{value}{data.spec.unit}</text>
                </g>
              ))}
              <text className="chart-axis" x={left} y={height - 4}>inicio</text>
              <text className="chart-axis" x={width - 8} y={height - 4} textAnchor="end">fin de la repetición</text>
              {ordered.map(({ repetition, curve }) => (
                <path
                  key={repetition.number}
                  className={`chart-line ${repetition.number === selectedRepetition ? "is-selected" : selectedRepetition ? "is-dimmed" : ""}`}
                  d={curve.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join("")}
                >
                  <title>{`Rep. ${repetition.number}`}</title>
                </path>
              ))}
            </svg>
            <div className="chart-legend">
              {data.curves.map(({ repetition }) => (
                <button
                  type="button"
                  key={repetition.number}
                  className="rep-pick"
                  aria-pressed={selectedRepetition === repetition.number}
                  onClick={() => onSelectRepetition(repetition.number, repetition.start_frame)}
                >
                  <i aria-hidden="true" />Rep. {repetition.number}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {data.tempos.length > 0 && (
        <>
          <div className="reading-intro">
            <h4>Tempo</h4>
            <p>Del inicio al punto bajo (gris) y del punto bajo al final (claro), en segundos.</p>
          </div>
          <div className="tempo">
            {data.tempos.map((tempo) => (
              <div className="tempo-row" key={tempo.number}>
                <span>Rep. {tempo.number}</span>
                <div className="tempo-bar" role="img" aria-label={`Primera fase ${tempo.down.toFixed(2)} segundos, segunda fase ${tempo.up.toFixed(2)} segundos`}>
                  <i className="is-down" style={{ inlineSize: `${(tempo.down / longest) * 100}%` }} />
                  <i className="is-up" style={{ inlineSize: `${(tempo.up / longest) * 100}%` }} />
                </div>
                <span className="tempo-total">{tempo.down.toFixed(2)} + {tempo.up.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* --- Panel -------------------------------------------------------------------- */

type ReadingTab = "rules" | "repetitions" | "detail";

interface SessionReadingProps {
  job: VideoJob;
  diagnostics: BiomechanicsResult;
  signals: MotionSignals | null;
  frames: PoseFrame[];
  thresholds: LaneThreshold[];
  selectedRepetition: number | null;
  focusRule: string | null;
  changingView: boolean;
  viewError: string | null;
  onChangeView: (view: CameraView) => void;
  onFocusRule: (ruleId: string | null) => void;
  onSelectRepetition: (repetitionNumber: number, frame: number) => void;
  /** Riel de diagnóstico existente; debe venir memoizado. */
  detailSlot: ReactNode;
}

function SessionReadingBase({
  job,
  diagnostics,
  signals,
  thresholds,
  selectedRepetition,
  focusRule,
  changingView,
  viewError,
  onChangeView,
  onFocusRule,
  onSelectRepetition,
  detailSlot,
}: SessionReadingProps) {
  const [tab, setTab] = useState<ReadingTab>("rules");
  const counts = repetitionCounts(diagnostics.repetitions);
  const resolution = diagnostics.camera_view_resolution;
  const effectiveView = resolution?.effective_view ?? job.camera_view;
  const unresolved = effectiveView === "unspecified";
  const estimatedViewLabel = CAMERA_VIEW_OPTIONS.find((option) => option.value === effectiveView)?.label;

  let headline: string;
  let body: string;
  if (diagnostics.exercise === "unknown") {
    headline = "Falta confirmar el ejercicio";
    body = "La detección automática no pudo identificar el ejercicio con suficiente evidencia. Indícalo en la pestaña Detalle para aplicar sus reglas.";
  } else if (!counts.total) {
    headline = "No se detectaron repeticiones";
    body = "El video se procesó, pero el motor no encontró un ciclo completo del ejercicio aplicado. Revisa el ejercicio en la pestaña Detalle.";
  } else if (counts.nonEvaluable === counts.total) {
    headline = `${counts.total} ${counts.total === 1 ? "repetición medida, sin evaluar" : "repeticiones medidas, ninguna evaluada"}`;
    body = unresolved
      ? "No se pudo determinar la vista de cámara con suficiente evidencia. Indícala para aplicar las reglas que correspondan."
      : "El motor midió cada repetición, pero no tuvo evidencia suficiente para aplicar las reglas. Los motivos están en la tabla.";
  } else if (counts.review > 0) {
    headline = `${counts.review} de ${counts.total} ${counts.total === 1 ? "repetición" : "repeticiones"} por revisar`;
    body = "Toca una celda de la tabla para ir al cuadro donde el motor encontró el hallazgo.";
  } else if (counts.correct === counts.total) {
    headline = `${counts.total} ${counts.total === 1 ? "repetición sin hallazgos" : "repeticiones sin hallazgos"}`;
    body = "Sin hallazgos en las reglas de pose que esta vista permite aplicar. No certifica seguridad física ni validez competitiva.";
  } else {
    headline = `${counts.correct} sin hallazgos, ${counts.nonEvaluable} sin evaluar`;
    body = "Parte de la sesión no pudo evaluarse; la ausencia de hallazgos no la cubre completa.";
  }

  return (
    <aside className="reading" aria-label="Lectura de la sesión">
      <section className="verdict">
        <p className="verdict-kicker">Lectura de la sesión</p>
        <h3>{headline}</h3>
        <p>{body}</p>

        {counts.total > 0 && counts.nonEvaluable < counts.total && (
          <dl className="verdict-counts">
            <div><dd>{counts.correct}</dd><dt>sin hallazgos</dt></div>
            <div><dd>{counts.review}</dd><dt>por revisar</dt></div>
            <div><dd>{counts.nonEvaluable}</dd><dt>sin evaluar</dt></div>
          </dl>
        )}

        <div className="verdict-ask">
          <span>Vista de cámara</span>
          <CameraViewPicker value={job.camera_view} onChange={onChangeView} disabled={changingView} includeUnknown label="Vista de cámara" />
          {changingView && <p className="verdict-note" role="status">Aplicando las reglas con la nueva vista…</p>}
          {viewError && <p className="form-message error" role="alert">{viewError}</p>}
          {!changingView && resolution?.source === "estimated" && (
            <p className="verdict-note" role="status">Vista estimada: {estimatedViewLabel}. Puedes corregirla si no coincide con la grabación.</p>
          )}
          {!changingView && unresolved && (
            <p className="verdict-note" role="status">{resolution?.reason ?? "Vista sin determinar. Elige cómo se grabó el video o vuelve a aplicar Automática."}</p>
          )}
          {!changingView && <p className="verdict-note">Cambiar la vista vuelve a aplicar las reglas sobre la misma pose; no repite la detección.</p>}
          {resolution && resolution.source !== "manual" && resolution.limitations.length > 0 && (
            <details className="reading-limits">
              <summary>Cómo se estimó la vista</summary>
              {resolution.source === "estimated" && <p>{resolution.reason}</p>}
              <ul>{resolution.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
            </details>
          )}
        </div>
      </section>

      <div className="reading-tabs" role="tablist" aria-label="Detalle de la lectura">
        {([["rules", "Reglas"], ["repetitions", "Repeticiones"], ["detail", "Detalle"]] as Array<[ReadingTab, string]>).map(([id, label]) => (
          <button type="button" role="tab" key={id} id={`reading-tab-${id}`} aria-selected={tab === id} aria-controls={`reading-panel-${id}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="reading-panel" role="tabpanel" id="reading-panel-rules" aria-labelledby="reading-tab-rules" hidden={tab !== "rules"}>
        <RuleMatrix
          diagnostics={diagnostics}
          thresholds={thresholds}
          focusRule={focusRule}
          onFocusRule={onFocusRule}
          onSelectRepetition={onSelectRepetition}
        />
      </div>
      <div className="reading-panel" role="tabpanel" id="reading-panel-repetitions" aria-labelledby="reading-tab-repetitions" hidden={tab !== "repetitions"}>
        {signals
          ? <RepetitionCompare diagnostics={diagnostics} signals={signals} fps={job.fps} selectedRepetition={selectedRepetition} onSelectRepetition={onSelectRepetition} />
          : <p className="reading-empty">Las señales aparecen cuando termina de cargar la pose.</p>}
      </div>
      {/* El riel existente se mantiene montado para no perder el coaching generado. */}
      <div className="reading-panel is-detail" role="tabpanel" id="reading-panel-detail" aria-labelledby="reading-tab-detail" hidden={tab !== "detail"}>
        {detailSlot}
      </div>
    </aside>
  );
}

export default memo(SessionReadingBase);
