/* ---------------------------------------------------------------------------
   Figura de palitos a partir de una pose.

   La comparten la tira de poses de la partitura y la cronofotografía. Devuelve
   cadenas de puntos ya transformados; quien llama decide si las pinta en SVG o
   en canvas. El lado lejano a la cámara va en una cadena aparte para poder
   dibujarlo más tenue: en una toma lateral suele estar ocluido.
   --------------------------------------------------------------------------- */

import type { PosePerson } from "../types";
import { sideJoints, type BodySide } from "./signals.ts";

export const MIN_DRAW_CONFIDENCE = 0.12;

export type FigurePoint = [number, number] | null;
type Drawable = PosePerson & { render_confidence?: Array<number | null> };

export interface FigureChains {
  far: FigurePoint[][];
  core: FigurePoint[][];
  near: FigurePoint[][];
  head: FigurePoint;
  headRadius: number;
}

export function drawConfidence(person: Drawable, index: number): number {
  return person.render_confidence?.[index] ?? person.keypoint_confidence[index] ?? 0;
}

export function drawableJoint(person: Drawable, index: number): FigurePoint {
  const point = person.xy[index];
  if (!point || point[0] == null || point[1] == null || !point.every(Number.isFinite)) return null;
  return drawConfidence(person, index) >= MIN_DRAW_CONFIDENCE ? [point[0], point[1]] : null;
}

function middle(a: FigurePoint, b: FigurePoint): FigurePoint {
  return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
}

export function comparisonTorso(person: Drawable | undefined): { hip: [number, number]; length: number } | null {
  if (!person) return null;
  const shoulder = middle(drawableJoint(person, 5), drawableJoint(person, 6));
  const hip = middle(drawableJoint(person, 11), drawableJoint(person, 12));
  if (!shoulder || !hip) return null;
  const length = Math.hypot(shoulder[0] - hip[0], shoulder[1] - hip[1]);
  return length > 1 ? { hip, length } : null;
}

/** Punto medio de los tobillos y su borde inferior, en coordenadas del video. */
export function ankleAnchor(person: PosePerson): [number, number] | null {
  const left = person.xy[15];
  const right = person.xy[16];
  if (!left || !right || left[0] == null || left[1] == null || right[0] == null || right[1] == null) return null;
  return [(left[0] + right[0]) / 2, Math.max(left[1], right[1])];
}

export function figureChains(
  person: Drawable,
  nearSide: BodySide,
  map: (x: number, y: number) => [number, number],
): FigureChains {
  const near = sideJoints(nearSide);
  const far = sideJoints(nearSide === "right" ? "left" : "right");
  const point = (index: number): FigurePoint => {
    const xy = drawableJoint(person, index);
    return xy ? map(...xy) : null;
  };
  const shoulders = middle(point(5), point(6));
  const hips = middle(point(11), point(12));
  const head = point(near.ear) ?? point(0);
  return {
    far: [
      [point(far.shoulder), point(far.elbow), point(far.wrist)],
      [point(far.hip), point(far.knee), point(far.ankle)],
    ],
    core: [[shoulders, hips]],
    near: [
      [point(near.shoulder), point(near.elbow), point(near.wrist)],
      [point(near.hip), point(near.knee), point(near.ankle)],
    ],
    head,
    headRadius: head && shoulders ? Math.hypot(head[0] - shoulders[0], head[1] - shoulders[1]) * 0.46 : 0,
  };
}

/** Cadenas a un atributo `d` de SVG; un punto ausente levanta la pluma. */
export function chainsToPath(chains: FigurePoint[][]): string {
  let d = "";
  chains.forEach((chain) => {
    let pen = false;
    chain.forEach((p) => {
      if (!p) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
      pen = true;
    });
  });
  return d;
}

export function strokeChains(context: CanvasRenderingContext2D, chains: FigurePoint[][]): void {
  context.beginPath();
  chains.forEach((chain) => {
    let pen = false;
    chain.forEach((p) => {
      if (!p) {
        pen = false;
        return;
      }
      if (pen) context.lineTo(p[0], p[1]);
      else context.moveTo(p[0], p[1]);
      pen = true;
    });
  });
  context.stroke();
}
