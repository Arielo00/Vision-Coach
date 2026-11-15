/* ---------------------------------------------------------------------------
   Selector de ejercicio.

   Dos correcciones respecto de la versión anterior:

   1. La insignia de motor ya no sale de conjuntos escritos a mano en el
      frontend. Ahora viene de `/api/catalog/coverage`, así que no puede
      desviarse de lo que el backend realmente soporta. Si la cobertura no
      llegó, no se afirma nada.

   2. Patrón de combobox accesible: `aria-activedescendant` para el foco
      virtual, navegación con flechas, Inicio/Fin, Enter para elegir y Escape
      que cierra devolviendo el foco al disparador.
   --------------------------------------------------------------------------- */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { categoryLabels, exercises, type ExerciseCategory } from "./exerciseCatalog";
import type { CatalogCoveragePayload, ExerciseId } from "./types";
import { exerciseCoverage } from "./ui/presentationAdapters";
import { normalizeForSearch } from "./ui/text";

const categoryOrder: ExerciseCategory[] = ["automatic", "crossfit", "calisthenics", "hyrox"];

interface ExercisePickerProps {
  value: ExerciseId;
  onChange: (value: ExerciseId) => void;
  coverage?: CatalogCoveragePayload | null;
}

export default function ExercisePicker({ value, onChange, coverage = null }: ExercisePickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = exercises.find((item) => item.id === value) ?? exercises[0];

  const grouped = useMemo(() => {
    const needle = normalizeForSearch(query.trim());
    return categoryOrder
      .map((category) => ({
        category,
        items: exercises.filter((item) => {
          if (!(item.categories ?? [item.category]).includes(category)) return false;
          if (!needle) return true;
          return normalizeForSearch([item.label, item.id, ...(item.keywords ?? [])].join(" ")).includes(needle);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [query]);

  /**
   * Lista aplanada en orden visual: es la que recorren las flechas.
   *
   * Un ejercicio compartido entre disciplinas —muscle-up, rowing— aparece en
   * varios grupos reutilizando el MISMO objeto del catálogo. Por eso la entrada
   * lleva su categoría: la identidad visual es `categoría + ejercicio`, y así el
   * `id` del DOM es único y el índice activo no colapsa dos filas distintas en
   * una sola. El registro de datos no se duplica.
   */
  const flatItems = useMemo(
    () =>
      grouped.flatMap((group) =>
        group.items.map((item) => ({ category: group.category, item })),
      ),
    [grouped],
  );

  const optionId = useCallback(
    (category: ExerciseCategory, id: ExerciseId) => `${baseId}-option-${category}-${id}`,
    [baseId],
  );

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(flatItems.length - 1, 0)));
  }, [flatItems.length]);

  /** Mantiene visible la opción con foco virtual. */
  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(id: ExerciseId) {
    onChange(id);
    close(true);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (!flatItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flatItems.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + flatItems.length) % flatItems.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(flatItems.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = flatItems[activeIndex];
      if (entry) choose(entry.item.id);
    }
  }

  const selectedCoverage = exerciseCoverage(coverage, selected.id);

  return (
    <div className="exercise-picker" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className="exercise-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${baseId}-listbox`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="exercise-picker-value">
          <small>
            {(selected.categories ?? [selected.category])
              .map((category) => categoryLabels[category])
              .join(" · ")}
          </small>
          <strong>{selected.label}</strong>
          {selectedCoverage.label && (
            <em className={`coverage-tag tone-${selectedCoverage.tone}`}>{selectedCoverage.label}</em>
          )}
        </span>
        <span className="exercise-picker-caret" aria-hidden="true" />
      </button>

      {open && (
        <div className="exercise-picker-popover">
          <label className="exercise-search">
            <span className="visually-hidden">Buscar ejercicio</span>
            <span className="exercise-search-glyph" aria-hidden="true" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls={`${baseId}-listbox`}
              aria-autocomplete="list"
              aria-activedescendant={
                flatItems[activeIndex]
                  ? optionId(flatItems[activeIndex].category, flatItems[activeIndex].item.id)
                  : undefined
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Buscar ejercicio…"
            />
          </label>

          <div
            className="exercise-options"
            role="listbox"
            id={`${baseId}-listbox`}
            aria-label="Ejercicios disponibles"
            ref={listRef}
          >
            {grouped.length ? (
              grouped.map((group) => (
                <div
                  key={group.category}
                  role="group"
                  aria-labelledby={`${baseId}-group-${group.category}`}
                >
                  <h4 id={`${baseId}-group-${group.category}`}>{categoryLabels[group.category]}</h4>
                  {group.items.map((item) => {
                    /* Se busca por categoría + ejercicio: `indexOf(item)` sobre
                       el objeto compartido devolvería siempre la primera
                       aparición y activaría la fila equivocada. */
                    const flatIndex = flatItems.findIndex(
                      (entry) => entry.category === group.category && entry.item.id === item.id,
                    );
                    const isActive = flatIndex === activeIndex;
                    const itemCoverage = exerciseCoverage(coverage, item.id);
                    return (
                      <div
                        key={`${group.category}-${item.id}`}
                        id={optionId(group.category, item.id)}
                        role="option"
                        aria-selected={item.id === value}
                        data-active={isActive}
                        className={`exercise-option ${item.id === value ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                        onClick={() => choose(item.id)}
                        onMouseEnter={() => flatIndex >= 0 && setActiveIndex(flatIndex)}
                      >
                        <span className="exercise-option-label">{item.label}</span>
                        {itemCoverage.label && (
                          <span className={`coverage-tag tone-${itemCoverage.tone}`}>
                            {itemCoverage.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            ) : (
              <p className="exercise-no-results">No encontramos ejercicios con ese nombre.</p>
            )}
          </div>

          {!coverage && (
            <p className="exercise-coverage-note">
              La cobertura del motor no está disponible en este momento; no se
              muestra el estado por ejercicio.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
