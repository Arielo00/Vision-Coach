/* ---------------------------------------------------------------------------
   Partitura del movimiento.

   Un carril por señal, todos sobre el mismo eje de tiempo que el video:
   - Arriba, las repeticiones que devolvió el motor y una tira de poses reales.
   - En cada carril, la señal completa y, si el backend publicó el umbral de la
     regla, su línea y su franja de tolerancia.
   - El cabezal lima es el cuadro que muestra el video. Arrastrar recorre el
     video; pasar el puntero lee los valores de cualquier instante.

   RENDIMIENTO
   La capa estática (curvas, poses, bandas) está memoizada y no depende del
   cuadro actual. Lo único que se reconcilia al ritmo del video es el cabezal y
   las cinco cifras de los rótulos.
   --------------------------------------------------------------------------- */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import type { BiomechanicsRepetition, PoseFrame } from "../types";
import { ankleAnchor, chainsToPath, figureChains } from "./poseFigure";
import { repetitionState } from "./presentationAdapters";
import { positionOfFrame, type BodySide, type LanePlan, type MotionSignals, type SignalKey } from "./signals";

interface Geometry {
  width: number;
  gutter: number;
  ruler: number;
  strip: number;
  lane: number;
  body: number;
  height: number;
  plot: number;
  total: number;
}

const RULER = 38;
const STRIP = 74;
const LANE = 46;
const AXIS = 24;
const PAD_RIGHT = 14;

function buildGeometry(width: number, lanes: number, frameTotal: number): Geometry {
  const gutter = width < 620 ? 108 : 184;
  const body = RULER + STRIP + lanes * LANE;
  return {
    width,
    gutter,
    ruler: RULER,
    strip: STRIP,
    lane: LANE,
    body,
    height: body + AXIS,
    plot: Math.max(width - gutter - PAD_RIGHT, 1),
    total: Math.max(frameTotal, 1),
  };
}

const xOf = (g: Geometry, frame: number) => g.gutter + (Math.min(Math.max(frame, 0), g.total) / g.total) * g.plot;
const laneTop = (g: Geometry, index: number) => g.ruler + g.strip + index * g.lane;
function yOf(g: Geometry, plan: LanePlan, index: number, value: number): number {
  const [low, high] = plan.domain;
  const clamped = Math.min(Math.max(value, low), high);
  return laneTop(g, index) + 8 + (1 - (clamped - low) / (high - low)) * (g.lane - 16);
}

function formatClock(frame: number, fps: number | null): string {
  if (!fps) return `cuadro ${frame}`;
  const seconds = frame / fps;
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

/* --- Capa estática ---------------------------------------------------------- */

interface StaticProps {
  geometry: Geometry;
  signals: MotionSignals;
  lanes: LanePlan[];
  frames: PoseFrame[];
  repetitions: BiomechanicsRepetition[];
  selectedRepetition: number | null;
  focusLane: SignalKey | null;
  mutedLanes: ReadonlySet<SignalKey>;
  fps: number | null;
  nearSide: BodySide;
}

function ScoreStaticBase({
  geometry: g,
  signals,
  lanes,
  frames,
  repetitions,
  selectedRepetition,
  focusLane,
  mutedLanes,
  fps,
  nearSide,
}: StaticProps) {
  const strip = useMemo(() => {
    const usable = frames.filter((frame) => frame.people[0]);
    if (usable.length < 2) return [];
    const perFrame = g.plot / g.total;
    const stride = Math.max(1, Math.round((usable[1].frame_index - usable[0].frame_index) || 1));
    const step = Math.max(1, Math.ceil(32 / (perFrame * stride)));
    const picks: number[] = [];
    for (let i = Math.floor(step / 2); i < usable.length; i += step) picks.push(i);
    if (!picks.length) return [];
    const keyFrames = new Set<number>();
    repetitions.forEach((repetition) => {
      let best = 0;
      picks.forEach((position, index) => {
        if (Math.abs(usable[position].frame_index - repetition.bottom_frame) < Math.abs(usable[picks[best]].frame_index - repetition.bottom_frame)) best = index;
      });
      const exact = usable.findIndex((frame) => frame.frame_index >= repetition.bottom_frame);
      if (exact >= 0) {
        picks[best] = exact;
        keyFrames.add(usable[exact].frame_index);
      }
    });
    let bodyHeight = 1;
    picks.forEach((position) => {
      const person = usable[position].people[0];
      const anchor = ankleAnchor(person);
      if (!anchor) return;
      person.xy.forEach((xy, index) => {
        if (index < 3 || !xy || xy[1] == null || (person.keypoint_confidence[index] ?? 0) < 0.4) return;
        bodyHeight = Math.max(bodyHeight, anchor[1] - xy[1]);
      });
    });
    const scale = (g.strip - 12) / (bodyHeight * 1.08);
    const baseY = g.ruler + g.strip - 6;
    return picks.map((position) => {
      const frame = usable[position];
      const person = frame.people[0];
      const anchor = ankleAnchor(person);
      const x0 = xOf(g, frame.frame_index);
      const figure = figureChains(person, nearSide, (x, y) => (
        anchor ? [x0 + (x - anchor[0]) * scale, baseY + (y - anchor[1]) * scale] : [x0, baseY]
      ));
      const inside = repetitions.some((rep) => frame.frame_index >= rep.start_frame && frame.frame_index <= rep.end_frame);
      return {
        frame: frame.frame_index,
        far: chainsToPath(figure.far),
        near: chainsToPath([...figure.core, ...figure.near]),
        head: figure.head,
        headRadius: figure.headRadius,
        tone: keyFrames.has(frame.frame_index) ? "is-key" : inside ? "is-inside" : "",
      };
    });
  }, [frames, g, nearSide, repetitions]);

  const seconds = fps ? g.total / fps : 0;
  const every = fps ? Math.max(1, Math.ceil(46 / (g.plot / Math.max(seconds, 1)))) : 1;
  const ticks = fps ? Array.from({ length: Math.floor(seconds) + 1 }, (_, second) => second) : [];

  return (
    <svg
      className="score-static"
      viewBox={`0 0 ${g.width} ${g.height}`}
      height={g.height}
      role="img"
      aria-label="Señales del movimiento a lo largo del video, con las repeticiones y los umbrales de las reglas"
    >
      {repetitions.map((rep) => (
        <rect
          key={`band-${rep.number}`}
          className={`score-band ${selectedRepetition === rep.number ? "is-selected" : ""}`}
          x={xOf(g, rep.start_frame)}
          y={g.ruler}
          width={Math.max(xOf(g, rep.end_frame) - xOf(g, rep.start_frame), 1)}
          height={g.body - g.ruler}
        />
      ))}
      {lanes.map((plan, index) => (focusLane === plan.spec.key ? (
        <rect key={`focus-${plan.spec.key}`} className="score-focus" x={g.gutter} y={laneTop(g, index)} width={g.width - g.gutter} height={g.lane} />
      ) : null))}

      {ticks.map((second) => {
        const x = xOf(g, second * (fps ?? 0));
        return (
          <g key={`tick-${second}`}>
            <line className="score-grid" x1={x} x2={x} y1={g.ruler} y2={g.body + 5} />
            {second % every === 0 && x < g.width - 20 && (
              <text className="score-axis" x={x} y={g.body + 18} textAnchor={second ? "middle" : "start"}>{second} s</text>
            )}
          </g>
        );
      })}

      {repetitions.map((rep) => {
        const state = repetitionState(rep);
        const x = xOf(g, rep.start_frame);
        const width = Math.max(xOf(g, rep.end_frame) - x, 6);
        return (
          <g key={`rep-${rep.number}`} className={`score-rep state-${state.kind} ${selectedRepetition === rep.number ? "is-selected" : ""}`}>
            <rect x={x} y={13} width={width} height={20} rx={3} />
            <text x={x + width / 2} y={27.5} textAnchor="middle">{width > 54 ? `Rep. ${rep.number}` : rep.number}</text>
            <title>{`Repetición ${rep.number}: ${state.label}`}</title>
          </g>
        );
      })}

      <line className="score-grid" x1={g.gutter} x2={g.width} y1={g.ruler + g.strip - 5.5} y2={g.ruler + g.strip - 5.5} />
      {strip.map((figure) => (
        <g key={`fig-${figure.frame}`} className={`score-figure ${figure.tone}`}>
          <path d={figure.far} strokeWidth={1} opacity={0.5} />
          <path d={figure.near} strokeWidth={1.5} />
          {figure.head && figure.headRadius > 0 && (
            <circle cx={figure.head[0]} cy={figure.head[1] - figure.headRadius * 0.1} r={figure.headRadius} strokeWidth={1.3} />
          )}
        </g>
      ))}

      {lanes.map((plan, index) => {
        const top = laneTop(g, index);
        const values = signals.series[plan.spec.key];
        let d = "";
        let pen = false;
        values.forEach((value, position) => {
          if (value == null) {
            pen = false;
            return;
          }
          d += `${pen ? "L" : "M"}${xOf(g, signals.frames[position]).toFixed(1)} ${yOf(g, plan, index, value).toFixed(1)}`;
          pen = true;
        });
        return (
          <g key={`lane-${plan.spec.key}`} className={mutedLanes.has(plan.spec.key) ? "is-muted" : ""}>
            <line className="score-grid" x1={0} x2={g.width} y1={top + 0.5} y2={top + 0.5} />
            {plan.thresholds.map((threshold) => {
              const yThreshold = yOf(g, plan, index, threshold.value);
              const yTolerance = yOf(g, plan, index, threshold.tolerance);
              return (
                <g key={threshold.ruleId}>
                  {threshold.tolerance !== threshold.value && (
                    <rect className="score-tolerance" x={g.gutter} y={Math.min(yThreshold, yTolerance)} width={g.width - g.gutter} height={Math.abs(yThreshold - yTolerance)} />
                  )}
                  <line className="score-threshold" x1={g.gutter} x2={g.width} y1={yThreshold} y2={yThreshold} />
                  <text className="score-axis" x={g.width - 5} y={yThreshold > top + 22 ? yThreshold - 5 : yThreshold + 14} textAnchor="end">
                    {threshold.label}
                  </text>
                </g>
              );
            })}
            <path className="score-trace" d={d} />
          </g>
        );
      })}
      <line className="score-grid" x1={0} x2={g.width} y1={g.body + 0.5} y2={g.body + 0.5} />
    </svg>
  );
}

const ScoreStatic = memo(ScoreStaticBase);

/* --- Componente ------------------------------------------------------------- */

interface MotionScoreProps {
  signals: MotionSignals;
  lanes: LanePlan[];
  frames: PoseFrame[];
  repetitions: BiomechanicsRepetition[];
  frameTotal: number;
  fps: number | null;
  currentFrame: number | null;
  selectedRepetition: number | null;
  focusLane: SignalKey | null;
  /** Carriles cuya regla no aplica en la vista de cámara actual. */
  mutedLanes: ReadonlySet<SignalKey>;
  onSeekToFrame: (frame: number) => void;
  onSelectRepetition: (repetitionNumber: number, frame: number) => void;
  onFocusLane: (lane: SignalKey | null) => void;
}

export default function MotionScore({
  signals,
  lanes,
  frames,
  repetitions,
  frameTotal,
  fps,
  currentFrame,
  selectedRepetition,
  focusLane,
  mutedLanes,
  onSeekToFrame,
  onSelectRepetition,
  onFocusLane,
}: MotionScoreProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ frame: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    setWidth(host.clientWidth);
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => setWidth(host.clientWidth));
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const g = useMemo(() => buildGeometry(width, lanes.length, frameTotal), [width, lanes.length, frameTotal]);

  const frameAt = useCallback(
    (clientX: number) => {
      const host = hostRef.current;
      if (!host) return 0;
      const x = clientX - host.getBoundingClientRect().left;
      return Math.round(Math.min(Math.max((x - g.gutter) / g.plot, 0), 1) * g.total);
    },
    [g],
  );

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const host = hostRef.current;
    if (!host || (event.target as HTMLElement).closest("button")) return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x < g.gutter) return;
    const frame = frameAt(event.clientX);
    if (y < g.ruler) {
      const repetition = repetitions.find((rep) => frame >= rep.start_frame && frame <= rep.end_frame);
      if (repetition) {
        onSelectRepetition(repetition.number, repetition.start_frame);
        return;
      }
    }
    dragging.current = true;
    host.setPointerCapture(event.pointerId);
    onSeekToFrame(frame);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < g.gutter) {
      setHover(null);
      return;
    }
    const frame = frameAt(event.clientX);
    if (dragging.current) onSeekToFrame(frame);
    setHover({ frame, x, y: event.clientY - rect.top });
  }

  const position = currentFrame == null ? -1 : positionOfFrame(signals, currentFrame);
  const hoverPosition = hover ? positionOfFrame(signals, hover.frame) : -1;
  const hoverRepetition = hover
    ? repetitions.find((rep) => hover.frame >= rep.start_frame && hover.frame <= rep.end_frame)
    : undefined;
  const tipWidth = tipRef.current?.offsetWidth ?? 200;

  return (
    <section className="score" aria-label="Partitura del movimiento">
      <header className="score-head">
        <h3>Partitura del movimiento</h3>
        <p>Cada señal sobre el mismo tiempo que el video. Arrastra para recorrerlo.</p>
      </header>

      <div
        className="score-body"
        ref={hostRef}
        style={{ height: width ? g.height : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 && (
          <>
            <ScoreStatic
              geometry={g}
              signals={signals}
              lanes={lanes}
              frames={frames}
              repetitions={repetitions}
              selectedRepetition={selectedRepetition}
              focusLane={focusLane}
              mutedLanes={mutedLanes}
              fps={fps}
              nearSide={signals.nearSide}
            />

            <svg className="score-dynamic" viewBox={`0 0 ${g.width} ${g.height}`} height={g.height} aria-hidden="true">
              {hover && <line className="score-hover" x1={xOf(g, hover.frame)} x2={xOf(g, hover.frame)} y1={g.ruler} y2={g.body} />}
              {currentFrame != null && (
                <g transform={`translate(${xOf(g, currentFrame)},0)`}>
                  <line className="score-playhead" x1={0} x2={0} y1={2} y2={g.body} />
                  <path className="score-playhead-handle" d="M-5 0h10v6l-5 5-5-5z" />
                  {lanes.map((plan, index) => {
                    const value = position >= 0 ? signals.series[plan.spec.key][position] : null;
                    return value == null ? null : (
                      <circle key={plan.spec.key} className="score-dot" cx={0} cy={yOf(g, plan, index, value)} r={4} />
                    );
                  })}
                </g>
              )}
            </svg>

            <div className="score-label" style={{ top: 0, height: g.ruler, width: g.gutter }}>
              <span className="score-label-name">Repeticiones</span>
            </div>
            <div className="score-label" style={{ top: g.ruler, height: g.strip, width: g.gutter }}>
              <span className="score-label-name">Poses</span>
              <span className="score-label-detail">del video, a intervalos fijos</span>
            </div>
            {lanes.map((plan, index) => {
              const key = plan.spec.key;
              const value = position >= 0 ? signals.series[key][position] : null;
              const muted = mutedLanes.has(key);
              return (
                <button
                  type="button"
                  key={key}
                  className={`score-label is-lane ${focusLane === key ? "is-focus" : ""} ${muted ? "is-muted" : ""}`}
                  style={{ top: laneTop(g, index), height: g.lane, width: g.gutter }}
                  aria-pressed={focusLane === key}
                  onClick={() => onFocusLane(focusLane === key ? null : key)}
                >
                  <span className="score-label-name">{plan.spec.name}</span>
                  <span className="score-label-detail">{muted ? "no aplica en esta vista" : plan.spec.detail}</span>
                  <span className="score-label-value">
                    {value == null ? "—" : value.toFixed(plan.spec.decimals)}
                    {value != null && <small>{plan.spec.unit}</small>}
                  </span>
                </button>
              );
            })}

            {hover && hoverPosition >= 0 && (
              <div
                className="score-tip"
                ref={tipRef}
                style={{
                  left: hover.x + 14 + tipWidth > g.width ? hover.x - tipWidth - 14 : hover.x + 14,
                  top: Math.max(hover.y - 12 - (tipRef.current?.offsetHeight ?? 120), 0),
                }}
              >
                <strong>
                  {formatClock(hover.frame, fps)} · cuadro {hover.frame}
                  {hoverRepetition ? ` · rep. ${hoverRepetition.number}` : ""}
                </strong>
                {lanes.map((plan) => {
                  const value = signals.series[plan.spec.key][hoverPosition];
                  return (
                    <div key={plan.spec.key}>
                      <span>{plan.spec.name}</span>
                      <span>{value == null ? "—" : `${value.toFixed(plan.spec.decimals)} ${plan.spec.unit}`}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
