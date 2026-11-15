/* ---------------------------------------------------------------------------
   Etiquetas y formato de métricas.

   Extraído sin cambios de comportamiento desde `PosePlayer.tsx`: los mismos
   nombres, las mismas unidades y la misma lógica de formato. Se movió a un
   módulo propio para que la línea de tiempo y el riel de diagnóstico lean una
   sola fuente en lugar de duplicar el diccionario.
   --------------------------------------------------------------------------- */

export const METRIC_LABELS: Record<string, string> = {
  minimum_knee_angle: "Flexión de rodilla",
  maximum_knee_angle: "Extensión de rodilla",
  maximum_torso_lean: "Inclinación del torso",
  maximum_knee_asymmetry: "Asimetría de rodillas",
  overhead_release_observed: "Manos sobre hombros",
  minimum_elbow_angle: "Flexión de codos",
  maximum_elbow_angle: "Extensión de codos",
  hip_angle_range: "Variación de cadera",
  maximum_elbow_asymmetry: "Asimetría de codos",
  minimum_hip_angle: "Bisagra de cadera",
  maximum_hip_angle: "Extensión de cadera",
  maximum_wrist_height: "Altura de manos",
  maximum_hip_below_knee_normalized: "Cadera bajo rodilla",
  overhead_frame_fraction: "Estabilidad overhead",
  hold_duration_seconds: "Duración del sostén",
  mean_hip_angle: "Ángulo medio de cadera",
  minimum_dip_knee_angle: "Flexión máxima del dip",
  maximum_dip_torso_lean: "Inclinación durante el dip",
  minimum_post_drive_knee_angle: "Extensión tras el drive",
  final_elbow_angle: "Codo en el bloqueo",
  maximum_trunk_arm_angle: "Ángulo tronco-brazo",
  body_wrist_horizontal_range: "Recorrido horizontal cuerpo-muñecas",
  post_top_horizontal_return: "Retorno horizontal tras el punto alto",
  bent_knee_fraction: "Tiempo con rodillas flexionadas",
  shoulder_motion_onset_frame_offset: "Inicio del movimiento de hombros",
  hip_motion_onset_frame_offset: "Inicio del movimiento de cadera",
  target_contact_observed: "Contacto 2D con el blanco",
  target_contact_confidence: "Confianza del contacto 2D",
  minimum_top_wrist_height_normalized: "Separación vertical hombro-muñeca en el punto alto",
};

export const FEATURE_LABELS: Record<string, string> = {
  usable_frames: "Cuadros utilizables",
  knee_angle_range: "Movimiento de rodilla",
  hip_angle_range: "Movimiento de cadera",
  elbow_angle_range: "Movimiento de codo",
  wrist_height_range: "Recorrido de manos",
  overhead_ratio: "Tiempo sobre hombros",
  mean_pose_confidence: "Confianza de pose",
};

export const JOINT_LABELS: Record<string, string> = {
  left_shoulder: "hombro izquierdo",
  right_shoulder: "hombro derecho",
  left_elbow: "codo izquierdo",
  right_elbow: "codo derecho",
  left_wrist: "muñeca izquierda",
  right_wrist: "muñeca derecha",
  left_hip: "cadera izquierda",
  right_hip: "cadera derecha",
  left_knee: "rodilla izquierda",
  right_knee: "rodilla derecha",
  left_ankle: "tobillo izquierdo",
  right_ankle: "tobillo derecho",
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key.replaceAll("_", " ");
}

export function jointLabel(name: string): string {
  return JOINT_LABELS[name] ?? name.replaceAll("_", " ");
}

/**
 * Claves cuya unidad es grados, declaradas de forma explícita.
 *
 * Antes el formateador devolvía grados como valor por omisión, así que
 * cualquier métrica nueva del backend —una velocidad, una distancia, un
 * conteo— se habría mostrado con «°» inventado.
 */
function isAngularKey(key: string): boolean {
  return key.includes("angle") || key.includes("lean") || key.includes("asymmetry");
}

/**
 * Formato de métricas. Las unidades conocidas se mantienen exactamente como
 * estaban; lo que cambia es el caso desconocido: se muestra el número tal cual,
 * sin atribuirle una unidad que el backend no declaró.
 */
export function metricValue(key: string, value: number | boolean | null): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (key === "maximum_wrist_height") return `${value.toFixed(2)}× cuerpo`;
  if (key === "maximum_hip_below_knee_normalized") return `${(value * 100).toFixed(1)}% altura corporal`;
  if (key.endsWith("_fraction")) return `${Math.round(value * 100)}%`;
  if (key.endsWith("_confidence")) return `${Math.round(value * 100)}%`;
  if (key.endsWith("_frame_offset")) return `${Math.round(value)} cuadros`;
  if (key.includes("horizontal_range") || key.includes("horizontal_return")) return value.toFixed(2);
  if (key.endsWith("_normalized")) return `${(value * 100).toFixed(1)}%`;
  if (key.endsWith("_seconds")) return `${value.toFixed(2)} s`;
  if (isAngularKey(key)) return `${value}°`;
  return `${value}`;
}

/** Unidad declarada para una métrica, o `null` si el backend no la define. */
export function metricUnit(key: string): string | null {
  if (key === "maximum_wrist_height") return "× cuerpo";
  if (key === "maximum_hip_below_knee_normalized") return "% altura corporal";
  if (key.endsWith("_fraction") || key.endsWith("_confidence") || key.endsWith("_normalized")) return "%";
  if (key.endsWith("_frame_offset")) return "cuadros";
  if (key.endsWith("_seconds")) return "s";
  if (isAngularKey(key)) return "°";
  return null;
}
