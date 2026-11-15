/* ---------------------------------------------------------------------------
   Transporte del video.

   Sustituye a los controles nativos del navegador, que no ofrecen lo que pide
   revisar técnica: avanzar cuadro a cuadro, ver en cámara lenta y repetir una
   sola repetición. El componente no guarda estado: el dueño del <video> sigue
   siendo el banco de análisis.
   --------------------------------------------------------------------------- */

import { memo } from "react";

export const PLAYBACK_RATES = [0.25, 0.5, 1] as const;
const RATE_LABEL: Record<number, string> = { 0.25: "0.25×", 0.5: "0.5×", 1: "1×" };

interface TransportProps {
  playing: boolean;
  rate: number;
  loop: boolean;
  canLoop: boolean;
  hasRepetitions: boolean;
  onTogglePlay: () => void;
  onStep: (frames: number) => void;
  onStepRepetition: (direction: -1 | 1) => void;
  onRate: (rate: number) => void;
  onToggleLoop: () => void;
}

function Icon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path
        d={path}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={filled ? 1.2 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TransportBase({
  playing,
  rate,
  loop,
  canLoop,
  hasRepetitions,
  onTogglePlay,
  onStep,
  onStepRepetition,
  onRate,
  onToggleLoop,
}: TransportProps) {
  return (
    <div className="transport-main" role="group" aria-label="Reproducción">
      <button
        type="button"
        className="transport-icon"
        aria-label="Repetición anterior"
        title="Repetición anterior ([)"
        disabled={!hasRepetitions}
        onClick={() => onStepRepetition(-1)}
      >
        <Icon path="M4 3v10M12.5 3.5L6.5 8l6 4.5z" filled />
      </button>
      <button
        type="button"
        className="transport-icon"
        aria-label="Cuadro anterior"
        title="Cuadro anterior (←)"
        onClick={() => onStep(-1)}
      >
        <Icon path="M10 3.5L5 8l5 4.5" />
      </button>
      <button
        type="button"
        className="transport-play"
        aria-label={playing ? "Pausar" : "Reproducir"}
        title="Reproducir o pausar (espacio)"
        onClick={onTogglePlay}
      >
        <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
          <path d={playing ? "M4 2.8h3v10.4H4zM9 2.8h3v10.4H9z" : "M4.5 2.8v10.4L13 8z"} fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="transport-icon"
        aria-label="Cuadro siguiente"
        title="Cuadro siguiente (→)"
        onClick={() => onStep(1)}
      >
        <Icon path="M6 3.5L11 8l-5 4.5" />
      </button>
      <button
        type="button"
        className="transport-icon"
        aria-label="Repetición siguiente"
        title="Repetición siguiente (])"
        disabled={!hasRepetitions}
        onClick={() => onStepRepetition(1)}
      >
        <Icon path="M12 3v10M3.5 3.5L9.5 8l-6 4.5z" filled />
      </button>

      <div className="transport-rates" role="group" aria-label="Velocidad">
        {PLAYBACK_RATES.map((option) => (
          <button
            type="button"
            key={option}
            aria-pressed={rate === option}
            onClick={() => onRate(option)}
          >
            {RATE_LABEL[option]}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="transport-loop"
        aria-pressed={loop}
        disabled={!canLoop}
        title="Repetir la repetición seleccionada (L)"
        onClick={onToggleLoop}
      >
        Repetir rep.
      </button>
    </div>
  );
}

/** Los botones no dependen del cuadro actual, así que no se reconcilian al
    ritmo del video. El reloj vive aparte, en `TransportClock`. */
export const TransportControls = memo(TransportBase);

export function TransportClock({ frameIndex, frameTotal, fps }: {
  frameIndex: number | null;
  frameTotal: number;
  fps: number | null;
}) {
  const seconds = frameIndex != null && fps ? frameIndex / fps : null;
  const clock = seconds == null
    ? "--:--.--"
    : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
  return (
    <div className="transport-time">
      <strong>{clock}</strong>
      <span>cuadro {frameIndex ?? "—"}{frameTotal ? ` / ${frameTotal}` : ""}</span>
    </div>
  );
}
