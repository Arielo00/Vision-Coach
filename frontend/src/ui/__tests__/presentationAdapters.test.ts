/* ---------------------------------------------------------------------------
   Pruebas de comportamiento de la capa de presentación.

   Se ejecutan con el runner nativo de Node y el borrado de tipos incorporado,
   sin ninguna dependencia añadida:

     node --test src/ui/__tests__/

   Cubren precisamente los defectos que el typecheck no puede detectar: conteos
   que se solapan, referencias incompatibles, identificadores duplicados y
   unidades inventadas.
   --------------------------------------------------------------------------- */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildSeries,
  chooseReference,
  classificationState,
  comparisonPose,
  comparisonReference,
  confidenceReading,
  detectionScore,
  mapComparisonFrame,
  phaseAtFrame,
  phaseMarkers,
  repetitionCounts,
  repetitionState,
  resolveLibrarySelection,
  retrievalState,
  severityPresentation,
  /* Las extensiones explícitas son obligatorias: el runner de Node resuelve
     como ESM real, sin el resolutor del empaquetador. */
} from "../presentationAdapters.ts";
import { metricValue, metricUnit } from "../metricLabels.ts";
import { exercises } from "../../exerciseCatalog.ts";
import type { BiomechanicsRepetition, PoseFrame, ReferenceInfo } from "../../types";

/** Repetición mínima con solo los campos que consumen los adaptadores. */
function rep(overrides: Partial<BiomechanicsRepetition>): BiomechanicsRepetition {
  return {
    number: 1,
    start_frame: 0,
    end_frame: 30,
    bottom_frame: 15,
    phase_frames: {},
    confidence: 0.9,
    valid: true,
    correct: true,
    metrics: {},
    errors: [],
    warnings: [],
    ...overrides,
  };
}

/* ========================================================================== */
describe("abstención sin doble conteo", () => {
  test("los tres cubos son excluyentes y suman el total", () => {
    const reps = [
      rep({ number: 1, valid: true, correct: true }),
      rep({ number: 2, valid: true, correct: false }),
      rep({ number: 3, valid: false, correct: false }),
      rep({ number: 4, valid: false, correct: false }),
    ];
    const counts = repetitionCounts(reps);

    assert.equal(counts.total, 4);
    assert.equal(counts.correct, 1);
    assert.equal(counts.review, 1);
    assert.equal(counts.nonEvaluable, 2);
    assert.equal(
      counts.correct + counts.review + counts.nonEvaluable,
      counts.total,
      "los cubos deben sumar el total sin solaparse",
    );
  });

  test("una repetición no evaluable nunca cuenta como 'por revisar'", () => {
    const counts = repetitionCounts([rep({ valid: false, correct: false })]);
    assert.equal(counts.review, 0);
    assert.equal(counts.nonEvaluable, 1);
  });

  test("el agregado ingenuo del backend sí las confunde", () => {
    /* Documenta por qué no se usa `summary.incorrect_repetitions`:
       detectadas − correctas cuenta la abstención como incorrecta. */
    const reps = [
      rep({ number: 1, valid: true, correct: true }),
      rep({ number: 2, valid: false, correct: false }),
    ];
    const counts = repetitionCounts(reps);
    const backendIncorrect = reps.length - counts.correct;

    assert.equal(backendIncorrect, 1);
    assert.equal(counts.review, 0, "por repetición no hay ninguna con errores");
    assert.notEqual(backendIncorrect, counts.review);
  });

  test("los tres estados tienen etiqueta y patrón distintos", () => {
    const correcta = repetitionState(rep({ valid: true, correct: true }));
    const revisar = repetitionState(rep({ valid: true, correct: false }));
    const noEval = repetitionState(rep({ valid: false, correct: false }));

    assert.equal(correcta.kind, "correcta");
    assert.equal(revisar.kind, "revisar");
    assert.equal(noEval.kind, "no_evaluable");

    const tones = new Set([correcta.tone, revisar.tone, noEval.tone]);
    assert.equal(tones.size, 3, "cada estado necesita su propio tono");

    assert.notEqual(noEval.tone, "risk", "abstenerse no es un hallazgo de riesgo");
    assert.equal(noEval.pattern, "dashed", "la abstención se distingue sin depender del color");
    assert.ok(noEval.label.length > 0, "siempre hay etiqueta textual");
  });
});

/* ========================================================================== */
describe("referencias compatibles por cámara", () => {
  const lateral = { id: "ref-side", camera_view: "side" };
  const frontal = { id: "ref-front", camera_view: "front" };
  const sinVista = { id: "ref-any", camera_view: "unspecified" };

  test("prefiere la referencia con la misma vista", () => {
    const { reference, match } = chooseReference([frontal, lateral], "side");
    assert.equal(reference?.id, "ref-side");
    assert.equal(match, "vista_coincide");
  });

  test("rechaza una referencia de vista distinta", () => {
    const { reference, match } = chooseReference([frontal], "side");
    assert.equal(reference, null);
    assert.equal(match, "vista_incompatible");
  });

  test("acepta pero marca como no verificada si alguna vista falta", () => {
    const sinEtiquetar = chooseReference([sinVista], "side");
    assert.equal(sinEtiquetar.reference?.id, "ref-any");
    assert.equal(sinEtiquetar.match, "vista_no_verificada");

    const trabajoSinVista = chooseReference([frontal], "unspecified");
    assert.equal(trabajoSinVista.reference?.id, "ref-front");
    assert.equal(trabajoSinVista.match, "vista_no_verificada");
  });

  test("sin referencias devuelve el estado correspondiente", () => {
    const { reference, match } = chooseReference([], "side");
    assert.equal(reference, null);
    assert.equal(match, "sin_referencia");
  });
});

describe("comparación coherente con la evaluación actual", () => {
  const evaluated = (overrides: Partial<BiomechanicsRepetition> = {}) => rep({ phase_frames: { bottom: 15 }, ...overrides });
  const pose: PoseFrame = {
    frame_index: 15,
    timestamp_seconds: 0.5,
    people: [{
      detection_confidence: 0.9,
      xy: Array.from({ length: 17 }, (_, index) => [10 + 10 * (index % 2), 5 * index]),
      keypoint_confidence: Array(17).fill(0.9),
      keypoint_names: [],
      visible: Array(17).fill(true),
      covariance: null,
      uncertainty_kind: "none",
    }],
  };
  const reference: ReferenceInfo = {
    id: "reference", exercise: "back_squat", label: "Referencia", camera_view: "side",
    metadata: {}, repetitions: [evaluated()], source: "calibration_library",
  };
  const base = {
    repetitions: [evaluated()], sessionFrames: [pose], reference: null,
    referenceFrames: [], match: "sin_referencia" as const,
  };

  test("tres repeticiones sin hallazgos ofrecen referencia de sesión aunque la biblioteca esté vacía", () => {
    const repetitions = [1, 2, 3].map((number) => {
      const start = (number - 1) * 30;
      return evaluated({ number, start_frame: start, end_frame: start + 30, phase_frames: { bottom: start + 15 }, confidence: number === 2 ? 0.95 : 0.9 });
    });
    const sessionFrames = [15, 45, 75].map((frame_index) => ({ ...pose, frame_index }));
    const result = comparisonReference({ ...base, repetitions, sessionFrames });
    assert.equal(repetitionCounts(repetitions).correct, 3);
    assert.equal(result.source, "session");
    assert.equal(result.repetition?.number, 2);
    assert.equal(result.notice, null);
  });

  test("una regla opcional no evaluable no invalida las reglas observables aprobadas", () => {
    const result = comparisonReference({ ...base, repetitions: [evaluated({
      rule_evaluations: {
        depth: { status: "pass", observed_fraction: 1, reason: null },
        symmetry: { status: "not_evaluable", observed_fraction: null, reason: "vista lateral" },
      },
    })] });
    assert.equal(result.source, "session");
  });

  test("confianza alta y correct heredado no convierten una abstención en referencia", () => {
    const result = comparisonReference({ ...base, repetitions: [evaluated({ valid: false, correct: true, confidence: 0.99 })] });
    assert.equal(result.source, null);
    assert.equal(result.reason, "not_evaluable");
    assert.match(result.notice ?? "", /evidencia .* insuficiente/);
  });

  test("la referencia respeta el resultado final con estados por regla incompletos", () => {
    const result = comparisonReference({ ...base, repetitions: [evaluated({
      rule_evaluations: { optional: { status: "not_evaluable", observed_fraction: null, reason: "vista lateral" } },
    })] });
    assert.equal(result.source, "session");
  });

  test("carga y recálculo de vista no se presentan como técnica incorrecta", () => {
    for (const result of [
      comparisonReference({ ...base, repetitions: null }),
      comparisonReference({ ...base, updating: true }),
    ]) {
      assert.equal(result.reason, "pending");
      assert.equal(result.source, null);
      assert.doesNotMatch(result.notice ?? "", /ninguna|incorrect|hallazgos/i);
    }
  });

  test("una referencia externa sin pose usa la referencia de sesión disponible", () => {
    const result = comparisonReference({ ...base, reference, match: "vista_coincide" });
    assert.equal(result.source, "session");
  });

  test("prioriza la referencia de sesión sobre una vista externa sin verificar", () => {
    const result = comparisonReference({ ...base, reference, referenceFrames: [pose], match: "vista_no_verificada" });
    assert.equal(result.source, "session");
  });

  test("usa la externa compatible si existen fases y pose alineadas en ambos videos", () => {
    const result = comparisonReference({ ...base, reference, referenceFrames: [pose], match: "vista_coincide" });
    assert.equal(result.source, "external");
    if (result.reason !== "available") assert.fail("La referencia debe estar disponible");
    assert.equal(comparisonPose(evaluated(), result, 15, [pose]), pose.people[0]);
    assert.equal(comparisonPose(evaluated(), result, 30, [pose]), undefined);
  });

  test("la pose utilizable debe pertenecer al atleta primario en ambos cuadros", () => {
    const primary = { ...pose.people[0], keypoint_confidence: pose.people[0].keypoint_confidence.map((value, index) => index === 11 ? 0.05 : value) };
    const obstructed = { ...pose, people: [primary, pose.people[0]] };
    for (const [sessionFrames, referenceFrames] of [
      [[obstructed], [pose]],
      [[pose], [obstructed]],
    ]) {
      const result = comparisonReference({ ...base, repetitions: [evaluated({ correct: false })], sessionFrames, referenceFrames, reference, match: "vista_coincide" });
      assert.equal(result.reason, "pose");
    }
  });

  test("acepta cuadros cercanos de una referencia muestreada y evita saltos en los huecos", () => {
    const referenceFrames = [0, 3, 6, 9, 24, 27, 30].map((frame_index) => ({ ...pose, frame_index }));
    const sessionFrames = [{ ...pose, frame_index: 8 }];
    const current = evaluated({ correct: false });
    const result = comparisonReference({ ...base, repetitions: [current], reference, sessionFrames, referenceFrames, match: "vista_coincide" });
    assert.equal(result.source, "external");
    if (result.reason !== "available") assert.fail("La referencia debe estar disponible");
    assert.equal(comparisonPose(current, result, 8, referenceFrames), pose.people[0]);
    assert.equal(comparisonPose(current, result, 15, referenceFrames), undefined);
  });

  test("no usa una referencia antigua incompatible con la vista actual", () => {
    const result = comparisonReference({ ...base, reference, referenceFrames: [pose], match: "vista_incompatible", repetitions: [evaluated({ correct: false })] });
    assert.equal(result.source, null);
    assert.equal(result.reason, "view");
    assert.match(result.notice ?? "", /otra vista/);
  });

  test("distingue ausencia de fases y de pose sin contradecir el resultado técnico", () => {
    const phases = comparisonReference({ ...base, repetitions: [evaluated({ phase_frames: {} })] });
    const missingPose = comparisonReference({ ...base, sessionFrames: [] });
    assert.equal(phases.reason, "phases");
    assert.equal(missingPose.reason, "pose");
    assert.match(phases.notice ?? "", /fases compartidas/);
    assert.match(missingPose.notice ?? "", /hombros y caderas visibles/);
    for (const result of [phases, missingPose]) assert.doesNotMatch(result.notice ?? "", /ninguna repetición|hallazgos/);
  });

  test("distingue una vista incompatible y ausencia de ciclos detectados", () => {
    assert.equal(comparisonReference({ ...base, repetitions: [], diagnosticStatus: "unsupported_view" }).reason, "view");
    assert.equal(comparisonReference({ ...base, repetitions: [], diagnosticStatus: "completed" }).reason, "no_repetitions");
  });

  test("distingue un error de biblioteca de una biblioteca vacía", () => {
    const result = comparisonReference({ ...base, match: "error_referencia", repetitions: [evaluated({ correct: false })] });
    assert.equal(result.reason, "reference_error");
    assert.match(result.notice ?? "", /No se pudo cargar/);
  });

  test("al cambiar de no evaluable a evaluable se elimina el aviso en la misma derivación", () => {
    const before = comparisonReference({ ...base, repetitions: [evaluated({ valid: false, correct: false })] });
    const after = comparisonReference(base);
    assert.equal(before.reason, "not_evaluable");
    assert.equal(after.reason, "available");
    assert.equal(after.notice, null);
  });

  test("alinea por una fase compartida real y rechaza fases ausentes o invertidas", () => {
    const current = evaluated();
    const target = evaluated({ start_frame: 100, end_frame: 160, phase_frames: { bottom: 120 } });
    assert.equal(mapComparisonFrame(current, target, 15), 120);
    assert.equal(mapComparisonFrame(current, target, 0), 100);
    assert.equal(mapComparisonFrame(current, target, 30), 160);
    assert.equal(mapComparisonFrame(current, evaluated({ phase_frames: { release: 15 } }), 15), null);
    assert.equal(mapComparisonFrame(current, evaluated({ phase_frames: { bottom: 31 } }), 15), null);
    assert.equal(mapComparisonFrame(current, target, 31), null);
    assert.equal(mapComparisonFrame(
      evaluated({ phase_frames: { bottom: 10, release: 20 } }),
      evaluated({ phase_frames: { release: 10, bottom: 20 } }),
      15,
    ), null);
  });

  test("dos nombres de fase pueden corresponder al mismo cuadro", () => {
    const current = evaluated({ phase_frames: { top: 15, push_away: 15 } });
    const target = evaluated({ start_frame: 100, end_frame: 160, phase_frames: { top: 120, push_away: 120 } });
    assert.equal(mapComparisonFrame(current, target, 15), 120);
    assert.equal(mapComparisonFrame(current, target, 24), 144);
  });
});

/* ========================================================================== */
describe("identificadores del selector de ejercicio", () => {
  const optionId = (category: string, id: string) => `picker-option-${category}-${id}`;

  test("los ejercicios compartidos entre disciplinas generan IDs únicos", () => {
    const pairs = exercises.flatMap((item) =>
      (item.categories ?? [item.category]).map((category) => optionId(category, item.id)),
    );
    assert.equal(new Set(pairs).size, pairs.length, "ningún ID del DOM puede repetirse");
  });

  test("el catálogo realmente contiene ejercicios en varias categorías", () => {
    /* Si esto dejara de cumplirse, la prueba anterior pasaría por vacuidad. */
    const shared = exercises.filter((item) => (item.categories ?? [item.category]).length > 1);
    assert.ok(shared.length > 0, "se esperan ejercicios compartidos, p. ej. muscle-up y rowing");
    for (const item of shared) {
      const ids = (item.categories ?? []).map((category) => optionId(category, item.id));
      assert.equal(new Set(ids).size, ids.length);
    }
  });

  test("usar solo el ejercicio como identidad sí colapsa", () => {
    /* Documenta el defecto corregido: sin la categoría, los compartidos chocan. */
    const naive = exercises.flatMap((item) =>
      (item.categories ?? [item.category]).map(() => `picker-option-${item.id}`),
    );
    assert.ok(new Set(naive).size < naive.length, "la identidad sin categoría se duplica");
  });
});

/* ========================================================================== */
describe("clasificación automática incierta", () => {
  test("solo se ve resuelta con confianza alta", () => {
    const alta = classificationState("wall_ball_shot", 0.92);
    assert.equal(alta.tone, "active");
    assert.equal(alta.resolved, true);
    assert.equal(alta.caveat, null);
  });

  test("confianza media advierte y no se ve activa", () => {
    const media = classificationState("wall_ball_shot", 0.55);
    assert.notEqual(media.tone, "active");
    assert.equal(media.resolved, false);
    assert.ok(media.caveat);
  });

  test("confianza cero no se presenta como detección válida", () => {
    const cero = classificationState("wall_ball_shot", 0);
    assert.notEqual(cero.tone, "active");
    assert.equal(cero.resolved, false);
    assert.match(cero.label, /EVIDENCIA INSUFICIENTE/);
  });

  test("ejercicio desconocido nunca se ve activo", () => {
    const desconocido = classificationState("unknown", 0.99);
    assert.equal(desconocido.tone, "unavailable");
    assert.equal(desconocido.resolved, false);
    assert.match(desconocido.label, /SIN CLASIFICAR/);
  });
});

/* ========================================================================== */
describe("sincronización filtro–detalle de biblioteca", () => {
  const crossfit = { id: "wall_ball_shot" };
  const hyrox = { id: "sled_push" };

  test("el detalle desaparece si el filtro excluye la selección", () => {
    const { selected, filteredOut } = resolveLibrarySelection([hyrox], "wall_ball_shot");
    assert.equal(selected, null);
    assert.equal(filteredOut, true);
  });

  test("el detalle se conserva si la selección sigue en el filtro", () => {
    const { selected, filteredOut } = resolveLibrarySelection([crossfit, hyrox], "wall_ball_shot");
    assert.equal(selected?.id, "wall_ball_shot");
    assert.equal(filteredOut, false);
  });

  test("sin resultados no se reporta como excluido", () => {
    const { selected, filteredOut } = resolveLibrarySelection([], "wall_ball_shot");
    assert.equal(selected, null);
    assert.equal(filteredOut, false, "no hay índice contra el que contradecirse");
  });
});

/* ========================================================================== */
describe("score de detección", () => {
  const person = (score: number) => ({
    detection_confidence: score,
    keypoint_names: [],
    xy: [],
    keypoint_confidence: [],
    visible: [],
    covariance: null,
    uncertainty_kind: "rfdetr_covariance",
  });

  test("un valor mayor que 1 se muestra como score", () => {
    const reading = detectionScore(person(2.81));
    assert.equal(reading.kind, "score");
    assert.equal(reading.display, "2.81");
  });

  test("un valor dentro de [0,1] TAMBIÉN se muestra como score", () => {
    /* El significado del campo no cambia al cruzar 1.0: convertirlo a
       porcentaje inventaría una calibración probabilística inexistente. */
    const reading = detectionScore(person(0.87));
    assert.equal(reading.kind, "score");
    assert.equal(reading.display, "0.87");
    assert.doesNotMatch(reading.display, /%/);
  });

  test("sin persona no se inventa un valor", () => {
    assert.equal(detectionScore(undefined).kind, "sin_dato");
    assert.equal(detectionScore(undefined).display, "—");
  });
});

/* ========================================================================== */
describe("unidades de métricas", () => {
  test("las unidades conocidas se conservan", () => {
    assert.equal(metricValue("minimum_knee_angle", 92), "92°");
    assert.equal(metricValue("hold_duration_seconds", 1.234), "1.23 s");
    assert.equal(metricValue("overhead_frame_fraction", 0.5), "50%");
    assert.equal(metricValue("maximum_wrist_height", 1.2), "1.20× cuerpo");
  });

  test("una métrica desconocida no recibe grados inventados", () => {
    assert.equal(metricValue("velocidad_media_futura", 3.4), "3.4");
    assert.equal(metricUnit("velocidad_media_futura"), null);
  });

  test("los booleanos y los nulos se muestran sin unidad", () => {
    assert.equal(metricValue("overhead_release_observed", true), "Sí");
    assert.equal(metricValue("cualquier_cosa", null), "—");
  });
});

/* ========================================================================== */
describe("fases leídas del motor, sin modelo fijo", () => {
  test("respeta las claves específicas de cada ejercicio", () => {
    const pushPress = rep({
      start_frame: 0,
      end_frame: 40,
      phase_frames: { dip: 0, bottom: 10, drive: 20, lockout: 40 },
    });
    const labels = phaseMarkers(pushPress).map((phase) => phase.label);
    assert.deepEqual(labels, ["Dip", "Punto bajo", "Drive", "Bloqueo"]);
  });

  test("ordena por cuadro, no por orden de las claves", () => {
    const kb = rep({ start_frame: 0, end_frame: 20, phase_frames: { extension: 18, backswing: 4 } });
    assert.deepEqual(phaseMarkers(kb).map((p) => p.key), ["backswing", "extension"]);
  });

  test("una clave nueva se humaniza y se marca como derivada", () => {
    const futuro = rep({ phase_frames: { catch_position: 12 } });
    const [marker] = phaseMarkers(futuro);
    assert.equal(marker.derived, true);
    assert.equal(marker.label, "Catch position");
  });

  test("sin fases reportadas no se fabrica ninguna", () => {
    assert.deepEqual(phaseMarkers(rep({ phase_frames: {} })), []);
    assert.equal(phaseAtFrame(rep({ phase_frames: {} }), 5), null);
  });

  test("la fase de un cuadro sale de la última ancla anterior", () => {
    const squat = rep({
      start_frame: 0,
      end_frame: 30,
      phase_frames: { descent: 0, bottom: 15, ascent: 25 },
    });
    assert.equal(phaseAtFrame(squat, 20)?.key, "bottom");
    assert.equal(phaseAtFrame(squat, 28)?.key, "ascent");
  });
});

/* ========================================================================== */
describe("series longitudinales con huecos", () => {
  const session = (id: string, value: number | null) => ({
    job_id: id,
    date: "2026-07-11T10:00:00Z",
    filename: "x.mp4",
    exercise: "wall_ball_shot",
    camera_view: "side" as const,
    repetitions: 3,
    evaluated_repetitions: 3,
    non_evaluable_repetitions: 0,
    correct_repetitions: 3,
    incorrect_repetitions: 0,
    correct_rate: value,
    mean_confidence: 0.9,
    rom: { value: null, label: null, unit: null },
    errors: {},
  });

  test("una medición ausente queda como hueco, no como cero", () => {
    const points = buildSeries(
      [session("a", 100), session("b", null), session("c", 50)],
      (s) => s.correct_rate,
      (v) => `${v}%`,
      () => "11-jul",
    );
    assert.equal(points[1].value, null);
    assert.notEqual(points[1].value, 0);
    assert.equal(points[1].readout, "sin medición");
  });

  test("las mediciones presentes conservan su valor y formato", () => {
    const points = buildSeries([session("a", 100)], (s) => s.correct_rate, (v) => `${v}%`, () => "11-jul");
    assert.equal(points[0].value, 100);
    assert.equal(points[0].readout, "100%");
  });
});

/* ========================================================================== */
describe("confianza y severidad", () => {
  test("los umbrales heredados no cambian", () => {
    assert.equal(confidenceReading(0.75).level, "alta");
    assert.equal(confidenceReading(0.74).level, "media");
    assert.equal(confidenceReading(0.4).level, "media");
    assert.equal(confidenceReading(0.39).level, "baja");
    assert.equal(confidenceReading(null).level, "sin_dato");
  });

  test("la confianza baja sigue siendo legible, no se desvanece", () => {
    const baja = confidenceReading(0.1);
    assert.equal(baja.display, "10%");
    assert.ok(baja.label.includes("BAJA"));
    assert.equal(baja.pattern, "hatched", "se distingue por trama, no por opacidad");
  });

  test("solo el riesgo recibe el tono rojo", () => {
    assert.equal(severityPresentation("riesgo").tone, "risk");
    assert.notEqual(severityPresentation("media").tone, "risk");
    assert.notEqual(severityPresentation("leve").tone, "risk");
  });

  test("la severidad ordena de mayor a menor gravedad", () => {
    assert.ok(severityPresentation("riesgo").weight > severityPresentation("media").weight);
    assert.ok(severityPresentation("media").weight > severityPresentation("leve").weight);
  });
});

/* ========================================================================== */
describe("estado de recuperación documental", () => {
  test("el respaldo léxico se marca como respaldo", () => {
    const state = retrievalState({
      available: true,
      retrieval_mode: "lexical",
      fallback: false,
      embedding_provider: null,
      embedding_model: null,
      message: "sin índice vectorial",
    });
    assert.equal(state.isFallback, true);
    assert.equal(state.tone, "uncertain");
  });

  test("sin estado reportado no se afirma disponibilidad", () => {
    const state = retrievalState(undefined);
    assert.equal(state.kind, "no_disponible");
    assert.equal(state.tone, "unavailable");
    assert.equal(state.message, null);
  });
});
