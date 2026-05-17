import { createHash, randomUUID } from "crypto";

import {
  AI_GEN_ALGORITHMS,
  AI_GEN_IMAGE_MODES,
  AI_GEN_IMAGE_TARGETS,
  normalizeAiGenPayload,
  validateAiGenPayload,
  type AiGenAlgorithm,
  type AiGenImageMode,
  type AiGenImageTarget,
  type AiGenPayload,
} from "../types/ai-generate";
import {
  type QuestionAgentDesign,
  type QuestionAgentPlan,
  type QuestionAgentRole,
  type QuestionGenerationContract,
  type QuestionGenerationSpec,
  type QuestionProfileNormalizeResponse,
  type QuestionSpecInput,
  type QuestionSpecNormalizeResponse,
  type QuestionToolName,
  type StudentMasterySignal,
  type StudentProfile,
  type TeacherPreferenceProfile,
} from "../types/question-agent";
import { getQuestionAgentContract } from "./question-agent-contract";
import { getOahCoreConfig } from "./oah-config";

const DEFAULT_TEACHER_ID = "default-teacher";
const DEFAULT_STUDENT_ID = "default-student";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
}

function normalizeNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(normalizeString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAlgorithmArray(value: unknown): AiGenAlgorithm[] {
  const allowed = new Set<string>(AI_GEN_ALGORITHMS);
  const algorithms = normalizeStringArray(value).filter((item): item is AiGenAlgorithm => allowed.has(item));
  return algorithms.length > 0 ? algorithms : ["direct", "cot", "evoq"];
}

function normalizeMasterySignals(value: unknown): StudentMasterySignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord).map((item) => {
    const knowledgePoint = normalizeString(item.knowledge_point) || "unknown";
    return {
      knowledge_point: knowledgePoint,
      mastery: clamp(normalizeNumber(item.mastery, 0.5), 0, 1),
      confidence: clamp(normalizeNumber(item.confidence, 0.5), 0, 1),
      evidence: normalizeString(item.evidence),
    };
  });
}

function normalizeImageTargets(value: AiGenPayload["image_targets"]): AiGenImageTarget[] {
  const allowed = new Set<string>(AI_GEN_IMAGE_TARGETS);
  return value.filter((target): target is AiGenImageTarget => allowed.has(target));
}

function normalizeImageMode(value: AiGenPayload["image_mode"]): AiGenImageMode {
  return AI_GEN_IMAGE_MODES.includes(value) ? value : "none";
}

function hasExplicitConfirmation(input: QuestionSpecInput, payload: AiGenPayload, field: string): boolean {
  switch (field) {
    case "subject":
      return Boolean(normalizeString(input.subject));
    case "knowledge_point":
      return Boolean(normalizeString(input.knowledge_point));
    case "difficulty":
      return Boolean(normalizeString(input.difficulty));
    case "question_type":
      return Boolean(normalizeString(input.question_type));
    case "content_mode":
      return Boolean(normalizeString(input.content_mode));
    case "algorithm":
      return Boolean(normalizeString(input.algorithm));
    case "image_requirement":
      return payload.content_mode !== "image"
        || payload.image_targets.length > 0
        || Boolean(normalizeString(input.image_placement));
    default:
      return false;
  }
}

function collectHumanControlledInputErrors(input: QuestionSpecInput, payload: AiGenPayload): string[] {
  const contract = getQuestionAgentContract();
  return contract.explicit_confirmation_requirements.flatMap((requirement) => {
    if (requirement.when === "image_only" && payload.content_mode !== "image") {
      return [];
    }
    return hasExplicitConfirmation(input, payload, requirement.field) ? [] : [requirement.message];
  });
}

export function normalizeTeacherPreferenceProfile(value: unknown, now = new Date()): TeacherPreferenceProfile {
  const source = isRecord(value) ? value : {};
  return {
    teacher_id: normalizeString(source.teacher_id) || DEFAULT_TEACHER_ID,
    subject_focus: normalizeStringArray(source.subject_focus),
    grade_band: normalizeString(source.grade_band) || "high_school",
    pedagogical_style: normalizeString(source.pedagogical_style) || "structured_step_by_step",
    difficulty_policy: normalizeString(source.difficulty_policy) || "match_requested_level",
    visual_policy: normalizeString(source.visual_policy) || "use_visuals_only_when_answer_relevant",
    language_policy: normalizeString(source.language_policy) || "clear_student_facing_chinese",
    algorithm_preferences: normalizeAlgorithmArray(source.algorithm_preferences),
    constraints: normalizeStringArray(source.constraints),
    updated_at: normalizeString(source.updated_at) || now.toISOString(),
  };
}

export function normalizeStudentProfile(value: unknown, now = new Date()): StudentProfile {
  const source = isRecord(value) ? value : {};
  return {
    student_id: normalizeString(source.student_id) || DEFAULT_STUDENT_ID,
    ability_theta: clamp(normalizeNumber(source.ability_theta, 0), -4, 4),
    mastery: normalizeMasterySignals(source.mastery),
    misconceptions: normalizeStringArray(source.misconceptions),
    learning_preferences: normalizeStringArray(source.learning_preferences),
    updated_at: normalizeString(source.updated_at) || now.toISOString(),
  };
}

function buildSpecId(payload: AiGenPayload, requestId: string): string {
  const digest = createHash("sha256")
    .update(`${requestId}:${payload.subject}:${payload.knowledge_point}:${payload.difficulty}:${payload.algorithm}:${payload.content_mode}`)
    .digest("hex")
    .slice(0, 16);
  return `qspec_${digest}`;
}

function resolveGeneratorAgent(payload: AiGenPayload): QuestionAgentRole {
  const contract = getQuestionAgentContract();
  return contract.tool_routing.by_content_mode[payload.content_mode].generator_agent;
}

function resolveEvaluatorAgent(payload: AiGenPayload): QuestionAgentRole {
  const contract = getQuestionAgentContract();
  return contract.tool_routing.by_content_mode[payload.content_mode].evaluator_agent;
}

function resolveRequiredTools(payload: AiGenPayload): QuestionToolName[] {
  const contract = getQuestionAgentContract();
  const modeRouting = contract.tool_routing.by_content_mode[payload.content_mode];
  return Array.from(
    new Set<QuestionToolName>([
      ...contract.tool_routing.shared,
      ...modeRouting.generator_tools,
      ...modeRouting.evaluator_tools,
      ...contract.tool_routing.by_algorithm[payload.algorithm],
    ]),
  );
}

function buildGenerationContract(payload: AiGenPayload): QuestionGenerationContract {
  const contract = getQuestionAgentContract();
  return {
    primary_agent: contract.main_agent,
    generator_agent: resolveGeneratorAgent(payload),
    evaluator_agent: resolveEvaluatorAgent(payload),
    required_tools: resolveRequiredTools(payload),
    algorithm: payload.algorithm,
    oah_runtime_candidates: [...contract.runtime_candidates],
  };
}

function buildPlan(spec: QuestionGenerationSpec): QuestionAgentPlan {
  const contract = getQuestionAgentContract();
  const blocksGeneration = spec.status !== "ready";
  const modeRouting = contract.tool_routing.by_content_mode[spec.content_mode];
  const generatorTools = Array.from(
    new Set<QuestionToolName>([
      ...modeRouting.generator_tools,
      ...contract.tool_routing.by_algorithm[spec.algorithm],
    ]),
  );

  return {
    plan_id: `qplan_${randomUUID()}`,
    request_uuid: spec.request_uuid,
    status: spec.status === "ready" ? "ready" : "blocked",
    steps: [
      {
        role: contract.main_agent,
        action: "Collect missing teacher intent, explicit constraints, and preference profile signals.",
        tools: ["read_profile"],
        blocks_generation: blocksGeneration,
      },
      {
        role: "spec-normalizer",
        action: "Normalize request into edu-question-spec.v1 and validate required fields.",
        tools: ["validate_question_spec"],
        blocks_generation: blocksGeneration,
      },
      {
        role: spec.generation_contract.generator_agent,
        action: spec.content_mode === "image"
          ? "Generate a visual question draft and visual dependency contract."
          : "Generate a text question draft.",
        tools: generatorTools,
        blocks_generation: false,
      },
      {
        role: spec.generation_contract.evaluator_agent,
        action: spec.content_mode === "image"
          ? "Evaluate schema validity, educational quality, difficulty fit, SVG safety, and image relevance."
          : "Evaluate schema validity, educational quality, difficulty fit, and answer correctness.",
        tools: [...modeRouting.evaluator_tools],
        blocks_generation: false,
      },
      {
        role: "student-simulator",
        action: "Estimate student response behavior and IRT fit for future profile updates.",
        tools: ["simulate_student_response"],
        blocks_generation: false,
      },
      {
        role: "profile-evolution",
        action: "Persist teacher preference and student mastery updates outside the service process.",
        tools: ["write_profile"],
        blocks_generation: false,
      },
    ],
  };
}

export function normalizeQuestionGenerationSpec(input: QuestionSpecInput): QuestionSpecNormalizeResponse {
  const contract = getQuestionAgentContract();
  const requestId = normalizeString(input.request_uuid) || randomUUID();
  const payload = normalizeAiGenPayload(input);
  const validationError = validateAiGenPayload(payload);
  const now = new Date();
  const teacherProfile = normalizeTeacherPreferenceProfile(input.teacher_profile, now);
  const studentProfile = normalizeStudentProfile(input.student_profile, now);
  const validationErrors = [
    ...collectHumanControlledInputErrors(input, payload),
    ...(validationError ? [validationError] : []),
  ];
  const generationContract = buildGenerationContract(payload);

  const spec: QuestionGenerationSpec = {
    spec_id: buildSpecId(payload, requestId),
    request_uuid: requestId,
    version: contract.spec_version,
    status: validationErrors.length > 0 ? "blocked" : "ready",
    subject: payload.subject,
    knowledge_point: payload.knowledge_point,
    difficulty_level: Number.parseInt(payload.difficulty, 10),
    question_type: payload.question_type,
    content_mode: payload.content_mode,
    algorithm: payload.algorithm,
    image_requirement: {
      mode: normalizeImageMode(payload.image_mode),
      targets: normalizeImageTargets(payload.image_targets),
      renderer: payload.content_mode === "image" ? "safe_svg" : "none",
      must_be_answer_relevant: payload.content_mode === "image",
    },
    teacher_profile: teacherProfile,
    student_profile: studentProfile,
    human_controlled_rules: [...contract.human_controlled_rules],
    validation_errors: validationErrors,
    generation_contract: generationContract,
    created_at: now.toISOString(),
  };

  return {
    spec,
    plan: buildPlan(spec),
  };
}

export function buildQuestionAgentDesign(): QuestionAgentDesign {
  const config = getOahCoreConfig();
  const contract = getQuestionAgentContract();
  return {
    architecture: {
      main_agent: contract.main_agent,
      subagents: [...contract.subagents],
      tools: [...contract.tools],
    },
    decision_rules: [...contract.decision_rules],
    recommended_oah: {
      base_url: config.baseUrl,
      runtime_candidates: [...contract.runtime_candidates],
      owner_id: config.workspaceOwnerId || "tutor",
      service_name: config.workspaceServiceName || "microlearning",
    },
  };
}

export function normalizeTeacherProfileResponse(value: unknown): QuestionProfileNormalizeResponse<TeacherPreferenceProfile> {
  return {
    profile: normalizeTeacherPreferenceProfile(value),
  };
}

export function normalizeStudentProfileResponse(value: unknown): QuestionProfileNormalizeResponse<StudentProfile> {
  return {
    profile: normalizeStudentProfile(value),
  };
}
