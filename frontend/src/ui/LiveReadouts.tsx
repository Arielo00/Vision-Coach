/* ---------------------------------------------------------------------------
   Lecturas en vivo del cuadro actual.

   Es el único bloque que se reconcilia al ritmo del video (~30 veces por
   segundo durante la reproducción). Se mantiene deliberadamente pequeño: todo
   lo caro —diagnóstico, coaching, fuentes— vive en componentes memoizados que
   no dependen del cuadro.

   Los porcentajes de confianza son el valor CRUDO del modelo. El suavizado
   temporal existe solo para estabilizar el trazo del esqueleto y nunca se
   presenta como si fuera la medición.

   El detalle por articulación se pliega porque compite con la lectura
   principal. El aviso de oclusión NO se pliega: dice qué dejó de dibujarse en
   el cuadro actual y ocultarlo escondería un límite de la medición.
   --------------------------------------------------------------------------- */

import { useCallback, useRef, useState } from "react";

import { ConfidenceMeter, TechnicalLabel } from "./StatusAtoms";
import { confidenceReading, detectionScore } from "./presentationAdapters";
import type { PosePerson } from "../types";

const JOINT_PANEL_KEY = "biomech:joint-panel-open";

function readStoredPreference(): boolean {
  try {
    return window.localStorage.getItem(JOINT_PANEL_KEY) === "1";
  } catch {
    return false;
  }
}

export interface JointRow {
  name: string;
  confidence: number | null;
  /** Por debajo del umbral de dibujo: no se traza y hay que decirlo. */
  occluded: boolean;
}

export interface AngleRow {
  label: string;
  value: number | null;
}

interface LiveReadoutsProps {
  person: PosePerson | undefined;
  overallConfidence: number | null;
  angles: AngleRow[];
  joints: JointRow[];
  frameIndex: number | null;
  frameTotal: number | null;
}

export default function LiveReadouts({
  person,
  overallConfidence,
  angles,
  joints,
  frameIndex,
  frameTotal,
}: LiveReadoutsProps) {
  const overall = confidenceReading(overallConfidence);
  const detection = detectionScore(person);
  const occluded = joints.filter((joint) => joint.occluded);

  /* La preferencia se lee una sola vez: el componente se vuelve a renderizar al
     ritmo del video y no puede tocar `localStorage` en cada cuadro. */
  const initialOpen = useRef(readStoredPreference());
  const [panelOpen, setPanelOpen] = useState(initialOpen.current);

  const onToggle = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const open = event.currentTarget.open;
    setPanelOpen(open);
    try {
      window.localStorage.setItem(JOINT_PANEL_KEY, open ? "1" : "0");
    } catch {
      /* almacenamiento bloqueado: la preferencia dura lo que la sesión */
    }
  }, []);

  return (
    <div className="live-readouts">
      <div className="live-readouts-head">
        <div className="live-confidence">
          <TechnicalLabel>Confianza corporal</TechnicalLabel>
          <strong className={`live-confidence-value tone-${overall.tone}`}>
            {overall.display}
          </strong>
          <span className="live-confidence-level">{overall.label}</span>
        </div>
        <dl className="live-detection">
          <div>
            <dt>Detección</dt>
            <dd>
              {detection.display}
              {detection.kind === "score" && (
                <span className="live-detection-unit"> score</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Cuadro</dt>
            <dd>
              {frameIndex ?? "—"}
              <span className="live-detection-total">
                {frameTotal ? ` / ${frameTotal}` : ""}
              </span>
            </dd>
          </div>
        </dl>
      </div>

      {detection.note && <p className="live-note">{detection.note}</p>}

      <section className="angle-readouts" aria-label="Ángulos articulares del cuadro actual">
        {angles.map((angle) => (
          <div key={angle.label} className={angle.value == null ? "is-unmeasured" : ""}>
            <span>{angle.label}</span>
            <strong>{angle.value == null ? "—" : `${Math.round(angle.value)}°`}</strong>
            {angle.value == null && <small>NO EVALUABLE</small>}
          </div>
        ))}
      </section>

      {/* El aviso de oclusión va antes del panel y nunca se pliega. */}
      {occluded.length > 0 && (
        <p className="joint-occluded">
          <span className="joint-occluded-mark" aria-hidden="true" />
          <strong>ARTICULACIÓN OCLUIDA</strong>
          <span>
            {occluded.length === 1
              ? `${occluded[0].name} no se dibuja en este cuadro: está bajo el umbral de trazo.`
              : `${occluded.length} articulaciones no se dibujan en este cuadro: están bajo el umbral de trazo.`}
          </span>
        </p>
      )}

      <details className="joint-panel" open={panelOpen} onToggle={onToggle}>
        <summary>
          <span className="disclosure-marker" aria-hidden="true" />
          <span className="joint-panel-title">Confianza por articulación</span>
          <span className="joint-panel-count">{joints.length}</span>
        </summary>
        <div className="joint-panel-body">
          <div className="joint-readouts-list">
            {joints.map((joint) => (
              <ConfidenceMeter
                key={joint.name}
                name={joint.name}
                reading={confidenceReading(joint.confidence)}
                compact
              />
            ))}
          </div>
          <p className="live-legend">
            Los porcentajes son la confianza cruda del modelo. El esqueleto usa
            coordenadas suavizadas para no vibrar; ese suavizado no altera estos
            valores.
          </p>
        </div>
      </details>
    </div>
  );
}
