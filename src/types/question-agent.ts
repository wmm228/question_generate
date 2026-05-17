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
  "spec-normalizer",
  "text-question-generator",
  "visual-question-generator",
  "student-simulator",
  "text-question-evaluator",
  "visual-question-evaluator",
  "profile-evolution",
] as const;

export const QUESTION_TOOL_NAMES = [
  "validate_question_spec",
  "generate_visual_question",
  "run_evoq_text_question",
  "render_question_image",
  "simulate_student_response",
  "evaluate_text_question",
  "evaluate_visual_question",
  "read_profile",
  "write_profile",
] as const;

export const QUESTION_SPEC_STATUSES = ["draft", "ready", "blocked"] as const;
export const QUESTION_CONTROLLED_FIELD_KEYS = [
  "subject",
  "knowledge_point",
  "difficulty",
  "question_type",
  "content_mode",
  "algorithm",
  "image_requirement",
] as const;

export type QuestionAgentRole = (typeof QUESTION_AGENT_ROLES)[number];
export type QuestionToolName = (typeof QUESTION_TOOL_NAMES)[number];
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
  misconceptions: string[];
  learning_preferences: string[];
  updated_at: string;
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
  required_tools: QuestionToolName[];
  algorithm: AiGenAlgorithm;
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
  tools: QuestionToolName[];
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
    main_agent: QuestionAgentRole;
    subagents: QuestionAgentRole[];
    tools: QuestionToolName[];
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

export interface QuestionAgentContentModeRoute {
  generator_agent: QuestionAgentRole;
  evaluator_agent: QuestionAgentRole;
  generator_tools: QuestionToolName[];
  evaluator_tools: QuestionToolName[];
}

export interface QuestionAgentToolRouting {
  shared: QuestionToolName[];
  by_content_mode: Record<AiGenContentMode, QuestionAgentContentModeRoute>;
  by_algorithm: Record<AiGenAlgorithm, QuestionToolName[]>;
}

export interface QuestionAgentFinalResponseContract {
  required_fields: string[];
  image_additional_fields: string[];
  multiple_choice_option_count: number;
  multiple_choice_ground_truth_format: string;
  true_false_ground_truth_values: string[];
}

export interface QuestionAgentContractDocument {
  spec_version: "edu-question-spec.v1";
  main_agent: QuestionAgentRole;
  subagents: QuestionAgentRole[];
  tools: QuestionToolName[];
  runtime_candidates: string[];
  human_controlled_fields: QuestionControlledFieldKey[];
  agent_controlled_fields: string[];
  explicit_confirmation_requirements: QuestionAgentConfirmationRequirement[];
  human_controlled_rules: string[];
  decision_rules: string[];
  validation_rules: string[];
  tool_routing: QuestionAgentToolRouting;
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
  teacher_profile?: unknown;
  student_profile?: unknown;
};
