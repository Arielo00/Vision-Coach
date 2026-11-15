/* ---------------------------------------------------------------------------
   Carcasa de video + canvas.

   CONTRATO CRÍTICO
   Este componente jamás debe remontarse. El <video> y el <canvas> conservan su
   identidad durante cualquier cambio de vista, panel o animación, porque
   remontarlos reiniciaría la reproducción, el canvas y la posición actual.
   Por eso está memoizado con comparación explícita y no acepta `children`
   variables ni props que cambien cuadro a cuadro.

   CORRECCIÓN DE ALINEACIÓN
   El bucle de dibujo escala con `video.clientWidth / job.width`, lo que asume
   que la caja del elemento coincide exactamente con el área pintada. Con
   `max-height` sobre el <video>, un clip vertical se dibuja con bandas
   (`object-fit: contain` es el valor por omisión) y el esqueleto queda
   desplazado. Aquí el límite de altura se aplica al ancho del contenedor
   derivándolo de la relación de aspecto real, de modo que el video llena su
   caja por construcción y el desfase no puede ocurrir.
   --------------------------------------------------------------------------- */

import { memo, type CSSProperties, type ReactNode, type RefObject } from "react";

import type { Crop } from "./stageFit";

interface VideoCanvasShellProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  src: string;
  width: number | null;
  height: number | null;
  /** Superposiciones estáticas; no deben depender del cuadro actual. */
  overlay?: ReactNode;
  /**
   * Encuadre dentro de un visor de tamaño fijo. Mueve y escala la caja que
   * comparten el video y el canvas; no remonta ninguno de los dos.
   */
  crop?: Crop | null;
}

function VideoCanvasShellBase({
  videoRef,
  canvasRef,
  src,
  width,
  height,
  overlay,
  crop = null,
}: VideoCanvasShellProps) {
  const hasGeometry = Boolean(width && height);
  const style = hasGeometry
    ? ({ "--job-aspect": `${width} / ${height}` } as CSSProperties)
    : undefined;

  return (
    <div
      className={`video-canvas-shell ${hasGeometry ? "has-geometry" : ""} ${crop ? "is-fitted" : ""}`}
      style={style}
    >
      <div
        className="video-canvas-frame"
        style={crop ? { left: crop.left, top: crop.top, width: crop.width, height: crop.height } : undefined}
      >
        {/* Sin controles nativos: el transporte propio ofrece paso por cuadro,
            cámara lenta y repetición de una repetición. */}
        <video ref={videoRef} src={src} preload="metadata" playsInline />
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      {overlay}
    </div>
  );
}

/**
 * Se re-renderiza solo si cambia el video de origen o su geometría. La
 * superposición se compara por identidad, así que debe venir memoizada desde
 * el padre para no provocar reconciliación innecesaria.
 */
export default memo(VideoCanvasShellBase, (previous, next) =>
  previous.src === next.src &&
  previous.width === next.width &&
  previous.height === next.height &&
  previous.overlay === next.overlay &&
  previous.crop?.left === next.crop?.left &&
  previous.crop?.top === next.crop?.top &&
  previous.crop?.width === next.crop?.width &&
  previous.crop?.height === next.crop?.height &&
  previous.videoRef === next.videoRef &&
  previous.canvasRef === next.canvasRef);
