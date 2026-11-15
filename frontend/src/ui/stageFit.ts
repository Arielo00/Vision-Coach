/* ---------------------------------------------------------------------------
   Encuadre del visor.

   El video y el canvas comparten una caja (`.video-canvas-frame`). Encuadrar es
   darle a esa caja un tamaño y una posición dentro del visor: el bucle de
   dibujo sigue escalando con `video.clientWidth / job.width`, así que el
   esqueleto queda alineado por construcción y a resolución completa.

   «Atleta» ajusta la escala para que quepa el cuerpo entero durante todo el
   video, con margen. Nunca recorta a la persona para llenar el visor: si el
   video queda más angosto que el visor, se centra y sobran bandas.
   --------------------------------------------------------------------------- */

import type { PoseFrame } from "../types";

export interface Bounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Crop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Caja que ocupa el cuerpo (y el implemento, si se detectó) en todo el video. */
export function athleteBounds(frames: PoseFrame[]): Bounds | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  frames.forEach((frame) => {
    const person = frame.people[0];
    if (person) {
      person.xy.forEach((xy, index) => {
        if (index < 3 || !xy || xy[0] == null || xy[1] == null) return;
        if ((person.keypoint_confidence[index] ?? 0) < 0.4) return;
        x0 = Math.min(x0, xy[0]);
        x1 = Math.max(x1, xy[0]);
        y0 = Math.min(y0, xy[1]);
        y1 = Math.max(y1, xy[1]);
      });
    }
    frame.equipment?.forEach((item) => {
      y0 = Math.min(y0, item.xyxy[1]);
    });
  });
  if (!Number.isFinite(x0) || x1 - x0 < 1 || y1 - y0 < 1) return null;
  const height = y1 - y0;
  /* El tobillo no es el borde del pie ni la oreja el de la cabeza. */
  return { x0, x1, y0: y0 - height * 0.04, y1: y1 + height * 0.07 };
}

export function computeCrop(
  stage: { width: number; height: number },
  videoWidth: number | null,
  videoHeight: number | null,
  bounds: Bounds | null,
): Crop | null {
  if (!stage.width || !stage.height || !videoWidth || !videoHeight) return null;
  const contain = Math.min(stage.width / videoWidth, stage.height / videoHeight);
  let scale = contain;
  let centerX = videoWidth / 2;
  let centerY = videoHeight / 2;
  if (bounds) {
    const fitHeight = stage.height / ((bounds.y1 - bounds.y0) * 1.14);
    const fitWidth = stage.width / ((bounds.x1 - bounds.x0) * 1.5);
    scale = Math.max(contain, Math.min(fitHeight, fitWidth, contain * 4));
    centerX = (bounds.x0 + bounds.x1) / 2;
    centerY = (bounds.y0 + bounds.y1) / 2;
  }
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  const place = (stageSize: number, size: number, center: number) => (
    size <= stageSize
      ? (stageSize - size) / 2
      : Math.min(0, Math.max(stageSize - size, stageSize / 2 - center * scale))
  );
  return {
    left: Math.round(place(stage.width, width, centerX)),
    top: Math.round(place(stage.height, height, centerY)),
    width: Math.round(width),
    height: Math.round(height),
  };
}
