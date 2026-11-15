/* ---------------------------------------------------------------------------
   Utilidades de movimiento.

   Web Animations API nativa: sin dependencias, sin bucles de render en React y
   sin animar estado de React cuadro a cuadro. Todo respeta `prefers-reduced-
   motion` y todo se puede cancelar al desmontar.
   --------------------------------------------------------------------------- */

import { useEffect, useRef, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Se suscribe al cambio de preferencia en vivo, no solo al montar. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => prefersReducedMotion());

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    setReduced(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Contexto de animación con limpieza garantizada.
 *
 * Cada vista mayor crea el suyo y lo cierra al desmontar. Evita timelines
 * duplicados durante los remontajes de desarrollo de StrictMode.
 */
export class MotionScope {
  private animations = new Set<Animation>();
  private disposed = false;

  animate(
    element: Element | null | undefined,
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ): Animation | null {
    if (!element || this.disposed) return null;
    if (prefersReducedMotion()) return null;
    if (typeof element.animate !== "function") return null;

    const animation = element.animate(keyframes, { fill: "both", ...options });
    this.animations.add(animation);
    const forget = () => this.animations.delete(animation);
    animation.addEventListener("finish", forget, { once: true });
    animation.addEventListener("cancel", forget, { once: true });
    return animation;
  }

  /** Termina las animaciones dejando el estado final aplicado. */
  finish(): void {
    this.animations.forEach((animation) => {
      try {
        animation.finish();
      } catch {
        /* la animación ya terminó o fue cancelada */
      }
    });
    this.animations.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.animations.forEach((animation) => animation.cancel());
    this.animations.clear();
  }

  /**
   * Vuelve a habilitar el contexto tras un `dispose()`.
   *
   * React Strict Mode monta, desmonta y vuelve a montar en desarrollo. Como la
   * ref sobrevive a ese ciclo, sin esto el contexto quedaría marcado como
   * descartado de forma permanente y ninguna animación volvería a ejecutarse.
   */
  reopen(): void {
    this.disposed = false;
  }
}

/** Crea un `MotionScope` ligado al ciclo de vida del componente. */
export function useMotionScope(): MotionScope {
  const scopeRef = useRef<MotionScope | null>(null);
  if (scopeRef.current === null) scopeRef.current = new MotionScope();

  useEffect(() => {
    const scope = scopeRef.current;
    scope?.reopen();
    return () => scope?.dispose();
  }, []);

  return scopeRef.current;
}

/* --- Transformación de una caja en otra ------------------------------------

   FLIP: se mide el origen, se deja que el layout cambie, se mide el destino y
   se anima la diferencia. A diferencia de `startViewTransition`, no depende de
   que el documento esté pintando, así que funciona también en paneles
   incrustados y en pestañas que acaban de mostrarse.

   Solo se anima `transform` y `opacity` del elemento destino: no se remonta
   nada y `clientWidth` no cambia, así que el bucle de dibujo del canvas sigue
   escalando con la misma geometría durante toda la animación.               */

export interface MorphOptions {
  duration?: number;
  easing?: string;
  /** Elemento interno que se desvanece aparte para que no se estire. */
  content?: Element | null;
}

export function morphFrom(
  origin: DOMRect,
  target: HTMLElement | null,
  options: MorphOptions = {},
): Animation | null {
  if (!target || prefersReducedMotion() || typeof target.animate !== "function") return null;

  /* Con el documento oculto el reloj de animación no avanza: la animación se
     quedaría congelada en su primer fotograma y, con `fill: both`, dejaría el
     elemento desplazado y encogido. No hay nada que mirar, así que no se anima. */
  if (typeof document !== "undefined" && document.hidden) return null;

  const destino = target.getBoundingClientRect();
  if (!destino.width || !destino.height) return null;

  const dx = origin.left - destino.left;
  const dy = origin.top - destino.top;
  const sx = origin.width / destino.width;
  const sy = origin.height / destino.height;

  /* Si apenas hay diferencia, animar solo añade ruido. */
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(sx - 1) < 0.02 && Math.abs(sy - 1) < 0.02) {
    return null;
  }

  const duration = options.duration ?? 420;
  const easing = options.easing ?? "cubic-bezier(0.32, 0, 0.16, 1)";
  const previo = target.style.transformOrigin;
  target.style.transformOrigin = "top left";

  const animation = target.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.55 },
      { transform: "none", opacity: 1 },
    ],
    { duration, easing, fill: "both" },
  );

  /* Al terminar o cancelarse se limpia todo rastro inline: el elemento vuelve a
     depender solo de la hoja de estilos y nunca queda con una transformada
     residual pegada. */
  const limpiar = () => {
    target.style.transformOrigin = previo;
    try {
      animation.commitStyles?.();
    } catch {
      /* commitStyles falla si el elemento ya no está en el documento */
    }
    target.style.transform = "";
    target.style.opacity = "";
  };
  animation.addEventListener("finish", limpiar, { once: true });
  animation.addEventListener("cancel", limpiar, { once: true });

  if (options.content) {
    (options.content as HTMLElement).animate?.(
      [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }],
      { duration, easing, fill: "both" },
    );
  }

  return animation;
}

/* --- Transiciones de vista -------------------------------------------------
   `startViewTransition` como mejora progresiva. Si el navegador no la soporta
   o el usuario pidió menos movimiento, el cambio ocurre igual, sin animación.
   Nunca es requisito para navegar.                                           */

/**
 * `startViewTransition` ya está tipado por la librería DOM, pero no existe en
 * todos los navegadores. La detección en tiempo de ejecución es la que manda:
 * si no está, o si el usuario pidió menos movimiento, el cambio se aplica igual
 * y sin animación.
 */
export function withViewTransition(update: () => void): void {
  const start = document.startViewTransition;
  if (prefersReducedMotion() || typeof start !== "function") {
    update();
    return;
  }

  try {
    const transition = start.call(document, update);
    /* La transición se aborta legítimamente en varios casos —pestaña oculta,
       otra transición en curso, cambio de tamaño a mitad— y entonces rechaza
       sus promesas. El cambio de vista ya se aplicó de todos modos, así que se
       absorben en silencio en lugar de dejar rechazos sin capturar. */
    transition?.ready?.catch(() => undefined);
    transition?.finished?.catch(() => undefined);
    transition?.updateCallbackDone?.catch(() => undefined);
  } catch {
    /* Si el navegador rechaza iniciarla, la navegación ocurre igual. */
    update();
  }
}
