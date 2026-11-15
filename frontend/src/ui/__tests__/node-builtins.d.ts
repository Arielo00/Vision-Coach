/* ---------------------------------------------------------------------------
   Declaraciones mínimas de los módulos nativos que usan las pruebas.

   No hay `@types/node` instalado y este equipo no tiene gestor de paquetes para
   añadirlo, así que se declara a mano EXACTAMENTE el subconjunto que consumen
   las pruebas. No pretende ser una tipificación completa de Node: si una prueba
   necesita otra función del runner, hay que declararla aquí de forma explícita.
   --------------------------------------------------------------------------- */

declare module "node:test" {
  /** Registra una prueba. El cuerpo puede ser síncrono o devolver una promesa. */
  export function test(name: string, fn: () => void | Promise<void>): void;
  /** Agrupa pruebas relacionadas. */
  export function describe(name: string, fn: () => void): void;
}

declare module "node:assert/strict" {
  interface StrictAssert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    match(value: string, pattern: RegExp, message?: string): void;
    doesNotMatch(value: string, pattern: RegExp, message?: string): void;
    throws(fn: () => unknown, message?: string): void;
    fail(message?: string): never;
  }

  const assert: StrictAssert;
  export default assert;
}
