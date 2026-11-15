/* ---------------------------------------------------------------------------
   Utilidades de texto compartidas.

   `normalize` vivia duplicada en el selector de ejercicio y en la biblioteca.
   Tener una sola definicion evita que las dos busquedas se comporten distinto.
   --------------------------------------------------------------------------- */

/** Rango de marcas diacriticas combinantes en Unicode. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Normaliza para busqueda: descompone acentos, los elimina y pasa a minusculas.
 * Permite que una consulta sin acentos encuentre entradas acentuadas.
 */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}
