/* ---------------------------------------------------------------------------
   Cronofotografía de una repetición.

   Como las placas de Marey: la misma persona, una pose tras otra, desplazada a
   la derecha en proporción al tiempo. En un ejercicio que se hace en el sitio
   las poses se encimarían; desplegarlas deja ver la forma completa del gesto.

   Gris: del inicio al punto bajo. Claro: del punto bajo al final. Lima: el
   cuadro que se está viendo. Las dos líneas finas son las trayectorias de la
   muñeca y de la cadera.

   Es una vista de lo que ya midió el modelo; no añade ninguna evaluación.
   --------------------------------------------------------------------------- */

import { useEffect, useMemo, useRef, useState } from "react";

import type { BiomechanicsRepetition, PoseFrame } from "../types";
import { ankleAnchor, figureChains, strokeChains, type FigurePoint } from "./poseFigure";
import { sideJoints, type BodySide } from "./signals";

const INK = "#f0ede5";
const MUTED = "#6f7672";
const ACCENT = "#d8ff3e";
const FLOOR = "rgba(240, 237, 229, 0.18)";

interface ChronoPlateProps {
  frames: PoseFrame[];
  repetition: BiomechanicsRepetition | null;
  currentFrame: number | null;
  nearSide: BodySide;
  onSeekToFrame: (frame: number) => void;
}

interface Layout {
  start: number;
  span: number;
  first: number;
  last: number;
}

export default function ChronoPlate({ frames, repetition, currentFrame, nearSide, onSeekToFrame }: ChronoPlateProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<Layout | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      setSize((current) => (
        Math.abs(current.width - rect.width) < 0.5 && Math.abs(current.height - rect.height) < 0.5
          ? current
          : { width: rect.width, height: rect.height }
      ));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  /* Cuadros de la repetición y la caja que ocupa el cuerpo en ellos. Solo
     cambia al cambiar de repetición, no al ritmo del video. */
  const segment = useMemo(() => {
    if (!repetition) return null;
    const items = frames.filter((frame) => (
      frame.frame_index >= repetition.start_frame && frame.frame_index <= repetition.end_frame && frame.people[0]
    ));
    if (items.length < 3) return null;
    let top = Infinity;
    let bottom = -Infinity;
    items.forEach((frame) => {
      const person = frame.people[0];
      person.xy.forEach((xy, index) => {
        if (index < 3 || !xy || xy[1] == null || (person.keypoint_confidence[index] ?? 0) < 0.4) return;
        top = Math.min(top, xy[1]);
        bottom = Math.max(bottom, xy[1]);
      });
    });
    if (!Number.isFinite(top) || bottom - top < 1) return null;
    return { items, top, bottom };
  }, [frames, repetition]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !size.width || !size.height) return;
    const ratio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(size.width * ratio);
    const targetHeight = Math.round(size.height * ratio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    layoutRef.current = null;
    if (!segment || !repetition) return;

    const { items, top, bottom } = segment;
    const padTop = 44;
    const padBottom = 32;
    const padX = 16;
    const scale = ((size.height - padTop - padBottom) / ((bottom - top) * 1.12)) * 0.9;
    const half = 52 * scale;
    const start = padX + half;
    const span = Math.max(size.width - 2 * padX - 2 * half, 1);
    const first = items[0].frame_index;
    const last = items[items.length - 1].frame_index;
    const baseX = (frameIndex: number) => start + ((frameIndex - first) / Math.max(last - first, 1)) * span;
    const floorY = size.height - padBottom;
    const mapFor = (frame: PoseFrame) => {
      const anchor = ankleAnchor(frame.people[0]);
      const x0 = baseX(frame.frame_index);
      return (x: number, y: number): [number, number] => (
        anchor ? [x0 + (x - anchor[0]) * scale, floorY + (y - anchor[1]) * scale] : [x0, floorY]
      );
    };
    layoutRef.current = { start, span, first, last };

    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = FLOOR;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, floorY + 5.5);
    context.lineTo(size.width, floorY + 5.5);
    context.stroke();

    /* Trayectorias continuas de la muñeca visible y de la cadera. */
    const near = sideJoints(nearSide);
    const trace = (pick: (frame: PoseFrame) => FigurePoint) => {
      context.beginPath();
      let pen = false;
      items.forEach((frame) => {
        const p = pick(frame);
        if (!p) {
          pen = false;
          return;
        }
        if (pen) context.lineTo(p[0], p[1]);
        else context.moveTo(p[0], p[1]);
        pen = true;
      });
      context.globalAlpha = 0.5;
      context.strokeStyle = INK;
      context.lineWidth = 1.25;
      context.stroke();
      context.globalAlpha = 1;
    };
    const joint = (frame: PoseFrame, index: number): FigurePoint => {
      const person = frame.people[0];
      const xy = person.xy[index];
      if (!xy || xy[0] == null || xy[1] == null || (person.keypoint_confidence[index] ?? 0) < 0.4) return null;
      return mapFor(frame)(xy[0], xy[1]);
    };
    trace((frame) => joint(frame, near.wrist));
    trace((frame) => {
      const a = joint(frame, 11);
      const b = joint(frame, 12);
      return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;
    });

    /* Poses a intervalos regulares; la más cercana al punto bajo se sustituye
       por el punto bajo exacto. */
    const count = Math.max(5, Math.min(14, Math.round(span / (30 * Math.max(0.8, scale))) + 1));
    const picks = Array.from({ length: count }, (_, i) => Math.round((i * (items.length - 1)) / (count - 1)));
    const bottomPosition = items.reduce((best, frame, index) => (
      Math.abs(frame.frame_index - repetition.bottom_frame) < Math.abs(items[best].frame_index - repetition.bottom_frame) ? index : best
    ), 0);
    const nearestPick = picks.reduce((best, position, index) => (
      Math.abs(position - bottomPosition) < Math.abs(picks[best] - bottomPosition) ? index : best
    ), 0);
    picks[nearestPick] = bottomPosition;

    const drawPose = (frame: PoseFrame, color: string, weight: number, halo: boolean) => {
      const figure = figureChains(frame.people[0], nearSide, mapFor(frame));
      const pass = (stroke: string, extra: number) => {
        context.strokeStyle = stroke;
        context.lineWidth = weight + extra;
        strokeChains(context, figure.core);
        strokeChains(context, figure.near);
        if (figure.head && figure.headRadius) {
          context.beginPath();
          context.arc(figure.head[0], figure.head[1] - figure.headRadius * 0.1, figure.headRadius, 0, Math.PI * 2);
          context.stroke();
        }
      };
      if (halo) pass("rgba(4, 5, 5, 0.75)", 2.4);
      pass(color, 0);
    };
    picks.forEach((position) => {
      const frame = items[position];
      drawPose(frame, frame.frame_index < repetition.bottom_frame ? MUTED : INK, 1.8, false);
    });
    if (currentFrame != null && currentFrame >= first && currentFrame <= last) {
      const current = items.reduce((best, frame) => (
        Math.abs(frame.frame_index - currentFrame) < Math.abs(best.frame_index - currentFrame) ? frame : best
      ), items[0]);
      drawPose(current, ACCENT, 2.6, true);
    }

    context.font = "12px Bahnschrift, 'DIN Alternate', 'Segoe UI', system-ui, sans-serif";
    context.fillStyle = "#a8ada8";
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    context.fillText("inicio", padX, size.height - 10);
    context.textAlign = "right";
    context.fillText("fin", size.width - padX, size.height - 10);
    context.textAlign = "center";
    context.fillText(
      "punto bajo",
      Math.min(Math.max(baseX(repetition.bottom_frame), 76), size.width - 64),
      size.height - 10,
    );
  }, [segment, repetition, currentFrame, nearSide, size]);

  return (
    <div
      className="chrono-plate"
      ref={boxRef}
      onPointerDown={(event) => {
        const layout = layoutRef.current;
        const canvas = canvasRef.current;
        if (!layout || !canvas) return;
        const x = event.clientX - canvas.getBoundingClientRect().left;
        const fraction = Math.min(Math.max((x - layout.start) / layout.span, 0), 1);
        onSeekToFrame(Math.round(layout.first + fraction * (layout.last - layout.first)));
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={repetition
          ? `Cronofotografía de la repetición ${repetition.number}: las poses del inicio al final, desplegadas en el tiempo`
          : "Cronofotografía: sin repetición seleccionada"}
      />
      <p className="chrono-plate-caption">
        <strong>{repetition ? `Cronofotografía · rep. ${repetition.number}` : "Cronofotografía"}</strong>
        <span>{segment ? "la repetición desplegada en el tiempo" : "aparece cuando hay una repetición detectada"}</span>
      </p>
    </div>
  );
}
