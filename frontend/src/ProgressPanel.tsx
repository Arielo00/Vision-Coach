/* ---------------------------------------------------------------------------
   06 · Progreso longitudinal.

   Informe de ciencias del deporte, no tablero de métricas.

   Reglas de honestidad aplicadas aquí:
   - Una medición ausente es un HUECO, nunca un cero. La línea se interrumpe.
   - La tendencia solo se enuncia cuando el backend declara comparabilidad
     (`rate_comparable`, `rom_comparable`). Con el filtro "Todos" las sesiones
     pueden mezclar ejercicios y vistas, y entonces no se afirma dirección.
   - No hay valores de referencia inventados ni datos de ejemplo.
   - Cada gráfica trae su equivalente en tabla, accesible con teclado.
   --------------------------------------------------------------------------- */

import { useEffect, useId, useMemo, useState } from "react";

import { getProgress } from "./api";
import { exerciseLabel } from "./exerciseCatalog";
import type { CameraView, ProgressPayload } from "./types";
import Disclosure from "./ui/Disclosure";
import { DataPair, NotEvaluable, StateBadge, TechnicalLabel } from "./ui/StatusAtoms";
import { buildSeries, measuredCount } from "./ui/presentationAdapters";
import type { SeriesPoint } from "./ui/uiTypes";

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short" }).format(new Date(value));
}

const CAMERA_VIEW_LABELS: Record<CameraView, string> = {
  side: "Lateral",
  three_quarter: "Tres cuartos",
  front: "Frontal",
  unspecified: "Sin determinar",
};

interface ChartProps {
  points: SeriesPoint[];
  domain?: [number, number];
  unit: string;
  title: string;
  description: string;
  tone: "evaluable" | "reference";
}

/**
 * Gráfica de línea con huecos explícitos.
 *
 * Los tramos se dibujan solo entre puntos medidos consecutivos. Si falta una
 * sesión intermedia, la línea se corta y el punto ausente se marca en el eje,
 * en lugar de interpolar una continuidad que no existe.
 */
function LineChart({ points, domain, unit, title, description, tone }: ChartProps) {
  const titleId = useId();
  const measured = points.filter((point) => point.value != null);

  if (points.length === 0) {
    return (
      <NotEvaluable title="SIN SESIONES">
        Todavía no hay sesiones para este filtro.
      </NotEvaluable>
    );
  }
  if (measured.length === 0) {
    return (
      <NotEvaluable title="SIN MEDICIONES COMPARABLES">
        Hay {points.length} sesión(es), pero ninguna reporta este valor.
      </NotEvaluable>
    );
  }

  const width = 680;
  const height = 220;
  const padLeft = 62;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 38;

  const values = measured.map((point) => point.value as number);
  const rawMin = domain?.[0] ?? Math.min(...values);
  const rawMax = domain?.[1] ?? Math.max(...values);
  const spread = Math.max(rawMax - rawMin, 1);
  const minimum = domain ? rawMin : rawMin - spread * 0.15;
  const maximum = domain ? rawMax : rawMax + spread * 0.15;

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  /* Precisión suficiente para que dos marcas contiguas nunca impriman el mismo
     número: con rangos muy estrechos, redondear a un decimal produce ejes con
     etiquetas repetidas que no se pueden leer. */
  const step = (maximum - minimum) / (ticks.length - 1);
  const precision = Math.min(
    3,
    Math.max(0, Math.ceil(-Math.log10(Math.max(step, Number.EPSILON))) + 1),
  );

  const x = (index: number) =>
    padLeft + index * ((width - padLeft - padRight) / Math.max(points.length - 1, 1));
  const y = (value: number) =>
    height - padBottom - ((value - minimum) / Math.max(maximum - minimum, 1)) * (height - padTop - padBottom);

  /* Tramos continuos: se rompen en cada hueco. */
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  points.forEach((point, index) => {
    if (point.value == null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: x(index), y: y(point.value) });
  });
  if (current.length) segments.push(current);

  return (
    <figure className={`chart tone-${tone}`}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{description}</title>

        {ticks.map((ratio) => {
          const lineY = padTop + ratio * (height - padTop - padBottom);
          const tickValue = maximum - ratio * (maximum - minimum);
          return (
            <g key={ratio}>
              <line x1={padLeft} x2={width - padRight} y1={lineY} y2={lineY} className="chart-grid" />
              <text x={padLeft - 10} y={lineY + 4} textAnchor="end" className="chart-tick">
                {tickValue.toFixed(precision)}
                {unit}
              </text>
            </g>
          );
        })}

        <line x1={padLeft} x2={padLeft} y1={padTop} y2={height - padBottom} className="chart-axis" />
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={height - padBottom}
          y2={height - padBottom}
          className="chart-axis"
        />

        {segments.map((segment, index) => (
          <polyline
            key={index}
            points={segment.map((point) => `${point.x},${point.y}`).join(" ")}
            className="chart-line"
            fill="none"
          />
        ))}

        {points.map((point, index) =>
          point.value == null ? (
            <g key={`${point.jobId}-gap`}>
              <line
                x1={x(index)}
                x2={x(index)}
                y1={padTop}
                y2={height - padBottom}
                className="chart-gap"
              />
              <text
                x={x(index)}
                y={height - padBottom + 26}
                textAnchor="middle"
                className="chart-gap-label"
              >
                sin dato
              </text>
            </g>
          ) : (
            <g key={`${point.jobId}-point`}>
              <circle cx={x(index)} cy={y(point.value)} r="4.5" className="chart-point" />
              <title>{`${point.label}: ${point.readout}`}</title>
            </g>
          ),
        )}

        <text x={padLeft} y={height - 8} className="chart-axis-label">
          {points[0].label}
        </text>
        <text x={width - padRight} y={height - 8} textAnchor="end" className="chart-axis-label">
          {points[points.length - 1].label}
        </text>
      </svg>

      <figcaption>
        <span>
          {measured.length} de {points.length} sesión(es) con medición.
          {points.length - measured.length > 0 &&
            ` ${points.length - measured.length} sin este valor.`}
        </span>
      </figcaption>

      <Disclosure summary={`Tabla de datos · ${title}`}>
        <table className="chart-table">
          <caption className="visually-hidden">{description}</caption>
          <thead>
            <tr>
              <th scope="col">Sesión</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`${point.jobId}-row`}>
                <th scope="row">{point.label}</th>
                <td>{point.readout}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Disclosure>
    </figure>
  );
}

export default function ProgressPanel({ refreshKey }: { refreshKey: string }) {
  const [exercise, setExercise] = useState<string>("");
  const [data, setData] = useState<ProgressPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getProgress(exercise || null)
      .then((payload) => {
        if (active) {
          setData(payload);
          setError(null);
        }
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "No fue posible leer el progreso.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [exercise, refreshKey]);

  const rateSeries = useMemo(
    () =>
      data
        ? buildSeries(data.sessions, (session) => session.correct_rate, (value) => `${value.toFixed(1)}%`, dateLabel)
        : [],
    [data],
  );

  const romSeries = useMemo(
    () =>
      data
        ? buildSeries(data.sessions, (session) => session.rom.value, (value) => `${value.toFixed(1)}°`, dateLabel)
        : [],
    [data],
  );

  const romLabel = data?.summary.rom_comparable
    ? data.sessions.find((item) => item.rom.label)?.rom.label ?? "Rango articular"
    : "Rango articular";

  const rateComparable = data?.summary.rate_comparable ?? false;
  const romComparable = data?.summary.rom_comparable ?? false;

  return (
    <section className="progress" aria-label="Progreso longitudinal">
      {/* Único lugar donde aparece este eslogan en toda la aplicación. */}
      <p className="progress-slogan">MUÉVETE CON CERTEZA, NO CON SUERTE.</p>

      <header className="progress-header">
        <div>
          <TechnicalLabel>03 · Evolución longitudinal</TechnicalLabel>
          <h2>Informe entre sesiones</h2>
        </div>
        <label className="progress-filter">
          <TechnicalLabel>Ejercicio comparable</TechnicalLabel>
          <select value={exercise} onChange={(event) => setExercise(event.target.value)}>
            <option value="">Todos los ejercicios</option>
            {data?.exercise_options.map((item) => (
              <option key={item.exercise} value={item.exercise}>
                {exerciseLabel(item.exercise)} ({item.sessions})
              </option>
            ))}
          </select>
        </label>
      </header>

      {loading ? (
        <p className="empty-state" role="status">Calculando historial…</p>
      ) : error ? (
        <p className="form-message error" role="alert">{error}</p>
      ) : data ? (
        <>
          <dl className="progress-summary">
            <DataPair label="Sesiones" value={data.summary.sessions} />
            <DataPair label="Repeticiones detectadas" value={data.summary.total_repetitions} />
            <DataPair label="Evaluadas" value={data.summary.total_evaluated_repetitions} />
            <DataPair
              label="No evaluables"
              value={data.summary.total_non_evaluable_repetitions}
              tone="uncertain"
            />
            <DataPair
              label="Correctas entre evaluadas"
              value={
                data.summary.overall_correct_rate == null
                  ? "—"
                  : `${data.summary.overall_correct_rate.toFixed(1)}%`
              }
              note={data.summary.overall_correct_rate == null ? "sin medición" : null}
            />
            <DataPair
              label={`${romLabel} medio`}
              value={data.summary.mean_rom == null ? "—" : `${data.summary.mean_rom.toFixed(1)}°`}
              note={data.summary.mean_rom == null ? "sin medición" : null}
            />
          </dl>

          {data.sessions.length === 0 ? (
            <NotEvaluable title="SIN SESIONES PARA ESTE FILTRO">
              No hay sesiones comparables con la selección actual.
            </NotEvaluable>
          ) : (
            <div className="progress-charts">
              <article className="progress-chart-card">
                <header>
                  <div>
                    <TechnicalLabel>Calidad técnica evaluable</TechnicalLabel>
                    <h3>Correctas entre evaluadas</h3>
                  </div>
                  <TrendStatement
                    comparable={rateComparable}
                    slope={data.summary.correct_rate_slope_per_session}
                    unit="pp"
                    measured={measuredCount(rateSeries)}
                  />
                </header>
                <LineChart
                  points={rateSeries}
                  domain={[0, 100]}
                  unit="%"
                  tone="evaluable"
                  title="Correctas entre evaluadas"
                  description={`Porcentaje de repeticiones correctas por sesión, de ${
                    rateSeries[0]?.label ?? "—"
                  } a ${rateSeries[rateSeries.length - 1]?.label ?? "—"}. El denominador incluye solo repeticiones evaluables. Eje vertical de 0 a 100 por ciento.`}
                />
              </article>

              <article className="progress-chart-card">
                <header>
                  <div>
                    <TechnicalLabel>Rango articular observado</TechnicalLabel>
                    <h3>{romLabel}</h3>
                  </div>
                  <TrendStatement
                    comparable={romComparable}
                    slope={data.summary.rom_slope_per_session}
                    unit="°"
                    measured={measuredCount(romSeries)}
                  />
                </header>
                {romComparable ? (
                  <LineChart
                    points={romSeries}
                    unit="°"
                    tone="reference"
                    title={romLabel}
                    description={`${romLabel} por sesión, en grados.`}
                  />
                ) : (
                  <NotEvaluable title="RANGO NO COMPARABLE">
                    El backend no declara comparabilidad de rango articular para este
                    filtro. Selecciona un ejercicio específico para comparar sesiones
                    equivalentes.
                  </NotEvaluable>
                )}
              </article>
            </div>
          )}

          {data.sessions.length > 0 && (
            <div className="progress-table-wrap">
              <table className="progress-table">
                <caption className="visually-hidden">Detalle de sesiones</caption>
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Ejercicio</th>
                    <th scope="col">Vista</th>
                    <th scope="col">Detectadas</th>
                    <th scope="col">Evaluadas</th>
                    <th scope="col">No evaluables</th>
                    <th scope="col">Correctas / evaluadas</th>
                    <th scope="col">Rango</th>
                    <th scope="col">Confianza</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.sessions].reverse().map((item) => (
                    <tr key={item.job_id}>
                      <th scope="row">{dateLabel(item.date)}</th>
                      <td>{exerciseLabel(item.exercise)}</td>
                      <td>
                        {CAMERA_VIEW_LABELS[item.camera_view_resolution?.effective_view ?? item.camera_view]}
                        {item.camera_view_resolution?.source === "estimated" ? " (estimada)" : ""}
                      </td>
                      <td>{item.repetitions}</td>
                      <td>{item.evaluated_repetitions}</td>
                      <td>{item.non_evaluable_repetitions}</td>
                      <td>
                        {item.correct_rate == null ? (
                          <span className="cell-missing">sin dato</span>
                        ) : (
                          `${item.correct_rate.toFixed(0)}%`
                        )}
                      </td>
                      <td>
                        {item.rom.value == null ? (
                          <span className="cell-missing">sin dato</span>
                        ) : (
                          `${item.rom.value.toFixed(1)}°`
                        )}
                      </td>
                      <td>
                        {item.mean_confidence == null ? (
                          <span className="cell-missing">sin dato</span>
                        ) : (
                          `${Math.round(item.mean_confidence * 100)}%`
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

/**
 * Enunciado de tendencia.
 *
 * Solo afirma dirección cuando el backend declara que las sesiones son
 * comparables y hay al menos dos mediciones. En cualquier otro caso dice por
 * qué no se puede concluir, en lugar de mostrar una pendiente engañosa.
 */
function TrendStatement({ comparable, slope, unit, measured }: {
  comparable: boolean;
  slope: number | null;
  unit: string;
  measured: number;
}) {
  if (!comparable) {
    return (
      <StateBadge tone="unavailable" pattern="dotted">
        NO COMPARABLE
      </StateBadge>
    );
  }
  if (measured < 2 || slope == null) {
    return (
      <StateBadge tone="uncertain" pattern="dashed">
        SE REQUIEREN 2 SESIONES
      </StateBadge>
    );
  }
  const sign = slope > 0 ? "+" : "";
  return (
    <span className="trend-statement">
      <span className="trend-value">
        {sign}
        {slope.toFixed(2)} {unit}
      </span>
      <span className="trend-unit">por sesión</span>
    </span>
  );
}
