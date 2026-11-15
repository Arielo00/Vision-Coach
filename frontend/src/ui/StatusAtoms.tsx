/* ---------------------------------------------------------------------------
   Primitivas de estado.

   Cada átomo comunica su estado con al menos dos canales: texto + color, o
   texto + patrón. Ninguno depende del color por sí solo, y ninguno reduce el
   contraste del texto para expresar incertidumbre.
   --------------------------------------------------------------------------- */

import type { ReactNode } from "react";

import type { AvailabilityState, ConfidenceReading, Tone } from "./uiTypes";

/* --- Etiqueta técnica ------------------------------------------------------ */

export function TechnicalLabel({ children, as: Tag = "span" }: {
  children: ReactNode;
  as?: "span" | "h2" | "h3" | "h4" | "p" | "dt";
}) {
  return <Tag className="tech-label">{children}</Tag>;
}

/* --- Insignia de estado ---------------------------------------------------- */

export function StateBadge({ tone, pattern = "solid", children, title }: {
  tone: Tone;
  pattern?: "solid" | "dashed" | "dotted" | "hatched";
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`state-badge tone-${tone} pattern-${pattern}`} title={title}>
      <span className="state-badge-mark" aria-hidden="true" />
      <span className="state-badge-text">{children}</span>
    </span>
  );
}

/* --- Disponibilidad --------------------------------------------------------
   El punto es decorativo; la etiqueta textual es la fuente de verdad.        */

export function AvailabilityChip({ state, name, probe }: {
  state: AvailabilityState;
  name: string;
  /** Cómo se obtuvo el estado: no todos los indicadores se contactan igual. */
  probe?: string;
}) {
  return (
    <div className={`availability-chip tone-${state.tone}`}>
      <span className="availability-dot" aria-hidden="true" />
      <span className="availability-name">{name}</span>
      <span className="availability-state">{state.label}</span>
      {probe && <span className="availability-probe">Comprobación: {probe}</span>}
      {state.detail && <span className="availability-detail">{state.detail}</span>}
    </div>
  );
}

/* --- Confianza -------------------------------------------------------------
   Número + barra + patrón + etiqueta. El texto mantiene contraste completo en
   todos los niveles: la incertidumbre nunca se expresa atenuando la lectura.  */

export function ConfidenceMeter({ reading, name, compact = false }: {
  reading: ConfidenceReading;
  name: string;
  compact?: boolean;
}) {
  const percent = reading.value == null ? 0 : Math.round(reading.value * 100);
  const describedBy = `${name.replace(/\s+/g, "-").toLowerCase()}-confianza`;

  return (
    <div className={`confidence-meter tone-${reading.tone} ${compact ? "is-compact" : ""}`}>
      <span className="confidence-meter-name">{name}</span>
      <span
        className={`confidence-meter-track pattern-${reading.pattern}`}
        role="img"
        aria-label={`${name}: ${reading.display}, ${reading.label.toLowerCase()}`}
      >
        <span
          className="confidence-meter-fill"
          style={{ inlineSize: `${percent}%` }}
        />
      </span>
      <span className="confidence-meter-value" id={describedBy}>
        {reading.display}
      </span>
      {!compact && <span className="confidence-meter-level">{reading.label}</span>}
    </div>
  );
}

/* --- Estado vacío / no evaluable ------------------------------------------- */

export function NotEvaluable({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="not-evaluable">
      <span className="not-evaluable-mark" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

/* --- Par dato/valor con numerales tabulares -------------------------------- */

export function DataPair({ label, value, note, tone }: {
  label: string;
  value: ReactNode;
  note?: string | null;
  tone?: Tone;
}) {
  return (
    <div className={`data-pair ${tone ? `tone-${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>
        <span className="data-pair-value">{value}</span>
        {note && <span className="data-pair-note">{note}</span>}
      </dd>
    </div>
  );
}

/* --- Origen de la información ----------------------------------------------
   Distingue visual y textualmente de dónde viene cada afirmación.            */

export type EvidenceSource =
  | "regla"
  | "medicion"
  | "recuperacion"
  | "generado"
  | "sistema";

const SOURCE_LABEL: Record<EvidenceSource, string> = {
  regla: "Regla determinista",
  medicion: "Medición de visión",
  recuperacion: "Fuente recuperada",
  generado: "Texto generado",
  sistema: "Estado del sistema",
};

export function SourceTag({ source }: { source: EvidenceSource }) {
  return (
    <span className={`source-tag source-${source}`}>
      <span className="source-tag-glyph" aria-hidden="true" />
      {SOURCE_LABEL[source]}
    </span>
  );
}
