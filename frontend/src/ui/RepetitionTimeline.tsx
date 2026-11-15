/* ---------------------------------------------------------------------------
   03 · Línea de tiempo de repeticiones y fases.

   La línea representa únicamente lo que devolvió la API:
   - Repeticiones con su cuadro de inicio y fin.
   - Las fases que existan en `phase_frames`, que son distintas por ejercicio
     (dip/bottom/drive/lockout en push press, backswing/extension en kettlebell,
     hold_start/peak/hold_end en L-sit). No se asume un ciclo fijo.
   - Estado tripartito: correcta, revisar, no evaluable.
   - Evidencia de contacto solo cuando el motor la reporta.

   Nada se inventa: si un ejercicio no reporta fases, no se dibujan marcas.
   --------------------------------------------------------------------------- */

import { memo } from "react";

import type { BiomechanicsResult } from "../types";
import { phaseMarkers, repetitionState, severityPresentation } from "./presentationAdapters";

interface TimelineProps {
  diagnostics: BiomechanicsResult;
  frameTotal: number;
  selectedRepetition: number | null;
  onSelectRepetition: (repetitionNumber: number, frame: number) => void;
}

function percent(frame: number, total: number): number {
  if (!Number.isFinite(frame) || total <= 0) return 0;
  return Math.min(Math.max((frame / total) * 100, 0), 100);
}

function TimelineTrackBase({
  diagnostics,
  frameTotal,
  selectedRepetition,
  onSelectRepetition,
}: TimelineProps) {
  const contacts = diagnostics.equipment?.contact_events ?? [];

  return (
    <div className="timeline-track">
      <div className="timeline-baseline" aria-hidden="true" />

      {diagnostics.repetitions.map((rep) => {
        const state = repetitionState(rep);
        const left = percent(rep.start_frame, frameTotal);
        const width = Math.max(percent(rep.end_frame, frameTotal) - left, 0.6);
        const phases = phaseMarkers(rep);
        const selected = selectedRepetition === rep.number;
        const findings = rep.errors.length;

        const name = [
          `Repetición ${rep.number}`,
          state.label,
          `confianza ${Math.round(rep.confidence * 100)}%`,
          findings ? `${findings} hallazgo(s)` : "sin hallazgos",
          phases.length ? `fases: ${phases.map((phase) => phase.label).join(", ")}` : "sin fases reportadas",
        ].join(", ");

        return (
          <button
            type="button"
            key={rep.number}
            className={`timeline-rep state-${state.kind} ${selected ? "is-selected" : ""}`}
            style={{ insetInlineStart: `${left}%`, inlineSize: `${width}%` }}
            aria-label={name}
            aria-pressed={selected}
            onClick={() => onSelectRepetition(rep.number, rep.bottom_frame)}
          >
            <span className="timeline-rep-fill" aria-hidden="true" />
            <span className="timeline-rep-number" aria-hidden="true">
              {rep.number}
            </span>
            <span className="timeline-rep-marker" aria-hidden="true">
              {state.marker}
            </span>
            {phases.map((phase) => (
              <span
                key={phase.key}
                className={`timeline-phase ${phase.derived ? "is-derived" : ""}`}
                style={{ insetInlineStart: `${phase.position * 100}%` }}
                aria-hidden="true"
                data-phase={phase.label}
              />
            ))}
            {rep.errors.map((issue) => {
              const severity = severityPresentation(issue.severity);
              const frame = issue.frames[0];
              if (frame == null) return null;
              const span = Math.max(rep.end_frame - rep.start_frame, 1);
              const position = Math.min(Math.max((frame - rep.start_frame) / span, 0), 1);
              return (
                <span
                  key={`${issue.type}-${frame}`}
                  className={`timeline-finding tone-${severity.tone}`}
                  style={{ insetInlineStart: `${position * 100}%` }}
                  aria-hidden="true"
                />
              );
            })}
          </button>
        );
      })}

      {contacts.map((contact) => (
        <span
          key={`contact-${contact.peak_frame}-${contact.kind}`}
          className="timeline-contact"
          style={{ insetInlineStart: `${percent(contact.peak_frame, frameTotal)}%` }}
          title={`Evidencia de contacto (${contact.kind}) · confianza ${Math.round(contact.confidence * 100)}%`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

export const TimelineTrack = memo(TimelineTrackBase);

/* --- Cabezal de reproducción ------------------------------------------------
   Se aísla para que la posición cambie sin reconciliar la pista completa.     */

export function TimelinePlayhead({ frameIndex, frameTotal }: {
  frameIndex: number | null;
  frameTotal: number;
}) {
  if (frameIndex == null || frameTotal <= 0) return null;
  return (
    <span
      className="timeline-playhead"
      style={{ insetInlineStart: `${percent(frameIndex, frameTotal)}%` }}
      aria-hidden="true"
    />
  );
}

/* --- Índice textual ---------------------------------------------------------
   Alternativa vertical, primaria en pantallas angostas y siempre disponible
   para lectura secuencial con teclado.                                        */

export function TimelineIndex({
  diagnostics,
  selectedRepetition,
  onSelectRepetition,
}: Omit<TimelineProps, "frameTotal">) {
  return (
    <ol className="timeline-index">
      {diagnostics.repetitions.map((rep) => {
        const state = repetitionState(rep);
        const phases = phaseMarkers(rep);
        const selected = selectedRepetition === rep.number;
        return (
          <li key={rep.number}>
            <button
              type="button"
              className={`timeline-index-item state-${state.kind} ${selected ? "is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelectRepetition(rep.number, rep.bottom_frame)}
            >
              <span className="timeline-index-number">{String(rep.number).padStart(2, "0")}</span>
              <span className="timeline-index-state">{state.label}</span>
              <span className="timeline-index-confidence">
                {Math.round(rep.confidence * 100)}%
              </span>
              <span className="timeline-index-phases">
                {phases.length
                  ? phases.map((phase) => phase.label).join(" · ")
                  : "Sin fases reportadas"}
              </span>
              {rep.errors.length > 0 && (
                <span className="timeline-index-findings">
                  {rep.errors.length} hallazgo{rep.errors.length === 1 ? "" : "s"}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
