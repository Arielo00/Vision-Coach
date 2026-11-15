/* ---------------------------------------------------------------------------
   00 · Secuencia de inicialización.

   Restricciones deliberadas:
   - Nunca muestra un porcentaje: no hay una medida real de "listo" que reportar.
     La línea es una calibración indeterminada y honesta.
   - No afirma que RF-DETR, el RAG, Ollama o Google estén disponibles.
   - No bloquea nada: la aplicación ya está montada y es usable debajo.
   - Se salta con cualquier tecla, clic o scroll.
   - Se reproduce una sola vez por sesión, nunca en navegación interna.
   - Bajo `prefers-reduced-motion` no se monta en absoluto.
   --------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from "react";

import { useMotionScope, useReducedMotion } from "./motion";

const SESSION_KEY = "biomech:init-played";
const TOTAL_DURATION = 880;

function alreadyPlayed(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markPlayed(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* almacenamiento bloqueado: la secuencia simplemente se repetirá */
  }
}

export default function InitializationSequence() {
  const reducedMotion = useReducedMotion();
  const scope = useMotionScope();
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(() => !alreadyPlayed() && !prefersReducedAtBoot());

  useEffect(() => {
    if (!visible) return;
    markPlayed();

    const dismiss = () => setVisible(false);
    const timer = window.setTimeout(dismiss, TOTAL_DURATION);

    window.addEventListener("keydown", dismiss, { once: true });
    window.addEventListener("pointerdown", dismiss, { once: true });
    window.addEventListener("wheel", dismiss, { once: true, passive: true });

    scope.animate(
      lineRef.current,
      [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }],
      { duration: 560, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
    scope.animate(
      rootRef.current,
      [
        { opacity: 1, clipPath: "inset(0 0 0% 0)" },
        { opacity: 1, clipPath: "inset(0 0 100% 0)" },
      ],
      { duration: 260, delay: TOTAL_DURATION - 260, easing: "cubic-bezier(0.32, 0, 0.16, 1)" },
    );

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("wheel", dismiss);
    };
  }, [visible, scope]);

  if (reducedMotion || !visible) return null;

  return (
    <div className="init-sequence" ref={rootRef} aria-hidden="true">
      <div className="init-sequence-inner">
        <p className="init-wordmark">BIOMECH COACH</p>
        <p className="init-status">CALIBRANDO INTERFAZ</p>
        <span className="init-line" ref={lineRef} />
        <p className="init-modules">POSE / REGLAS / RAG</p>
      </div>
      <button
        type="button"
        className="init-skip"
        onClick={() => setVisible(false)}
        tabIndex={-1}
      >
        Saltar
      </button>
    </div>
  );
}

/**
 * Lectura sincrónica en el primer render: evita que la secuencia aparezca un
 * instante antes de que el efecto detecte la preferencia de movimiento.
 */
function prefersReducedAtBoot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
