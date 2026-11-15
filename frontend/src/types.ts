export type CameraView = "front" | "side" | "three_quarter" | "unspecified";

/** La vista estimada es una heurística de proyección 2D, no una certeza calibrada. */
export interface CameraViewResolution {
  requested_view: CameraView;
  effective_view: CameraView;
  source: "manual" | "estimated" | "unresolved";
  method: "pose_projection_v1";
  reason: string;
  evidence: {
    sampled_frames: number;
    usable_frames: number;
    agreement: number | null;
    coverage: number | null;
    multiple_people_frames: number;
    discontinuous_transitions?: number;
    median_shoulder_ratio?: number | null;
    median_hip_ratio?: number | null;
    votes: Record<Exclude<CameraView, "unspecified">, number>;
  };
  limitations: string[];
}

export type ExerciseId = string;

export interface HealthStatus {
  status: string;
  storage: string;
  scope: string;
  gpu_available: boolean;
}

export interface PipelineStatusBlock {
  id: string;
  label: string;
  status: string;
  evidence: string[];
  limitation: string;
}

export interface PipelineStatus {
  schema_version: number;
  scope: string;
  blocks: PipelineStatusBlock[];
}

export interface CatalogCoverageItem {
  family: string;
  maturity: string;
  preferred_views: CameraView[];
  required_equipment: string[];
  limiting_factor: string;
  approved_coaching_source?: string;
  approved_family_source?: string;
  approved_reference_video?: string;
  approved_validity_source?: string;
}

export interface CatalogCoveragePayload {
  schema_version: number;
  maturity_levels: Record<string, string>;
  exercises: Record<ExerciseId, CatalogCoverageItem>;
}

export interface VideoJob {
  id: string;
  original_filename: string;
  content_type: string | null;
  size_bytes: number;
  camera_view: CameraView;
  requested_exercise: ExerciseId;
  status: "queued" | "processing" | "completed" | "failed";
  stage: string;
  progress: number;
  duration_seconds: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  frame_count: number | null;
  processed_frames: number;
  max_people_detected: number;
  pose_frames_with_person: number;
  mean_keypoint_confidence: number | null;
  pose_model: string | null;
  pose_artifact: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

export interface PosePerson {
  detection_confidence: number;
  keypoint_names: string[];
  xy: Array<[number | null, number | null]>;
  keypoint_confidence: Array<number | null>;
  visible: boolean[];
  covariance: Array<[[number, number], [number, number]]> | null;
  uncertainty_kind: string;
}

export interface EquipmentDetection {
  label: string;
  source_label: string | null;
  confidence: number;
  xyxy: [number, number, number, number];
  track_id: string;
  center: [number, number];
  center_normalized: [number, number];
}

export interface PoseFrame {
  frame_index: number;
  timestamp_seconds: number;
  people: PosePerson[];
  equipment?: EquipmentDetection[];
  equipment_model?: string | null;
  equipment_capability?: string;
}

export interface PoseFramesPage {
  offset: number;
  limit: number;
  total: number;
  truncated: boolean;
  items: PoseFrame[];
}

export interface BiomechanicsError {
  type: string;
  description: string;
  severity: "leve" | "media" | "riesgo";
  correction: string;
  frames: number[];
  joints: string[];
}

export interface BiomechanicsRepetition {
  number: number;
  start_frame: number;
  end_frame: number;
  bottom_frame: number;
  phase_frames: Record<string, number>;
  confidence: number;
  valid: boolean;
  correct: boolean;
  metrics: Record<string, number | boolean | null>;
  errors: BiomechanicsError[];
  warnings: string[];
  assessment_scope?: "configured_pose_rules";
  rule_evaluations?: Record<string, {
    description?: string;
    status: "pass" | "fail" | "not_evaluable";
    observed_fraction: number | null;
    reason: string | null;
  }>;
}

export interface KnowledgeSourceReference {
  filename: string;
  page: number | null;
  source_type?: "video" | "pdf";
  title?: string;
  publisher?: string;
  source_url?: string | null;
  video_url?: string | null;
  start_seconds?: number;
  end_seconds?: number;
  content_kind?: string;
}

export interface BiomechanicsResult {
  camera_view_resolution?: CameraViewResolution;
  exercise: string;
  exercise_source: "manual" | "automatic";
  exercise_confidence: number;
  classification_reason: string;
  classification_candidates?: Array<{ exercise: string; confidence: number }>;
  classification_features?: Record<string, number>;
  /** Sección `rules` del JSON del ejercicio aplicado: umbrales y tolerancias. */
  rule_config?: Record<string, Record<string, unknown>> | null;
  status: string;
  warnings: string[];
  summary: {
    repetitions_detected: number;
    evaluated_repetitions: number;
    correct_repetitions: number;
    incorrect_repetitions: number;
    non_evaluable_repetitions: number;
  };
  repetitions: BiomechanicsRepetition[];
  equipment?: {
    required: string[];
    detected: string[];
    status: string;
    message: string;
    trajectory?: {
      track_id: string;
      label: string;
      observations: number;
      observations_total?: number;
      mean_confidence: number;
      path_length_frame_diagonal: number;
      vertical_range_frame_fraction: number;
      peak_frame: number;
    } | null;
    contact_events?: Array<{ peak_frame: number; confidence: number; kind: string }>;
  };
  knowledge_context?: Array<KnowledgeSourceReference & {
    id: string;
    text: string;
    score: number;
    vector_score?: number;
    lexical_score?: number;
    retrieval_mode?: string;
    embedding_provider?: string | null;
    embedding_model?: string | null;
    retrieval_fallback?: boolean;
    embedding_indexed?: boolean;
  }>;
  knowledge_status?: {
    available: boolean;
    retrieval_mode: string;
    embedding_provider?: string | null;
    embedding_model?: string | null;
    fallback: boolean;
    message?: string | null;
  };
}

export interface LLMModelsResponse {
  available: boolean;
  provider: string;
  default_model: string;
  items: Array<{ id: string; name: string; provider: "ollama" | "google"; kind: "chat" | "embedding"; remote: boolean; available: boolean; details: Record<string, string> }>;
  google_configured?: boolean;
  message?: string;
}

export interface CoachingResult {
  camera_view_resolution?: CameraViewResolution;
  exercise: string;
  provider: string;
  model: string | null;
  status: "generated" | "fallback_no_llm" | "fallback_no_rag" | "fallback_ungrounded" | "fallback_no_evaluable_repetitions";
  summary: string;
  repetitions: Array<{
    number: number;
    evaluable: boolean;
    correct: boolean;
    errors: Array<{ type: string; description: string; severity: string }>;
    corrections: string[];
    progressions_suggested: string[];
  }>;
  general_recommendations: string[];
  sources: KnowledgeSourceReference[];
  safety_notice: string;
  rag_trace: {
    context_sha256: string;
    chunks_sent: Array<KnowledgeSourceReference & { source_id: string; chunk_id: string; score: number | null }>;
    citations_returned: string[];
    grounded: boolean;
    citation_validation?: "identifiers_only";
    semantic_grounding_verified?: boolean;
    provider: string;
    remote: boolean;
  };
}

export interface ReferenceInfo {
  id: string;
  exercise: string;
  label: string;
  camera_view: CameraView;
  metadata: { width?: number; height?: number; fps?: number };
  repetitions: BiomechanicsRepetition[];
  source: string;
}

export interface ReferencePayload {
  reference: ReferenceInfo;
  items: PoseFrame[];
}

export interface ProgressSession {
  camera_view_resolution?: CameraViewResolution;
  job_id: string;
  date: string;
  filename: string;
  exercise: string;
  camera_view: CameraView;
  repetitions: number;
  evaluated_repetitions: number;
  non_evaluable_repetitions: number;
  correct_repetitions: number;
  incorrect_repetitions: number;
  correct_rate: number | null;
  mean_confidence: number | null;
  rom: { value: number | null; label: string | null; unit: string | null };
  errors: Record<string, number>;
}

export interface ProgressPayload {
  exercise: string | null;
  exercise_options: Array<{ exercise: string; sessions: number }>;
  summary: {
    sessions: number;
    total_repetitions: number;
    total_evaluated_repetitions: number;
    total_non_evaluable_repetitions: number;
    total_correct_repetitions: number;
    total_incorrect_repetitions: number;
    overall_correct_rate: number | null;
    mean_rom: number | null;
    correct_rate_slope_per_session: number | null;
    rom_slope_per_session: number | null;
    rom_comparable: boolean;
    rate_comparable?: boolean;
  };
  sessions: ProgressSession[];
}

export interface UploadInput {
  file: File;
  cameraView: CameraView;
  exercise: ExerciseId;
}

export interface ExerciseLibrarySource {
  filename: string;
  pages: number[];
  section: string | null;
  evidence_kind: string;
  criteria: string[];
}

export interface ExerciseLibraryVideo {
  id: string;
  label: string;
  publisher: string;
  relationship: "exact" | "advanced_variant" | "equipment_variant" | "partial_variant" | "regression" | "supplemental";
  relationship_label: string;
  available: boolean;
  filename: string;
  url: string | null;
}

export interface ExerciseLibrarySecondarySource {
  source: string;
  source_exercise_id: string;
  source_url: string;
  name: string;
  discipline: "crossfit" | "calisthenics" | "hyrox";
  standard_variant: string;
  relationship: ExerciseLibraryVideo["relationship"];
  relationship_label: string;
  review_status: "secondary_reviewed" | "variant_candidate";
  review_note: string | null;
  merge_into_standards: false;
  equipment: string | null;
  target: string | null;
  instructions_es: string | null;
  instruction_steps_es: string[];
  media: {
    staged_available: boolean;
    display_enabled: boolean;
    url: string | null;
    attribution: string | null;
    license_status: "permission_pending" | "licensed";
  };
}

export interface ExerciseLibraryItem {
  id: ExerciseId;
  label: string;
  category: "crossfit" | "calisthenics" | "hyrox";
  categories: Array<"crossfit" | "calisthenics" | "hyrox">;
  family: string;
  maturity: string;
  maturity_label: string;
  preferred_views: CameraView[];
  required_equipment: string[];
  limiting_factor: string;
  criteria: string[];
  rules: Array<{ id: string; description: string; correction: string | null; severity: string | null }>;
  sources: ExerciseLibrarySource[];
  videos: ExerciseLibraryVideo[];
  secondary_sources: ExerciseLibrarySecondarySource[];
  benchmark: {
    correct_clips: number;
    intentional_error_clips: number;
    intentional_errors_pending: string[];
    status: string;
  };
  has_rule_engine: boolean;
}

export interface ExerciseLibraryPayload {
  items: ExerciseLibraryItem[];
  summary: {
    exercises: number;
    with_rule_engine: number;
    with_sources: number;
    with_video: number;
    with_secondary_sources: number;
    secondary_media_display_enabled: boolean;
  };
}

export interface CoachingLibraryVideo {
  id: string;
  title: string;
  filename: string;
  source_url: string | null;
  url: string;
  transcripts: string[];
  indexed_passages: number;
  coaching_status: "indexed_reviewed" | "pending_review" | "pending_transcript";
}

export interface CoachingCollection {
  id: string;
  title: string;
  publisher: string;
  playlist_url: string;
  video_count: number;
  indexed_video_count: number;
  videos: CoachingLibraryVideo[];
}

export interface CoachingLibraryPayload {
  items: CoachingCollection[];
  issues: string[];
}
