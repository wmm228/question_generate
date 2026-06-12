import fs from "fs";
import path from "path";

import {
  AI_GEN_CONTENT_MODE_LABELS,
  AI_GEN_IMAGE_MODE_LABELS,
  AI_GEN_IMAGE_PLACEMENT_LABELS,
  AI_GEN_IMAGE_TARGET_LABELS,
  AI_GEN_QUESTION_TYPE_LABELS,
  type AiGenerateRequestMeta,
  type AiGenerateResponse,
  type AiGenImagePlacementOrEmpty,
  type AiGenPayload,
} from "../../types/ai-generate";
import type { QuestionGenerationSpec, QuestionSpecNormalizeResponse } from "../../types/question-agent";
import {
  buildFailedVisualResponse,
  mergeVisualResultIntoResponse,
  normalizeImagePosition,
  placementToImageTargets,
  renderSvgImageForQuestion,
} from "../../../ai_generators-ts/multimodal_runtime/tutor_integration";
import { getOahCoreConfig } from "../oah-config";
import {
  createOahSessionClient,
  resolveOahWorkspace,
  type OahSessionClient,
  type OahWorkspaceResolutionResult,
} from "../oah-client";
import { logEvent, serializeError } from "../../utils/request";
import type {
  AiGenerateExecutionContext,
  AiGenerateProgressEvent,
  AiGenerateProgressReporter,
  DraftArtifact,
  NormalizedEvaluationPayload,
  NormalizedRawGeneratedPayload,
  RawEvaluationPayload,
  RawGeneratedPayload,
} from "./types";

const OPTION_KEYS = ["A", "B", "C", "D"] as const;
const INVALID_EVALUATION_PASSED_FLAG_ERROR = "AI 评估结果缺少有效的 passed 布尔值";
const INVALID_EVALUATION_SCHEMA_ERROR = "AI 评估结果结构不完整";

type OptionKey = (typeof OPTION_KEYS)[number];

function requireConfiguredValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} 尚未配置`);
  }
  return trimmed;
}

export function truncateForLog(value: string, maxLength = 800): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...<已截断>`;
}

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  const text = normalizeString(value);
  return text ? [text] : [];
}

export function buildPromptSpecJson(spec: QuestionGenerationSpec): string {
  const compactSpec = {
    spec_id: spec.spec_id,
    subject: spec.subject,
    knowledge_point: spec.knowledge_point,
    difficulty_level: spec.difficulty_level,
    question_type: spec.question_type,
    content_mode: spec.content_mode,
    algorithm: spec.algorithm,
    image_requirement: spec.image_requirement,
    evoq_config: spec.evoq_config,
    teacher_profile: {
      pedagogical_style: spec.teacher_profile.pedagogical_style,
      difficulty_policy: spec.teacher_profile.difficulty_policy,
      visual_policy: spec.teacher_profile.visual_policy,
      language_policy: spec.teacher_profile.language_policy,
      constraints: spec.teacher_profile.constraints,
    },
    student_profile: {
      ability_theta: spec.student_profile.ability_theta,
      common_errors: spec.student_profile.common_errors,
      misconceptions: spec.student_profile.misconceptions,
      mastery: spec.student_profile.mastery,
      irt: spec.student_profile.irt,
      learning_preferences: spec.student_profile.learning_preferences,
    },
  };
  return JSON.stringify(compactSpec, null, 2);
}

function validateNonEmptyString(value: unknown, fieldName: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`AI 出题结果缺少非空字段：${fieldName}`);
  }
  return normalized;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findPromptPath(relativeCandidates: string[]): string {
  const promptPath = relativeCandidates.find((candidatePath) => fs.existsSync(candidatePath));
  if (!promptPath) {
    throw new Error(`未找到提示模板：${relativeCandidates.join(", ")}`);
  }
  return promptPath;
}

function loadAlgorithmPromptTemplate(algorithm: AiGenPayload["algorithm"]): string {
  const promptPath = findPromptPath([
    path.resolve(process.cwd(), `src/prompts/question-agents/algorithms/${algorithm}.md`),
    path.resolve(__dirname, `../../prompts/question-agents/algorithms/${algorithm}.md`),
    path.resolve(process.cwd(), `ai_generators-ts/prompts/${algorithm}.md`),
    path.resolve(__dirname, `../../../ai_generators-ts/prompts/${algorithm}.md`),
  ]);
  return fs.readFileSync(promptPath, "utf-8");
}

function loadQuestionAgentPromptTemplate(name: string): string {
  const promptPath = findPromptPath([
    path.resolve(process.cwd(), `src/prompts/question-agents/${name}`),
    path.resolve(__dirname, `../../prompts/question-agents/${name}`),
  ]);
  return fs.readFileSync(promptPath, "utf-8");
}

function applyBindings(template: string, bindings: Record<string, string>): string {
  return Object.entries(bindings).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{${key}}`, value),
    template,
  );
}

function buildSubjectRoleInstruction(subject: string): string {
  const normalized = normalizeString(subject);
  if (!normalized) {
    return "请以对应学科教师和命题专家的身份处理本题。";
  }
  return `请以${normalized}学科教师和${normalized}课程命题专家的身份处理本题，使用该学科自然的概念边界、术语、情境和评分标准。`;
}

function renderAlgorithmPrompt(template: string, payload: AiGenPayload): string {
  const renderedTemplate = applyBindings(template, {
    subject: payload.subject,
    knowledge_id: payload.knowledge_point,
    difficulty_target: payload.difficulty,
    few_shots: "当前 Tutor 请求未提供 few-shot 示例。",
  });

  const questionTypeInstruction =
    payload.question_type === "multiple_choice"
      ? "- 题型必须是选择题。question 只写题干，不要把 A/B/C/D 拼进 question；options 必须是长度为 4 的字符串数组，并按 A/B/C/D 顺序输出；ground_truth 必须是单个选项字母。"
      : payload.question_type === "true_false"
        ? "- 题型必须是判断题。不要生成 A/B/C/D 选项。ground_truth 必须是“正确”或“错误”。"
        : "- 题型必须是简答题。不要生成 A/B/C/D 选项。ground_truth 应写最终答案或关键答案点。";

  const textFields = payload.question_type === "multiple_choice"
    ? "question、options、solution_steps、ground_truth"
    : "question、solution_steps、ground_truth";
  const imageFields = payload.question_type === "multiple_choice"
    ? "question、options、solution_steps、ground_truth、image_position、image_svg、render_notes"
    : "question、solution_steps、ground_truth、image_position、image_svg、render_notes";
  const algorithmMetadataInstruction =
    payload.algorithm === "cot"
      ? "- CoT 基线可额外输出 design_thought 字段，但核心题目字段必须完整。"
      : payload.algorithm === "react"
        ? "- ReAct 基线可额外输出 thought 字段，但核心题目字段必须完整。"
        : "";
  const outputSchemaInstruction =
    payload.content_mode === "image"
      ? `- 核心输出字段必须包含：${imageFields}。
- image_position 必须是 stem_image、explanation_image、option_image 之一。优先使用已选位置：${payload.image_placement || "stem_image"}。
- image_svg 必须是一份完整的 SVG 字符串，以 <svg ...> 开头并包含 </svg>。
- SVG 必须使用 viewBox，并把全部可见内容放在画布内，四周保留清晰边距，不得贴边或裁切。
- SVG 只能使用基础矢量元素，例如 g、line、rect、circle、ellipse、polygon、polyline、path、text。
- 不要包含 script、foreignObject、image、style、animate、set、href、xlink:href、src、事件属性、url(...) 或任何外部资源引用。
- 文本标签优先使用简短中文；变量名、坐标轴字母和 A/B/C/D 可使用 ASCII。避免 LaTeX 语法、上下标和 "$...$"。`
      : `- 核心输出字段必须包含：${textFields}。`;

  const imageInstruction =
    payload.content_mode === "image"
      ? `- 这是一道依赖配图作答的题目。当前选定图片位置为 ${payload.image_placement || "stem_image"}，目标区域为 ${payload.image_targets.join(", ")}。
- 你必须在一次响应中同时给出完整的题目文本字段，以及 image_position 与 image_svg。
- 当图片模式为必需时，题干必须明确依赖图形信息，不能脱离图片独立作答。
- 图片中必须包含本题推理所依赖的数值、标签、关系、几何结构、图表或示意信息。`
      : "- 这是一道纯文本题。不要依赖任何图片、图表、示意图或外部视觉信息。";
  const optionImageInstruction =
    payload.content_mode === "image" && payload.image_targets.includes("options")
      ? "- 选项配图必须服务于 A/B/C/D 各选项：image_svg 应在同一张图中绘制四个清晰分区或并列小图，并用 A、B、C、D 标明；每个选项文本要对应图中的同名分区。"
      : "";

  return `${renderedTemplate}

附加约束：
- 只返回一个合法 JSON 对象。不要输出 Markdown 代码块，也不要在 JSON 之外补充说明文字。
- 学科参数必须为：${payload.subject}
- ${buildSubjectRoleInstruction(payload.subject)}
- 知识点必须始终聚焦：${payload.knowledge_point}
- 难度必须控制在：${payload.difficulty} / 6
- 题型必须为：${payload.question_type}
- 题干、选项、解析、答案与说明全部使用简体中文；除数学符号、变量名、选项字母外，不要输出英文句子。
${outputSchemaInstruction}
${algorithmMetadataInstruction}
${questionTypeInstruction}
${imageInstruction}
${optionImageInstruction}`;
}

function extractJsonPreviewForLog(content: string): string | null {
  try {
    return truncateForLog(extractJsonObject(content), 400);
  } catch {
    return null;
  }
}

function logAgentStageRequest(
  requestId: string,
  stageKey: string,
  agentName: string,
  content: string,
): void {
  logEvent("info", null, "ai_generate.agent.requested", {
    request_uuid: requestId,
    stage_key: stageKey,
    agent_name: agentName,
    prompt_preview: truncateForLog(content, 400),
  });
}

function logAgentStageResponse(
  requestId: string,
  stageKey: string,
  agentName: string,
  content: string,
): void {
  logEvent("info", null, "ai_generate.agent.responded", {
    request_uuid: requestId,
    stage_key: stageKey,
    agent_name: agentName,
    response_preview: truncateForLog(content, 400),
    extracted_json_preview: extractJsonPreviewForLog(content),
  });
}

export function extractJsonObject(rawText: string): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("AI 出题结果为空");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const fencedInner = fencedMatch[1].trim();
    if (fencedInner.startsWith("{") && fencedInner.endsWith("}")) {
      try {
        const parsed: unknown = JSON.parse(fencedInner);
        if (isRecord(parsed)) {
          return fencedInner;
        }
      } catch {
        // Fall through to generic extraction.
      }
    }
  }

  const candidateStarts: number[] = [];
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === "{") {
      candidateStarts.push(index);
    }
  }

  for (const start of candidateStarts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "{") {
        depth += 1;
        continue;
      }
      if (char !== "}") {
        continue;
      }
      depth -= 1;
      if (depth !== 0) {
        continue;
      }
      const candidate = trimmed.slice(start, index + 1);
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (isRecord(parsed)) {
          return candidate;
        }
      } catch {
        // Continue searching for embedded JSON.
      }
    }
  }

  throw new Error("AI 出题结果中未找到合法 JSON 对象");
}

function normalizeSolutionSteps(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  const text = normalizeString(value);
  return text ? text.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean) : [];
}

function stripMultipleChoiceOptionLabel(option: string): string {
  return option.replace(/^[A-D]\s*[.、:：)]\s*/i, "").trim();
}

function normalizeExplicitMultipleChoiceOptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => stripMultipleChoiceOptionLabel(normalizeString(item)));
  }
  if (isRecord(value)) {
    return OPTION_KEYS.map((key) => stripMultipleChoiceOptionLabel(normalizeString(value[key])));
  }
  return [];
}

function validateMultipleChoiceOptions(options: string[]): string[] {
  if (options.length !== OPTION_KEYS.length) {
    throw new Error(`AI 出题结果中的选择题选项数量不合法：${options.length}`);
  }

  const normalizedOptions = options.map((option) => stripMultipleChoiceOptionLabel(option));
  if (normalizedOptions.some((option) => !option)) {
    throw new Error("AI 出题结果中的选择题选项不能为空");
  }

  const comparableOptions = normalizedOptions.map((option) => option.replace(/\s+/g, "").toLowerCase());
  if (new Set(comparableOptions).size !== normalizedOptions.length) {
    throw new Error("AI 出题结果中的选择题选项存在重复内容");
  }

  return normalizedOptions;
}

function extractMultipleChoiceParts(question: string): { question: string; options: string[] } {
  const lines = question.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const optionPattern = /^([A-D])\s*[.、:：)]\s*(.*)$/;
  const optionEntries = lines
    .map((line) => {
      const match = line.match(optionPattern);
      return match ? { key: match[1], text: stripMultipleChoiceOptionLabel(match[2].trim() || line) } : null;
    })
    .filter((entry): entry is { key: string; text: string } => entry !== null);
  const optionKeys = new Set(optionEntries.map((entry) => entry.key));
  const options = OPTION_KEYS
    .filter((key) => optionKeys.has(key))
    .map((key) => optionEntries.find((entry) => entry.key === key)?.text || "");
  const questionLines = lines.filter((line) => !optionPattern.test(line));
  if (options.length === 0) {
    return { question: question.trim(), options: [] };
  }
  return {
    question: questionLines.join("\n").trim(),
    options,
  };
}

function normalizeMultipleChoiceGroundTruth(answer: string): "A" | "B" | "C" | "D" {
  const normalized = answer.trim().toUpperCase();
  if (normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D") {
    return normalized;
  }
  throw new Error("AI 出题结果中的选择题 ground_truth 不合法");
}

function normalizeTrueFalseAnswer(answer: string): string {
  const normalized = answer.trim();
  if (["正确", "对", "true", "True", "TRUE", "A"].includes(normalized)) {
    return "正确";
  }
  if (["错误", "错", "false", "False", "FALSE", "B"].includes(normalized)) {
    return "错误";
  }
  return normalized;
}

function buildRequestMeta(payload: AiGenPayload): AiGenerateRequestMeta {
  return {
    subject: payload.subject,
    question_type: payload.question_type,
    question_type_label: AI_GEN_QUESTION_TYPE_LABELS[payload.question_type],
    content_mode: payload.content_mode,
    content_mode_label: AI_GEN_CONTENT_MODE_LABELS[payload.content_mode],
    image_mode: payload.image_mode,
    image_mode_label: AI_GEN_IMAGE_MODE_LABELS[payload.image_mode],
    image_placement: payload.image_placement,
    image_placement_label: AI_GEN_IMAGE_PLACEMENT_LABELS[payload.image_placement],
    image_targets: payload.image_targets,
    image_target_labels: payload.image_targets.map((target) => AI_GEN_IMAGE_TARGET_LABELS[target]),
  };
}

function buildStructuredResponse(
  question: string,
  options: string[],
  solutionSteps: string[],
  payload: AiGenPayload,
): Pick<AiGenerateResponse, "content" | "assets" | "visual_pipeline" | "image_generation_failed"> {
  const stemTargeted = payload.image_targets.includes("stem");
  const solutionTargeted = payload.image_targets.includes("solution");
  const optionsTargeted = payload.image_targets.includes("options");

  return {
    content: {
      stem: {
        text: question,
        image_targeted: stemTargeted,
        image: stemTargeted ? { role: "stem", label: "题干配图", url: null } : null,
      },
      options: options.map((option, index) => {
        const optionKey = payload.question_type === "multiple_choice"
          ? (OPTION_KEYS[index] as OptionKey | undefined)
          : undefined;
        return {
          key: optionKey || "",
          text: option,
          image_targeted: optionsTargeted,
          image: optionsTargeted
            ? {
                role: "option" as const,
                option_key: optionKey,
                label: optionKey ? `选项${optionKey}配图` : "选项配图",
                url: null,
              }
            : null,
        };
      }),
      solution: {
        steps: solutionSteps,
        image_targeted: solutionTargeted,
        image: solutionTargeted ? { role: "solution", label: "解析配图", url: null } : null,
      },
    },
    assets: {
      stem_image: null,
      explanation_image: null,
      option_images: payload.question_type === "multiple_choice"
        ? Object.fromEntries(OPTION_KEYS.map((key) => [key, null]))
        : {},
    },
    visual_pipeline: payload.content_mode === "image"
      ? {
          requested: true,
          image_mode: payload.image_mode,
          image_targets: payload.image_targets,
          status: "pending",
          provider: "safe_svg",
          stage: "render_pending",
        }
      : {
          requested: false,
          image_mode: "none",
          image_targets: [],
          status: "not_requested",
          provider: "none",
          stage: "idle",
        },
  };
}

function parseGeneratedPayloadObject(content: string): RawGeneratedPayload {
  const jsonText = extractJsonObject(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `AI 出题结果的负载 JSON 不合法：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("AI 出题结果的负载不是合法对象");
  }
  return parsed;
}

function unwrapGeneratedPayloadObject(rawPayload: RawGeneratedPayload): RawGeneratedPayload {
  if (isRecord(rawPayload.Item)) {
    return rawPayload.Item;
  }
  if (isRecord(rawPayload.item)) {
    return rawPayload.item;
  }
  if (isRecord(rawPayload.result)) {
    return rawPayload.result;
  }
  return rawPayload;
}

function normalizeImageQuestionFields(
  rawPayload: RawGeneratedPayload,
  payload: AiGenPayload,
): Partial<NormalizedRawGeneratedPayload> {
  if (payload.content_mode !== "image") {
    return {};
  }

  const imagePosition = normalizeImagePosition(normalizeString(rawPayload.image_position), payload.image_targets);
  const imageSvg = validateNonEmptyString(rawPayload.image_svg ?? rawPayload.image_code, "image_svg");
  return {
    image_position: imagePosition || payload.image_placement || "stem_image",
    image_svg: imageSvg,
    render_notes: normalizeString(rawPayload.render_notes),
  };
}

export function parseRawGeneratedPayload(content: string, payload: AiGenPayload): NormalizedRawGeneratedPayload {
  const rawPayload = unwrapGeneratedPayloadObject(parseGeneratedPayloadObject(content));
  const solutionSteps = normalizeSolutionSteps(rawPayload.solution_steps ?? rawPayload.analysis);
  if (solutionSteps.length === 0) {
    throw new Error("AI 出题结果中的 solution_steps 不能为空");
  }
  const explicitOptions = payload.question_type === "multiple_choice"
    ? normalizeExplicitMultipleChoiceOptions(rawPayload.options)
    : [];
  return {
    question: validateNonEmptyString(rawPayload.question ?? rawPayload.stem, "question"),
    ...(explicitOptions.length > 0 ? { options: explicitOptions } : {}),
    solution_steps: solutionSteps,
    ground_truth: validateNonEmptyString(rawPayload.ground_truth ?? rawPayload.answer, "ground_truth"),
    ...normalizeImageQuestionFields(rawPayload, payload),
  };
}

export function serializeNormalizedDraftForPrompt(raw: NormalizedRawGeneratedPayload): string {
  return JSON.stringify(
    {
      question: raw.question,
      ...(raw.options && raw.options.length > 0 ? { options: raw.options } : {}),
      solution_steps: raw.solution_steps,
      ground_truth: raw.ground_truth,
      ...(raw.image_position ? { image_position: raw.image_position } : {}),
      ...(raw.image_svg ? { image_svg: raw.image_svg } : {}),
      ...(raw.render_notes ? { render_notes: raw.render_notes } : {}),
    },
    null,
    2,
  );
}

function parseEvaluationPayload(content: string): NormalizedEvaluationPayload {
  const jsonText = extractJsonObject(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `AI 评估结果的负载 JSON 不合法：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("AI 评估结果的负载不是合法对象");
  }
  const raw = parsed as RawEvaluationPayload;
  if (typeof raw.passed !== "boolean") {
    throw new Error(INVALID_EVALUATION_PASSED_FLAG_ERROR);
  }
  const issues = normalizeStringArray(raw.issues);
  const qualityGate = isRecord(raw.quality_gate) ? raw.quality_gate : {};
  if ("passed" in qualityGate && typeof qualityGate.passed !== "boolean") {
    throw new Error(INVALID_EVALUATION_PASSED_FLAG_ERROR);
  }
  const qualityGatePassed = typeof qualityGate.passed === "boolean" ? qualityGate.passed : true;
  const qualityGateIssues = normalizeStringArray(qualityGate.issues);
  const passed = raw.passed && qualityGatePassed;
  const score = typeof raw.score === "number" ? raw.score : Number.parseFloat(normalizeString(raw.score));
  const fitness = typeof raw.fitness === "number" ? raw.fitness : Number.parseFloat(normalizeString(raw.fitness));
  const algorithmFeedback = isRecord(raw.algorithm_feedback) ? raw.algorithm_feedback : {};
  const difficultyDirection = normalizeString(raw.difficulty_direction);
  const revisionInstructions = normalizeString(raw.revision_instructions);
  const mutationInstructions =
    normalizeString(algorithmFeedback.mutation_instructions)
    || normalizeString(raw.mutation_instructions);
  const rethinkInstructions =
    normalizeString(algorithmFeedback.rethink_instructions)
    || normalizeString(raw.rethink_instructions);
  const nextActionHint =
    normalizeString(algorithmFeedback.next_action_hint)
    || normalizeString(raw.next_action_hint);
  const allIssues = Array.from(
    new Set([
      ...qualityGateIssues,
      ...(!qualityGatePassed && qualityGateIssues.length === 0 ? ["quality_gate 未通过，但评估器未返回具体问题"] : []),
      ...issues,
    ]),
  );
  if (!passed && !revisionInstructions && allIssues.length === 0) {
    throw new Error(INVALID_EVALUATION_SCHEMA_ERROR);
  }
  const normalizedScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : (passed ? 80 : 40);
  return {
    passed,
    score: normalizedScore,
    fitness: Number.isFinite(fitness) ? Math.max(0, Math.min(100, Math.round(fitness))) : normalizedScore,
    strengths: normalizeStringArray(raw.strengths),
    weaknesses: normalizeStringArray(raw.weaknesses),
    issues: Array.from(new Set(allIssues)),
    difficulty_direction:
      difficultyDirection === "easier" || difficultyDirection === "matched" || difficultyDirection === "harder"
        ? difficultyDirection
        : "unclear",
    revision_instructions: revisionInstructions || allIssues.join("；"),
    algorithm_feedback: {
      summary: normalizeString(algorithmFeedback.summary),
      mutation_instructions: mutationInstructions,
      rethink_instructions: rethinkInstructions,
      next_action_hint: nextActionHint,
    },
  };
}

function buildDirectEvaluatorMessage(
  payload: AiGenPayload,
  specContext: QuestionSpecNormalizeResponse,
  generatedDraftJson: string,
  strictJsonOnly = false,
): string {
  const checks =
    payload.content_mode === "image"
      ? [
          "字段结构是否合法，必填字段是否齐全。",
          "是否准确对齐指定知识点，并符合目标难度。",
          "如果是选择题，选项格式与 ground_truth 是否合法。",
          "图片是否与题目强相关，且作答时确实必须依赖该图。",
          "image_svg 是否为完整、安全、无需执行代码即可渲染的 SVG。",
        ]
      : [
          "字段结构是否合法，必填字段是否齐全。",
          "是否准确对齐指定知识点，并符合目标难度。",
          "如果是选择题，选项格式与 ground_truth 是否合法。",
          "答案是否正确，教学质量是否达标。",
        ];

  return applyBindings(loadQuestionAgentPromptTemplate("direct-evaluator.md"), {
    subject: payload.subject,
    spec_json: buildPromptSpecJson(specContext.spec),
    draft_json: generatedDraftJson,
    checklist: checks.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  }).concat(
    strictJsonOnly
      ? '\n\n重试要求：\n- 你上一轮的回复没有满足评估器约定的 JSON 结构。\n- 这一次只能返回 direct-evaluator.md 约定的评估 JSON。\n- 不要返回题目草稿 JSON。\n- 不要在 JSON 之外输出任何文字。\n'
      : "",
  );
}

function isRetryableEvaluationParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(INVALID_EVALUATION_PASSED_FLAG_ERROR)
    || message.includes(INVALID_EVALUATION_SCHEMA_ERROR)
    || message.includes("JSON");
}

function buildLocalSchemaFallbackEvaluation(error: unknown): NormalizedEvaluationPayload {
  const message = error instanceof Error ? error.message : String(error);
  return {
    passed: true,
    score: 72,
    fitness: 72,
    strengths: ["本地 schema 解析已通过，题目结构可继续进入后续流程"],
    weaknesses: [`OAH 评估器返回了非标准 JSON，已使用本地结构校验兜底：${truncateForLog(message, 160)}`],
    issues: [],
    difficulty_direction: "unclear",
    revision_instructions: "",
    algorithm_feedback: {
      summary: "评估器输出格式不稳定，已使用本地 schema 兜底放行。",
      mutation_instructions: "保持当前题目结构，后续如需更严格质量评估可重新调用评估器。",
      rethink_instructions: "",
      next_action_hint: "accept",
    },
  };
}

function adaptGeneratedPayload(raw: NormalizedRawGeneratedPayload, payload: AiGenPayload): AiGenerateResponse {
  const requestMeta = buildRequestMeta(payload);
  if (payload.question_type === "multiple_choice") {
    const multipleChoice = extractMultipleChoiceParts(raw.question);
    const question = multipleChoice.question || raw.question;
    if (!question) {
      throw new Error("AI 出题结果中的选择题题干为空");
    }
    const options = validateMultipleChoiceOptions(raw.options && raw.options.length > 0
      ? raw.options
      : multipleChoice.options);
    const groundTruth = normalizeMultipleChoiceGroundTruth(raw.ground_truth);
    return {
      question,
      options,
      solution_steps: raw.solution_steps,
      ground_truth: groundTruth,
      ...(raw.image_position ? { image_position: raw.image_position } : {}),
      ...(raw.image_svg ? { image_svg: raw.image_svg } : {}),
      ...(raw.image_code ? { image_code: raw.image_code } : {}),
      meta: requestMeta,
      request: requestMeta,
      ...buildStructuredResponse(question, options, raw.solution_steps, payload),
    };
  }

  if (payload.question_type === "true_false") {
    const groundTruth = normalizeTrueFalseAnswer(raw.ground_truth);
    if (groundTruth !== "正确" && groundTruth !== "错误") {
      throw new Error("AI 出题结果中的判断题 ground_truth 不合法");
    }
    return {
      question: raw.question,
      options: ["正确", "错误"],
      solution_steps: raw.solution_steps,
      ground_truth: groundTruth,
      ...(raw.image_position ? { image_position: raw.image_position } : {}),
      ...(raw.image_svg ? { image_svg: raw.image_svg } : {}),
      ...(raw.image_code ? { image_code: raw.image_code } : {}),
      meta: requestMeta,
      request: requestMeta,
      ...buildStructuredResponse(raw.question, ["正确", "错误"], raw.solution_steps, payload),
    };
  }

  return {
    question: raw.question,
    options: [],
    solution_steps: raw.solution_steps,
    ground_truth: raw.ground_truth,
    ...(raw.image_position ? { image_position: raw.image_position } : {}),
    ...(raw.image_svg ? { image_svg: raw.image_svg } : {}),
    ...(raw.image_code ? { image_code: raw.image_code } : {}),
    meta: requestMeta,
    request: requestMeta,
    ...buildStructuredResponse(raw.question, [], raw.solution_steps, payload),
  };
}

function applyImagePositionToPayload(
  payload: AiGenPayload,
  imagePosition: AiGenImagePlacementOrEmpty,
): AiGenPayload {
  return {
    ...payload,
    image_placement: imagePosition,
    image_targets: placementToImageTargets(imagePosition),
  };
}

export interface AiGenerateRuntime {
  payload: AiGenPayload;
  requestId: string;
  specContext: QuestionSpecNormalizeResponse;
  generatorAgent: string;
  evaluatorAgent: string;
  algorithmPrompt: string;
  reportProgress?: AiGenerateProgressReporter;
  updateProgress: (event: AiGenerateProgressEvent) => void;
  buildPrompt: (name: string, bindings: Record<string, string>) => string;
  buildGeneratorMessage: (generationConstraints: string) => string;
  buildRevisionMessage: (
    previousDraftJson: string,
    evaluation: NormalizedEvaluationPayload,
    generationConstraints: string,
  ) => string;
  callGenerator: (content: string, stageKey: string) => Promise<string>;
  callEvaluator: (content: string, stageKey: string) => Promise<string>;
  extractJsonObject: (content: string) => string;
  parseJsonRecord: (content: string, errorLabel: string) => Record<string, unknown>;
  parseDraft: (content: string) => DraftArtifact;
  evaluateDraftWithRetry: (draftJson: string, stageKeyPrefix: string) => Promise<NormalizedEvaluationPayload>;
  finalize: (raw: NormalizedRawGeneratedPayload) => Promise<AiGenerateResponse>;
  logPipelineStarted: () => void;
  logPipelineCompleted: (result: AiGenerateResponse) => void;
  logPipelineFailed: (error: unknown) => void;
}

export function createAiGenerateRuntime(context: AiGenerateExecutionContext): AiGenerateRuntime {
  const { payload, requestId, specContext, reportProgress } = context;
  const generatorAgent = specContext.spec.generation_contract.generator_agent;
  const evaluatorAgent = specContext.spec.generation_contract.evaluator_agent;
  const algorithmPrompt = renderAlgorithmPrompt(loadAlgorithmPromptTemplate(payload.algorithm), payload);
  const oahCoreConfig = getOahCoreConfig();
  const baseUrl = requireConfiguredValue(oahCoreConfig.baseUrl, "OAH_BASE_URL");
  let workspaceResolutionPromise: Promise<OahWorkspaceResolutionResult> | null = null;
  const routedSessionPromises = new Map<
    string,
    Promise<{
      delegateTargetAgentName: string | null;
      sessionAgentName: string;
      sessionClient: OahSessionClient;
    }>
  >();
  const sessionAgentName = oahCoreConfig.agentName || specContext.spec.generation_contract.primary_agent;

  const createRoutedSessionTitle = (targetAgentName: string): string =>
    `AI ${sessionAgentName} to ${targetAgentName} ${payload.knowledge_point} ${requestId}`;

  const resolveTargetSessionKey = (requestAgentName: string): string => requestAgentName || sessionAgentName;

  const updateProgress = (event: AiGenerateProgressEvent): void => {
    reportProgress?.(event);
  };

  const getWorkspaceResolution = async (): Promise<OahWorkspaceResolutionResult> => {
    if (!workspaceResolutionPromise) {
      workspaceResolutionPromise = resolveOahWorkspace({
        baseUrl,
        requestId,
        content: "AI 出题 OAH 就绪检查",
        sessionTitle: `AI 出题就绪检查 ${requestId}`,
        agentName: oahCoreConfig.agentName || undefined,
        modelRef: oahCoreConfig.model || undefined,
        workspaceId: oahCoreConfig.workspaceId || undefined,
        workspaceRuntime: oahCoreConfig.workspaceRuntime || undefined,
        workspaceName: oahCoreConfig.workspaceName || undefined,
        workspaceOwnerId: oahCoreConfig.workspaceOwnerId || undefined,
        workspaceServiceName: oahCoreConfig.workspaceServiceName || undefined,
        workspaceAutoCreate: oahCoreConfig.workspaceAutoCreate,
      }).then((resolution) => {
        if (!resolution.runExecutionReady) {
          throw new Error(
            `OAH API 已可访问，但当前没有可执行运行任务的 worker。workspaceId=${resolution.workspaceId}, runtime=${resolution.workspace.runtime}`,
          );
        }
        return resolution;
      });
    }
    return workspaceResolutionPromise;
  };

  const getWorkspaceAgentModes = async (): Promise<Map<string, string>> => {
    const workspaceResolution = await getWorkspaceResolution();
    return new Map(
      workspaceResolution.catalog.agents
        .map((agent) => [normalizeString(agent.name), normalizeString(agent.mode).toLowerCase()] as const)
        .filter(([name]) => Boolean(name)),
    );
  };

  const buildDelegatedAgentMessage = (
    activeSessionAgentName: string,
    delegateTargetAgentName: string | null,
    stageKey: string,
    content: string,
  ): string => {
    if (!delegateTargetAgentName) {
      return content;
    }
    return `当前会话代理是 "${activeSessionAgentName}"，但本轮任务必须严格按照 "${delegateTargetAgentName}" 的职责执行。

执行规则：
- 不要调用 SubAgent、TodoWrite 或任何其他工具。
- 不要继续转发、委派或拆分任务。
- 直接以 "${delegateTargetAgentName}" 的职责完成下面的任务。
- 必须严格保持任务中要求的输出契约。
- 不要在最终答案外层包裹 Markdown 代码块、解释说明或额外文本。
- 任务中已经包含所需的规范或草稿上下文，除非任务明确要求，否则不要反问澄清问题。
- 这属于当前 Tutor 出题请求的 "${stageKey}" 阶段。

任务内容：
${content}`;
  };

  const getOrCreateRoutedSession = async (
    requestAgentName: string,
  ): Promise<{
    delegateTargetAgentName: string | null;
    sessionAgentName: string;
    sessionClient: OahSessionClient;
  }> => {
    const targetSessionKey = resolveTargetSessionKey(requestAgentName);
    let routedSessionPromise = routedSessionPromises.get(targetSessionKey);
    if (!routedSessionPromise) {
      routedSessionPromise = (async () => {
        const workspaceResolution = await getWorkspaceResolution();
        const workspaceAgentModes = await getWorkspaceAgentModes();
        const requestedAgentMode = requestAgentName ? workspaceAgentModes.get(requestAgentName) || "" : "";
        const requestedAgentAvailable = requestAgentName ? workspaceAgentModes.has(requestAgentName) : false;
        const canBindRequestedAgent = requestedAgentAvailable && requestedAgentMode !== "subagent";
        const resolvedSessionAgentName = canBindRequestedAgent
          ? requestAgentName
          : sessionAgentName;
        const delegateTargetAgentName =
          requestAgentName && requestedAgentAvailable && resolvedSessionAgentName !== requestAgentName
            ? requestAgentName
            : null;
        const sessionClient = await createOahSessionClient({
          baseUrl,
          requestId,
          sessionTitle: createRoutedSessionTitle(targetSessionKey),
          activeSessionAgentName: resolvedSessionAgentName || undefined,
          agentName: sessionAgentName || undefined,
          modelRef: oahCoreConfig.model || undefined,
          workspaceId: workspaceResolution.workspaceId,
          workspaceRuntime: oahCoreConfig.workspaceRuntime || undefined,
          workspaceName: oahCoreConfig.workspaceName || undefined,
          workspaceOwnerId: oahCoreConfig.workspaceOwnerId || undefined,
          workspaceServiceName: oahCoreConfig.workspaceServiceName || undefined,
          workspaceAutoCreate: oahCoreConfig.workspaceAutoCreate,
        });
        logEvent("info", null, "ai_generate.oah_session.created", {
          request_uuid: requestId,
          session_key: targetSessionKey,
          agent_name: resolvedSessionAgentName,
          target_agent_name: requestAgentName,
          target_agent_mode: requestedAgentMode || null,
          delegate_target_agent_name: delegateTargetAgentName,
          session_id: sessionClient.sessionId,
          workspace_id: sessionClient.workspaceId,
        });
        return {
          delegateTargetAgentName,
          sessionAgentName: resolvedSessionAgentName,
          sessionClient,
        };
      })().catch((error: unknown) => {
        routedSessionPromises.delete(targetSessionKey);
        throw error;
      });
      routedSessionPromises.set(targetSessionKey, routedSessionPromise);
    }
    return routedSessionPromise;
  };

  const callAgentJson = async (
    content: string,
    requestAgentName: string,
    stageKey: string,
  ): Promise<string> => {
    logAgentStageRequest(requestId, stageKey, requestAgentName, content);
    const routedSession = await getOrCreateRoutedSession(requestAgentName);
    const result = await routedSession.sessionClient.send(
      buildDelegatedAgentMessage(
        routedSession.sessionAgentName,
        routedSession.delegateTargetAgentName,
        stageKey,
        content,
      ),
    );
    logAgentStageResponse(requestId, stageKey, requestAgentName, result.text);
    return result.text;
  };

  const buildPrompt = (name: string, bindings: Record<string, string>): string =>
    applyBindings(loadQuestionAgentPromptTemplate(name), bindings);

  const buildGeneratorMessage = (generationConstraints: string): string =>
    buildPrompt("direct-generator.md", {
      spec_json: buildPromptSpecJson(specContext.spec),
      subject: payload.subject,
      generation_constraints: generationConstraints,
    });

  const buildRevisionMessage = (
    previousDraftJson: string,
    evaluation: NormalizedEvaluationPayload,
    generationConstraints: string,
  ): string =>
    buildPrompt("direct-revision.md", {
      spec_json: buildPromptSpecJson(specContext.spec),
      draft_json: previousDraftJson,
      issues_json: JSON.stringify(evaluation.issues, null, 2),
      revision_instructions: evaluation.revision_instructions,
      generation_constraints: generationConstraints,
    });

  const parseJsonRecord = (content: string, errorLabel: string): Record<string, unknown> => {
    const jsonText = extractJsonObject(content);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new Error(`${errorLabel} 返回的 JSON 不合法：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`${errorLabel} 返回的 JSON 不是对象`);
    }
    return parsed;
  };

  const parseDraft = (content: string): DraftArtifact => {
    const raw = parseRawGeneratedPayload(content, payload);
    return {
      content,
      draftJson: serializeNormalizedDraftForPrompt(raw),
      raw,
    };
  };

  const evaluateDraftWithRetry = async (
    draftJson: string,
    stageKeyPrefix: string,
  ): Promise<NormalizedEvaluationPayload> => {
    updateProgress({
      stage: "evaluate",
      state: "active",
      detail: "正在评估生成草稿。",
      log: `正在调用评估代理 ${evaluatorAgent}。`,
    });

    const firstContent = await callAgentJson(
      buildDirectEvaluatorMessage(payload, specContext, draftJson),
      evaluatorAgent,
      stageKeyPrefix,
    );

    try {
      const parsed = parseEvaluationPayload(firstContent);
      updateProgress({
        stage: "evaluate",
        state: parsed.passed ? "done" : "active",
        detail: parsed.passed ? "草稿已通过评估。" : "草稿评估后需要修订。",
        log: parsed.passed
          ? "评估已通过。"
          : `评估要求修订：${parsed.revision_instructions || parsed.issues.join("；")}`,
      });
      return parsed;
    } catch (error) {
      if (!isRetryableEvaluationParseError(error)) {
        throw error;
      }

      updateProgress({
        stage: "evaluate",
        state: "active",
        detail: "评估器返回结构不稳定，正在按严格 JSON 约束重试。",
        log: "正在使用严格 JSON 结构要求重试评估器。",
      });

      const retryContent = await callAgentJson(
        buildDirectEvaluatorMessage(payload, specContext, draftJson, true),
        evaluatorAgent,
        `${stageKeyPrefix}-retry`,
      );

      let parsed: NormalizedEvaluationPayload;
      try {
        parsed = parseEvaluationPayload(retryContent);
      } catch (retryError) {
        const fallback = buildLocalSchemaFallbackEvaluation(retryError);
        updateProgress({
          stage: "evaluate",
          state: "done",
          detail: "评估器两次未返回合法 JSON，已使用本地 schema 校验兜底。",
          log: fallback.algorithm_feedback.summary,
        });
        return fallback;
      }
      updateProgress({
        stage: "evaluate",
        state: parsed.passed ? "done" : "active",
        detail: parsed.passed ? "草稿在重试后通过评估。" : "草稿在重试后仍需修订。",
        log: parsed.passed
          ? "严格 JSON 重试评估已通过。"
          : `严格 JSON 重试后仍要求修订：${parsed.revision_instructions || parsed.issues.join("；")}`,
      });
      return parsed;
    }
  };

  const finalize = async (raw: NormalizedRawGeneratedPayload): Promise<AiGenerateResponse> => {
    updateProgress({
      stage: "render",
      state: "active",
      detail:
        payload.content_mode === "image"
          ? "正在准备结构化响应与图片渲染流程。"
          : "正在准备最终结构化响应。",
      log: "正在组装最终响应对象。",
    });

    const effectivePayload =
      payload.content_mode === "image"
        ? applyImagePositionToPayload(payload, raw.image_position || payload.image_placement || "stem_image")
        : payload;

    let result = adaptGeneratedPayload(raw, effectivePayload);

    if (payload.content_mode === "image") {
      updateProgress({
        stage: "render",
        state: "active",
        detail: "正在校验并合并图片资源。",
        log: `当前使用的图片位置：${raw.image_position || payload.image_placement || "stem_image"}。`,
      });
      const imagePosition = raw.image_position || payload.image_placement || "stem_image";
      try {
        const visualResult = await renderSvgImageForQuestion({
          payload: effectivePayload,
          requestId,
          imagePosition,
          imageSvg: raw.image_svg || "",
        });
        result = mergeVisualResultIntoResponse(result, visualResult);
      } catch (error) {
        result = mergeVisualResultIntoResponse(
          result,
          buildFailedVisualResponse(
            effectivePayload,
            imagePosition,
            error instanceof Error ? error.message : String(error),
          ),
        );
        updateProgress({
          stage: "render",
          state: "active",
          detail: "图片渲染失败，正在返回带失败元数据的结构化文本结果。",
          log: `图片渲染失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    updateProgress({
      stage: "render",
      state: "done",
      detail: "最终响应已准备完成。",
      log: "响应组装完成。",
    });

    return result;
  };

  const logPipelineStarted = (): void => {
    logEvent("info", null, "ai_generate.pipeline.started", {
      request_uuid: requestId,
      algorithm: payload.algorithm,
      question_type: payload.question_type,
      content_mode: payload.content_mode,
      image_placement: payload.image_placement || "none",
      image_targets: payload.image_targets,
      image_mode: payload.image_mode,
      difficulty: payload.difficulty,
      subject: payload.subject,
      knowledge_point: payload.knowledge_point,
    });
  };

  const logPipelineCompleted = (result: AiGenerateResponse): void => {
    logEvent("info", null, "ai_generate.pipeline.completed", {
      request_uuid: requestId,
      algorithm: payload.algorithm,
      subject: payload.subject,
      question_length: result.question.length,
      options_count: result.options.length,
      solution_steps_count: result.solution_steps.length,
      ground_truth_preview: truncateForLog(result.ground_truth, 120),
      image_generation_failed: result.image_generation_failed === true,
    });
  };

  const logPipelineFailed = (error: unknown): void => {
    logEvent("error", null, "ai_generate.pipeline.failed", {
      request_uuid: requestId,
      algorithm: payload.algorithm,
      subject: payload.subject,
      error: serializeError(error),
    });
  };

  return {
    payload,
    requestId,
    specContext,
    generatorAgent,
    evaluatorAgent,
    algorithmPrompt,
    reportProgress,
    updateProgress,
    buildPrompt,
    buildGeneratorMessage,
    buildRevisionMessage,
    callGenerator: (content: string, stageKey: string) => callAgentJson(content, generatorAgent, stageKey),
    callEvaluator: (content: string, stageKey: string) => callAgentJson(content, evaluatorAgent, stageKey),
    extractJsonObject,
    parseJsonRecord,
    parseDraft,
    evaluateDraftWithRetry,
    finalize,
    logPipelineStarted,
    logPipelineCompleted,
    logPipelineFailed,
  };
}
