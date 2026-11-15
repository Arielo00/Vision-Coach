/* ---------------------------------------------------------------------------
   Señales del movimiento.

   Convierte los keypoints que ya entrega `/pose/frames` en series de tiempo:
   los mismos ángulos y proporciones que usa el motor de reglas, con la misma
   geometría (`rules_engine/geometry.py`) y el mismo filtro de mediana de radio
   2 (`rules_engine/common.py::smooth_metrics`).

   Nada aquí decide si una repetición es correcta: eso lo hace el motor. Estas
   series existen para que la persona vea la medición completa y no solo el
   veredicto. Por eso se calculan con las coordenadas CRUDAS y el umbral de
   confianza de las reglas (0.40), no con las coordenadas suavizadas del trazo.
   --------------------------------------------------------------------------- */

import type { BiomechanicsRepetition, PoseFrame, PosePerson } from "../types";

export const MIN_RULE_CONFIDENCE = 0.4;

export type SignalKey = "knee" | "hip" | "elbow" | "depth" | "lean" | "wrist" | "asym";
export type Series = Array<number | null>;
export type BodySide = "left" | "right";

export interface MotionSignals {
  /** `frame_index` de cada posición de las series. */
  frames: number[];
  times: number[];
  /** Lado del cuerpo que la cámara ve mejor, según la confianza del modelo. */
  nearSide: BodySide;
  series: Record<SignalKey, Series>;
}

export interface SignalSpec {
  key: SignalKey;
  name: string;
  /** Qué se mide, en una línea corta. */
  detail: string;
  unit: "°" | "%";
  decimals: number;
  /** Variación mínima (p95 − p5) para que valga la pena mostrar el carril. */
  minimumRange: number;
}

export const SIGNAL_SPECS: Record<SignalKey, SignalSpec> = {
  knee: { key: "knee", name: "Rodilla", detail: "media de ambas", unit: "°", decimals: 0, minimumRange: 25 },
  hip: { key: "hip", name: "Cadera", detail: "media de ambas", unit: "°", decimals: 0, minimumRange: 25 },
  elbow: { key: "elbow", name: "Codo", detail: "media de ambos", unit: "°", decimals: 0, minimumRange: 25 },
  depth: { key: "depth", name: "Profundidad", detail: "cadera bajo rodilla", unit: "%", decimals: 1, minimumRange: Infinity },
  lean: { key: "lean", name: "Torso", detail: "desde la vertical", unit: "°", decimals: 0, minimumRange: 14 },
  wrist: { key: "wrist", name: "Muñeca", detail: "sobre el hombro", unit: "%", decimals: 0, minimumRange: 22 },
  asym: { key: "asym", name: "Simetría", detail: "entre rodillas", unit: "°", decimals: 0, minimumRange: Infinity },
};

const SIGNAL_ORDER: SignalKey[] = ["knee", "hip", "elbow", "depth", "lean", "wrist", "asym"];

type Point = [number, number];

const LEFT = { shoulder: 5, elbow: 7, wrist: 9, hip: 11, knee: 13, ankle: 15, ear: 3 };
const RIGHT = { shoulder: 6, elbow: 8, wrist: 10, hip: 12, knee: 14, ankle: 16, ear: 4 };

export function sideJoints(side: BodySide) {
  return side === "right" ? RIGHT : LEFT;
}

function confidentPoint(person: PosePerson | undefined, index: number): Point | null {
  if (!person) return null;
  const confidence = person.keypoint_confidence[index];
  const xy = person.xy[index];
  if (confidence == null || !Number.isFinite(confidence) || confidence < MIN_RULE_CONFIDENCE) return null;
  if (!xy || xy[0] == null || xy[1] == null) return null;
  return [xy[0], xy[1]];
}

function midpoint(a: Point | null, b: Point | null): Point | null {
  return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
}

function jointAngle(a: Point | null, b: Point | null, c: Point | null): number | null {
  if (!a || !b || !c) return null;
  const ux = a[0] - b[0];
  const uy = a[1] - b[1];
  const vx = c[0] - b[0];
  const vy = c[1] - b[1];
  const denominator = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (denominator <= 1e-8) return null;
  const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function mean(...values: Array<number | null>): number | null {
  const observed = values.filter((value): value is number => value != null);
  return observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : null;
}

/** Mediana de radio 2. La ventana se detiene en un valor ausente: un vecino no
    puede aportar la evidencia que faltó. */
export function medianFilter(values: Series, radius = 2): Series {
  return values.map((value, index) => {
    if (value == null) return null;
    const window: number[] = [];
    for (let j = index; j >= Math.max(0, index - radius) && values[j] != null; j -= 1) window.push(values[j] as number);
    for (let j = index + 1; j <= Math.min(values.length - 1, index + radius) && values[j] != null; j += 1) window.push(values[j] as number);
    window.sort((a, b) => a - b);
    return window[window.length >> 1];
  });
}

function meanConfidence(frames: PoseFrame[], indexes: number[]): number {
  let total = 0;
  let count = 0;
  frames.forEach((frame) => {
    const person = frame.people[0];
    if (!person) return;
    indexes.forEach((index) => {
      const value = person.keypoint_confidence[index];
      if (value != null && Number.isFinite(value)) {
        total += value;
        count += 1;
      }
    });
  });
  return count ? total / count : 0;
}

export function computeSignals(frames: PoseFrame[]): MotionSignals {
  const nearSide: BodySide =
    meanConfidence(frames, [RIGHT.elbow, RIGHT.wrist, RIGHT.knee]) >= meanConfidence(frames, [LEFT.elbow, LEFT.wrist, LEFT.knee])
      ? "right"
      : "left";
  const near = sideJoints(nearSide);
  const raw: Record<SignalKey, Series> = { knee: [], hip: [], elbow: [], depth: [], lean: [], wrist: [], asym: [] };

  frames.forEach((frame) => {
    const person = frame.people[0];
    const p = (index: number) => confidentPoint(person, index);
    const kneeLeft = jointAngle(p(LEFT.hip), p(LEFT.knee), p(LEFT.ankle));
    const kneeRight = jointAngle(p(RIGHT.hip), p(RIGHT.knee), p(RIGHT.ankle));
    const shoulders = midpoint(p(LEFT.shoulder), p(RIGHT.shoulder));
    const hips = midpoint(p(LEFT.hip), p(RIGHT.hip));
    const knees = midpoint(p(LEFT.knee), p(RIGHT.knee));
    const ankles = midpoint(p(LEFT.ankle), p(RIGHT.ankle));
    const bodyHeight = shoulders && ankles ? Math.abs(ankles[1] - shoulders[1]) : null;
    const nearWrist = p(near.wrist);
    const nearShoulder = p(near.shoulder);

    raw.knee.push(mean(kneeLeft, kneeRight));
    raw.hip.push(mean(
      jointAngle(p(LEFT.shoulder), p(LEFT.hip), p(LEFT.knee)),
      jointAngle(p(RIGHT.shoulder), p(RIGHT.hip), p(RIGHT.knee)),
    ));
    raw.elbow.push(mean(
      jointAngle(p(LEFT.shoulder), p(LEFT.elbow), p(LEFT.wrist)),
      jointAngle(p(RIGHT.shoulder), p(RIGHT.elbow), p(RIGHT.wrist)),
    ));
    raw.depth.push(hips && knees && bodyHeight != null && bodyHeight > 1 ? ((hips[1] - knees[1]) / bodyHeight) * 100 : null);
    raw.lean.push(shoulders && hips && Math.hypot(shoulders[0] - hips[0], hips[1] - shoulders[1]) > 1e-8
      ? Math.abs((Math.atan2(shoulders[0] - hips[0], hips[1] - shoulders[1]) * 180) / Math.PI)
      : null);
    raw.wrist.push(nearWrist && nearShoulder && bodyHeight != null && bodyHeight > 1
      ? ((nearShoulder[1] - nearWrist[1]) / bodyHeight) * 100
      : null);
    raw.asym.push(kneeLeft != null && kneeRight != null ? Math.abs(kneeLeft - kneeRight) : null);
  });

  const series = Object.fromEntries(
    SIGNAL_ORDER.map((key) => [key, medianFilter(raw[key])]),
  ) as Record<SignalKey, Series>;

  return {
    frames: frames.map((frame) => frame.frame_index),
    times: frames.map((frame) => frame.timestamp_seconds),
    nearSide,
    series,
  };
}

/** Posición en las series del cuadro más cercano a `frameIndex`. */
export function positionOfFrame(signals: MotionSignals, frameIndex: number): number {
  const frames = signals.frames;
  if (!frames.length) return -1;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (frames[middle] < frameIndex) low = middle + 1;
    else high = middle;
  }
  if (low > 0 && frameIndex - frames[low - 1] <= frames[low] - frameIndex) return low - 1;
  return low;
}

export function valueAtFrame(signals: MotionSignals, key: SignalKey, frameIndex: number): number | null {
  const position = positionOfFrame(signals, frameIndex);
  return position < 0 ? null : signals.series[key][position];
}

function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

export function robustRange(values: Series): { low: number; high: number; span: number } | null {
  const observed = values.filter((value): value is number => value != null).sort((a, b) => a - b);
  if (observed.length < 5) return null;
  const low = percentile(observed, 0.02);
  const high = percentile(observed, 0.98);
  return { low, high, span: percentile(observed, 0.95) - percentile(observed, 0.05) };
}

/* --- Umbrales -----------------------------------------------------------------
   El backend publica en `rule_config` la sección `rules` del JSON del ejercicio.
   Aquí solo se reconocen las claves cuyo significado geométrico coincide con
   una de las señales; cualquier otra regla se muestra sin umbral dibujado, que
   es preferible a dibujar una línea que no corresponde.                        */

export interface LaneThreshold {
  ruleId: string;
  lane: SignalKey;
  /** Métrica de la repetición que el motor compara con este umbral. */
  metric: string;
  value: number;
  /** Límite ya con tolerancia aplicada; igual a `value` si no hay tolerancia. */
  tolerance: number;
  direction: "min" | "max";
  label: string;
}

export type RuleConfig = Record<string, Record<string, unknown>>;

const number = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function thresholdsFromRuleConfig(config: RuleConfig | null | undefined): LaneThreshold[] {
  if (!config) return [];
  const found: LaneThreshold[] = [];
  const angular = (
    ruleId: string,
    lane: SignalKey,
    metric: string,
    value: number,
    direction: "min" | "max",
    slack: number,
  ) => {
    found.push({
      ruleId,
      lane,
      metric,
      value,
      tolerance: direction === "min" ? value - slack : value + slack,
      direction,
      label: `${direction === "min" ? "mín." : "máx."} ${value}°`,
    });
  };
  Object.entries(config).forEach(([ruleId, rule]) => {
    const slack = number(rule.tolerance_degrees) ?? 0;
    const hipDepth = number(rule.minimum_hip_below_knee_normalized);
    const lean = number(rule.maximum_degrees_from_vertical);
    const kneeMinimum = number(rule.minimum_knee_angle);
    const kneeBottom = number(rule.maximum_bottom_knee_angle);
    const elbowTop = number(rule.maximum_top_elbow_angle);
    const elbowBottomMaximum = number(rule.maximum_bottom_elbow_angle);
    const elbowBottomMinimum = number(rule.minimum_bottom_elbow_angle);
    const hipMinimum = number(rule.minimum_hip_angle);
    const asymmetry = number(rule.maximum_degrees);
    if (hipDepth != null) {
      const tolerance = (number(rule.tolerance_normalized) ?? 0) * 100;
      found.push({ ruleId, lane: "depth", metric: "maximum_hip_below_knee_normalized", value: hipDepth * 100, tolerance: hipDepth * 100 - tolerance, direction: "min", label: `mín. ${hipDepth * 100} %` });
    } else if (lean != null) {
      angular(ruleId, "lean", ruleId === "dip_torso_lean" ? "maximum_dip_torso_lean" : "maximum_torso_lean", lean, "max", slack);
    } else if (kneeBottom != null) {
      angular(ruleId, "knee", "minimum_knee_angle", kneeBottom, "max", slack);
    } else if (kneeMinimum != null && (ruleId === "full_extension" || ruleId === "lockout")) {
      angular(ruleId, "knee", "maximum_knee_angle", kneeMinimum, "min", slack);
    } else if (elbowTop != null) {
      angular(ruleId, "elbow", "minimum_elbow_angle", elbowTop, "max", slack);
    } else if (elbowBottomMaximum != null) {
      angular(ruleId, "elbow", "minimum_elbow_angle", elbowBottomMaximum, "max", slack);
    } else if (elbowBottomMinimum != null) {
      angular(ruleId, "elbow", "maximum_elbow_angle", elbowBottomMinimum, "min", slack);
    } else if (hipMinimum != null) {
      angular(ruleId, "hip", "maximum_hip_angle", hipMinimum, "min", slack);
    } else if (asymmetry != null && ruleId === "knee_asymmetry") {
      angular(ruleId, "asym", "maximum_knee_asymmetry", asymmetry, "max", 0);
    }
  });
  return found;
}

/** Valor de la métrica de una repetición en las unidades del carril. */
export function metricInLaneUnits(threshold: LaneThreshold, metrics: Record<string, number | boolean | null>): number | null {
  const value = metrics[threshold.metric];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return threshold.lane === "depth" ? value * 100 : value;
}

/** `true` si la medición cumple solo gracias a la tolerancia de la regla. */
export function withinToleranceOnly(threshold: LaneThreshold, value: number): boolean {
  return threshold.direction === "min"
    ? value < threshold.value && value >= threshold.tolerance
    : value > threshold.value && value <= threshold.tolerance;
}

export interface LanePlan {
  spec: SignalSpec;
  domain: [number, number];
  thresholds: LaneThreshold[];
}

/**
 * Carriles a mostrar: los que tienen umbral de regla y, después, los que de
 * verdad se mueven en este video. Así un dominadas muestra codo y cadera, y una
 * sentadilla, rodilla y profundidad, sin una tabla por ejercicio.
 */
export function planLanes(signals: MotionSignals, thresholds: LaneThreshold[], limit = 5): LanePlan[] {
  const candidates = SIGNAL_ORDER.map((key) => {
    const range = robustRange(signals.series[key]);
    const own = thresholds.filter((item) => item.lane === key);
    return { key, range, own };
  }).filter((item) => item.range && (item.own.length > 0 || item.range.span >= SIGNAL_SPECS[item.key].minimumRange));

  const chosen = [
    ...candidates.filter((item) => item.own.length > 0),
    ...candidates.filter((item) => item.own.length === 0),
  ].slice(0, limit);

  return SIGNAL_ORDER.filter((key) => chosen.some((item) => item.key === key)).map((key) => {
    const item = chosen.find((candidate) => candidate.key === key)!;
    let low = item.range!.low;
    let high = item.range!.high;
    item.own.forEach((threshold) => {
      low = Math.min(low, threshold.value, threshold.tolerance);
      high = Math.max(high, threshold.value, threshold.tolerance);
    });
    const padding = Math.max((high - low) * 0.1, 2);
    return { spec: SIGNAL_SPECS[key], domain: [low - padding, high + padding], thresholds: item.own };
  });
}

/* --- Comparación entre repeticiones ---------------------------------------- */

/** Señal con mayor recorrido entre rodilla, cadera y codo: la que mejor
    describe el gesto de este ejercicio. */
export function primarySignal(signals: MotionSignals): SignalKey {
  const options: SignalKey[] = ["knee", "hip", "elbow"];
  return options
    .map((key) => ({ key, span: robustRange(signals.series[key])?.span ?? 0 }))
    .sort((a, b) => b.span - a.span)[0].key;
}

/** Curva de una repetición remuestreada a `samples` puntos entre su inicio y su
    fin. Devuelve `null` si a la repetición le faltan mediciones. */
export function repetitionCurve(
  signals: MotionSignals,
  key: SignalKey,
  repetition: BiomechanicsRepetition,
  samples = 51,
): number[] | null {
  const values = signals.series[key];
  const start = positionOfFrame(signals, repetition.start_frame);
  const end = positionOfFrame(signals, repetition.end_frame);
  if (start < 0 || end <= start) return null;
  const curve: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const x = start + ((end - start) * i) / (samples - 1);
    const a = Math.floor(x);
    const b = Math.min(values.length - 1, a + 1);
    const va = values[a];
    const vb = values[b];
    if (va == null || vb == null) return null;
    curve.push(va + (vb - va) * (x - a));
  }
  return curve;
}

/** Desviación estándar media entre curvas, punto a punto. */
export function betweenRepetitionSpread(curves: number[][]): number | null {
  if (curves.length < 2) return null;
  const samples = curves[0].length;
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const column = curves.map((curve) => curve[i]);
    const average = column.reduce((sum, value) => sum + value, 0) / column.length;
    total += Math.sqrt(column.reduce((sum, value) => sum + (value - average) ** 2, 0) / column.length);
  }
  return total / samples;
}

export interface RepetitionTempo {
  number: number;
  /** Segundos del inicio al punto bajo y del punto bajo al final. */
  down: number;
  up: number;
}

export function repetitionTempo(repetition: BiomechanicsRepetition, fps: number): RepetitionTempo | null {
  if (!fps || repetition.bottom_frame < repetition.start_frame || repetition.end_frame < repetition.bottom_frame) return null;
  return {
    number: repetition.number,
    down: (repetition.bottom_frame - repetition.start_frame) / fps,
    up: (repetition.end_frame - repetition.bottom_frame) / fps,
  };
}

/* --- Indicio de la vista de cámara ------------------------------------------
   No clasifica la vista: reúne dos hechos medibles para que la persona decida
   con información. Etiquetar mal la vista produce hallazgos falsos.            */

export interface ViewClue {
  /** Separación horizontal de hombros entre el largo del torso. */
  shoulderRatio: number | null;
  occludedSide: BodySide | null;
  occludedConfidence: number | null;
}

export function viewClue(frames: PoseFrame[]): ViewClue {
  let separation = 0;
  let torso = 0;
  let count = 0;
  frames.slice(0, 60).forEach((frame) => {
    const person = frame.people[0];
    const ls = confidentPoint(person, LEFT.shoulder);
    const rs = confidentPoint(person, RIGHT.shoulder);
    const hips = midpoint(confidentPoint(person, LEFT.hip), confidentPoint(person, RIGHT.hip));
    const shoulders = midpoint(ls, rs);
    if (!ls || !rs || !hips || !shoulders) return;
    separation += Math.abs(ls[0] - rs[0]);
    torso += Math.hypot(shoulders[0] - hips[0], shoulders[1] - hips[1]);
    count += 1;
  });
  const left = meanConfidence(frames, [LEFT.elbow, LEFT.wrist]);
  const right = meanConfidence(frames, [RIGHT.elbow, RIGHT.wrist]);
  const lower = Math.min(left, right);
  const occluded = lower < 0.7 && Math.abs(left - right) > 0.2;
  return {
    shoulderRatio: count && torso > 0 ? separation / torso : null,
    occludedSide: occluded ? (left < right ? "left" : "right") : null,
    occludedConfidence: occluded ? lower : null,
  };
}
