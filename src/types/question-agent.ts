import type {
  AiGenAlgorithm,
  AiGenContentMode,
  AiGenImageMode,
  AiGenImageTarget,
  AiGenPayload,
  AiGenQuestionType,
} from "./ai-generate";

export const QUESTION_AGENT_ROLES = [
  "question-orchestrator",
  "question-generator",
  "question-evaluator",
  "student-simulator",
] as const;

export const QUESTION_AGENT_CAPABILITIES = [
  "dialogue_field_extraction",
  "portrait_ready_gating",
  "text_generation",
  "visual_generation",
  "text_evaluation",
  "visual_evaluation",
  "evoq_generation",
  "evoq_student_simulation",
] as const;

export const QUESTION_SPEC_STATUSES = ["draft", "ready", "blocked"] as const;
export const QUESTION_CONTROLLED_FIELD_KEYS = [
  "subject",
  "knowledge_point",
  "knowledge_points",
  "difficulty",
  "question_type",
  "content_mode",
  "algorithm",
  "strategy",
  "image_requirement",
  "diagram",
] as const;

export type QuestionAgentRole = (typeof QUESTION_AGENT_ROLES)[number];
export type QuestionAgentCapabilityName = (typeof QUESTION_AGENT_CAPABILITIES)[number];
export type QuestionSpecStatus = (typeof QUESTION_SPEC_STATUSES)[number];
export type QuestionControlledFieldKey = (typeof QUESTION_CONTROLLED_FIELD_KEYS)[number];

export interface TeacherPreferenceProfile {
  teacher_id: string;
  subject_focus: string[];
  grade_band: string;
  pedagogical_style: string;
  difficulty_policy: string;
  visual_policy: string;
  language_policy: string;
  algorithm_preferences: AiGenAlgorithm[];
  constraints: string[];
  updated_at: string;
}

export interface StudentMasterySignal {
  knowledge_point: string;
  mastery: number;
  confidence: number;
  evidence: string;
}

export interface StudentProfile {
  student_id: string;
  ability_theta: number;
  mastery: StudentMasterySignal[];
  common_errors: string[];
  misconceptions: string[];
  learning_preferences: string[];
  irt: {
    theta: number;
    ability_theta: number;
    difficulty_b?: number;
  };
  updated_at: string;
}

export interface EvoqGenerationConfig {
  population_size: number;
  generations: number;
  elite_ratio: number;
  lambda_ratio: number;
  selection_strategy: "tournament" | "roulette" | "random";
  tournament_k: number;
  init_strategy: "auto" | "dataset" | "mixed";
  fitness_diff_metric: "irt_strict" | "irt_soft" | "rankllm_strict" | "rankllm_soft";
  early_stop_score: number;
  early_stop_requires_no_issues: boolean;
  min_generations_before_early_stop: number;
  max_attempt_multiplier: number;
  seed_strategies: string[];
}

export interface QuestionImageRequirement {
  mode: AiGenImageMode;
  targets: AiGenImageTarget[];
  renderer: "none" | "safe_svg" | "visual_solver";
  must_be_answer_relevant: boolean;
}

export interface QuestionGenerationContract {
  primary_agent: QuestionAgentRole;
  generator_agent: QuestionAgentRole;
  evaluator_agent: QuestionAgentRole;
  required_capabilities: QuestionAgentCapabilityName[];
  algorithm: AiGenAlgorithm;
  algorithm_route: QuestionAgentAlgorithmRoute;
  oah_runtime_candidates: string[];
}

export interface QuestionGenerationSpec {
  spec_id: string;
  request_uuid: string;
  version: "edu-question-spec.v1";
  status: QuestionSpecStatus;
  subject: string;
  knowledge_point: string;
  difficulty_level: number;
  question_type: AiGenQuestionType;
  content_mode: AiGenContentMode;
  algorithm: AiGenAlgorithm;
  image_requirement: QuestionImageRequirement;
  evoq_config: EvoqGenerationConfig;
  teacher_profile: TeacherPreferenceProfile;
  student_profile: StudentProfile;
  human_controlled_rules: string[];
  validation_errors: string[];
  generation_contract: QuestionGenerationContract;
  created_at: string;
}

export interface QuestionAgentStep {
  role: QuestionAgentRole;
  action: string;
  capabilities: QuestionAgentCapabilityName[];
  blocks_generation: boolean;
}

export interface QuestionAgentPlan {
  plan_id: string;
  request_uuid: string;
  status: "ready" | "blocked";
  steps: QuestionAgentStep[];
}

export interface QuestionAgentDesign {
  architecture: {
    runtime_id: string;
    main_agent: QuestionAgentRole;
    subagents: QuestionAgentRole[];
    routing_model: QuestionAgentRoutingModel;
    algorithm_routes: Record<AiGenAlgorithm, QuestionAgentAlgorithmRoute>;
    content_mode_routes: Record<AiGenContentMode, QuestionAgentContentModeRoute>;
  };
  decision_rules: string[];
  recommended_oah: {
    base_url: string;
    runtime_candidates: string[];
    owner_id: string;
    service_name: string;
  };
}

export interface QuestionAgentConfirmationRequirement {
  field: QuestionControlledFieldKey;
  when: "always" | "image_only";
  message: string;
}

export interface QuestionAgentRoutingModel {
  order: Array<"content_mode" | "algorithm">;
  content_modes: AiGenContentMode[];
  algorithms: AiGenAlgorithm[];
  oah_agent_surface: "functional_agents";
}

export interface QuestionAgentAlgorithmRoute {
  strategy: AiGenAlgorithm;
  required_capabilities: QuestionAgentCapabilityName[];
  requires_student_simulation: boolean;
}

export interface QuestionAgentContentModeRoute {
  generator_agent: QuestionAgentRole;
  evaluator_agent: QuestionAgentRole;
  generation_capabilities: QuestionAgentCapabilityName[];
  evaluation_capabilities: QuestionAgentCapabilityName[];
}

export interface QuestionAgentFinalResponseContract {
  version: string;
  required_fields: string[];
  legacy_required_fields: string[];
  item_required_fields: string[];
  image_additional_fields: string[];
  multiple_choice_option_count: number;
  multiple_choice_ground_truth_format: string;
  single_choice_option_count: number | null;
  single_choice_answer_format: string;
  true_false_ground_truth_values: Array<string | boolean>;
}

export interface QuestionAgentContractDocument {
  spec_version: "edu-question-spec.v1";
  runtime_id: string;
  main_agent: QuestionAgentRole;
  subagents: QuestionAgentRole[];
  routing_model: QuestionAgentRoutingModel;
  algorithm_routes: Record<AiGenAlgorithm, QuestionAgentAlgorithmRoute>;
  content_mode_routes: Record<AiGenContentMode, QuestionAgentContentModeRoute>;
  runtime_candidates: string[];
  human_controlled_fields: QuestionControlledFieldKey[];
  agent_controlled_fields: string[];
  explicit_confirmation_requirements: QuestionAgentConfirmationRequirement[];
  human_controlled_rules: string[];
  decision_rules: string[];
  validation_rules: string[];
  final_response_contract: QuestionAgentFinalResponseContract;
}

export interface QuestionSpecNormalizeResponse {
  spec: QuestionGenerationSpec;
  plan: QuestionAgentPlan;
}

export interface QuestionProfileNormalizeResponse<TProfile> {
  profile: TProfile;
}

export type QuestionSpecInput = Partial<AiGenPayload> & {
  request_uuid?: unknown;
  knowledge_points?: unknown;
  strategy?: unknown;
  diagram?: unknown;
  evoq_config?: unknown;
  evoq?: unknown;
  ga?: unknown;
  teacher_profile?: unknown;
  student_profile?: unknown;
};
