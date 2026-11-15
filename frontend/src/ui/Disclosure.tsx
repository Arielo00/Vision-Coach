/* ---------------------------------------------------------------------------
   Divulgación accesible.

   Se apoya en `<details>/<summary>` nativo: teclado, semántica y estado
   expandido los aporta el navegador. La interfaz solo añade el marcador
   visible, porque quitar el triángulo sin reemplazarlo deja el control sin
   señal de que se puede abrir.
   --------------------------------------------------------------------------- */

import type { ReactNode } from "react";

interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  /** Metadato corto alineado a la derecha del encabezado. */
  meta?: ReactNode;
  defaultOpen?: boolean;
  tone?: string;
  className?: string;
}

export default function Disclosure({
  summary,
  children,
  meta,
  defaultOpen = false,
  tone,
  className = "",
}: DisclosureProps) {
  return (
    <details
      className={`disclosure ${tone ? `tone-${tone}` : ""} ${className}`.trim()}
      open={defaultOpen}
    >
      <summary>
        <span className="disclosure-marker" aria-hidden="true" />
        <span className="disclosure-summary-text">{summary}</span>
        {meta && <span className="disclosure-meta">{meta}</span>}
      </summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
