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
import type { QuestionSpecNormalizeResponse } from "../../types/question-agent";
import {
  buildFailedVisualResponse,
  mergeVisualResultIntoResponse,
  normalizeImagePosition,
  placementToImageTargets,
  renderManimImageForQuestion,
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

function renderAlgorithmPrompt(template: string, payload: AiGenPayload): string {
  const renderedTemplate = applyBindings(template, {
    knowledge_id: payload.knowledge_point,
    difficulty_target: payload.difficulty,
  });

  const questionTypeInstruction =
    payload.question_type === "multiple_choice"
      ? "- 题型必须是选择题。请把 A/B/C/D 四个选项直接写在 question 字段内，并按独立行输出。ground_truth 必须是单个选项字母。"
      : payload.question_type === "true_false"
        ? "- 题型必须是判断题。不要生成 A/B/C/D 选项。ground_truth 必须是“正确”或“错误”。"
        : "- 题型必须是简答题。不要生成 A/B/C/D 选项。ground_truth 应写最终答案或关键答案点。";

  const outputSchemaInstruction =
    payload.content_mode === "image"
      ? `- 输出字段必须严格为：question、solution_steps、ground_truth、image_position、image_code、render_notes。
- image_position 必须是 stem_image、explanation_image、option_image 之一。优先使用已选位置：${payload.image_placement || "stem_image"}。
- image_code 必须是能渲染本题图像的完整代码。
- 在当前渲染器中，image_code 必须是一份完整的 Python Manim Community 文件。
- image_code 必须以 "from manim import *" 开头，并定义 "class QuestionScene(Scene):"。
- 不要使用 MathTex、Tex、SingleStringMathTex、BulletedList、Paragraph、MarkupText 或任何依赖 LaTeX 的 mobject。
- 请优先使用当前渲染器稳定支持的基础图元，例如 Scene、VGroup、Line、Arrow、Circle、Dot、Polygon、Rectangle、Square、Arc、Angle、Brace、Axes、NumberPlane、DecimalNumber、Integer、Text、DashedLine。
- Manim 场景内的文字标签尽量使用简短 ASCII Text，避免 LaTeX 语法、上下标和 "$...$"。`
      : "- 输出字段必须严格为：question、solution_steps、ground_truth。";

  const imageInstruction =
    payload.content_mode === "image"
      ? `- 这是一道依赖配图作答的题目。当前选定图片位置为 ${payload.image_placement || "stem_image"}，目标区域为 ${payload.image_targets.join(", ")}。
- 你必须在一次响应中同时给出完整的题目文本字段，以及 image_position 与 image_code。
- 当图片模式为必需时，题干必须明确依赖图形信息，不能脱离图片独立作答。
- 图片中必须包含本题推理所依赖的数值、标签、关系、几何结构、图表或示意信息。`
      : "- 这是一道纯文本题。不要依赖任何图片、图表、示意图或外部视觉信息。";

  return `${renderedTemplate}

附加约束：
- 只返回一个合法 JSON 对象。不要输出 Markdown 代码块，也不要在 JSON 之外补充说明文字。
- 知识点必须始终聚焦：${payload.knowledge_point}
- 难度必须控制在：${payload.difficulty} / 6
- 题型必须为：${payload.question_type}
${outputSchemaInstruction}
${questionTypeInstruction}
${imageInstruction}`;
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

function extractMultipleChoiceParts(question: string): { question: string; options: string[] } {
  const lines = question.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const optionPattern = /^[A-D]\s*[.、:：)]/;
  const options = lines.filter((line) => optionPattern.test(line));
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
  return normalized || "正确";
}

function buildRequestMeta(payload: AiGenPayload): AiGenerateRequestMeta {
  return {
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
      options: options.map((option) => {
        const optionMatch = option.match(/^([A-D])\s*[.、:：)]/);
        const optionKey = optionMatch?.[1] as OptionKey | undefined;
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
          provider: "oah_manim",
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

function normalizeImageQuestionFields(
  rawPayload: RawGeneratedPayload,
  payload: AiGenPayload,
): Partial<NormalizedRawGeneratedPayload> {
  if (payload.content_mode !== "image") {
    return {};
  }

  const imagePosition = normalizeImagePosition(normalizeString(rawPayload.image_position), payload.image_targets);
  const imageCode = validateNonEmptyString(rawPayload.image_code, "image_code");
  return {
    image_position: imagePosition || payload.image_placement || "stem_image",
    image_code: imageCode,
    scene_name: normalizeString(rawPayload.scene_name) || "QuestionScene",
    render_notes: normalizeString(rawPayload.render_notes),
  };
}

function parseRawGeneratedPayload(content: string, payload: AiGenPayload): NormalizedRawGeneratedPayload {
  const rawPayload = parseGeneratedPayloadObject(content);
  return {
    question: validateNonEmptyString(rawPayload.question, "question"),
    solution_steps: normalizeSolutionSteps(rawPayload.solution_steps),
    ground_truth: validateNonEmptyString(rawPayload.ground_truth, "ground_truth"),
    ...normalizeImageQuestionFields(rawPayload, payload),
  };
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
  const passed = raw.passed;
  const issues = normalizeStringArray(raw.issues);
  const revisionInstructions = normalizeString(raw.revision_instructions);
  if (!passed && !revisionInstructions && issues.length === 0) {
    throw new Error("AI 评估未通过，但没有返回可执行的修订建议");
  }
  return {
    passed,
    issues,
    revision_instructions: revisionInstructions || issues.join("；"),
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
          "渲染是否安全，image_code 是否为完整且可执行的 Manim 文件。",
        ]
      : [
          "字段结构是否合法，必填字段是否齐全。",
          "是否准确对齐指定知识点，并符合目标难度。",
          "如果是选择题，选项格式与 ground_truth 是否合法。",
          "答案是否正确，教学质量是否达标。",
        ];

  return applyBindings(loadQuestionAgentPromptTemplate("direct-evaluator.md"), {
    spec_json: JSON.stringify(specContext.spec, null, 2),
    draft_json: generatedDraftJson,
    checklist: checks.map((item, index) => `${index + 1}. ${item}`).join("\n"),
  }).concat(
    strictJsonOnly
      ? '\n\n重试要求：\n- 你上一轮的回复没有满足评估器约定的 JSON 结构。\n- 这一次只能返回 {"passed":true|false,"issues":["..."],"revision_instructions":"..."}。\n- 不要返回题目草稿 JSON。\n- 除 passed、issues、revision_instructions 之外，不要返回任何其他字段。\n'
      : "",
  );
}

function adaptGeneratedPayload(raw: NormalizedRawGeneratedPayload, payload: AiGenPayload): AiGenerateResponse {
  const requestMeta = buildRequestMeta(payload);
  if (payload.question_type === "multiple_choice") {
    const multipleChoice = extractMultipleChoiceParts(raw.question);
    if (!multipleChoice.question) {
      throw new Error("AI 出题结果中的选择题题干为空");
    }
    if (multipleChoice.options.length !== 4) {
      throw new Error(
        `AI 出题结果中的选择题选项数量不合法：${multipleChoice.options.length}`,
      );
    }
    const groundTruth = normalizeMultipleChoiceGroundTruth(raw.ground_truth);
    return {
      question: multipleChoice.question,
      options: multipleChoice.options,
      solution_steps: raw.solution_steps,
      ground_truth: groundTruth,
      ...(raw.image_position ? { image_position: raw.image_position } : {}),
      ...(raw.image_code ? { image_code: raw.image_code } : {}),
      meta: requestMeta,
      request: requestMeta,
      ...buildStructuredResponse(multipleChoice.question, multipleChoice.options, raw.solution_steps, payload),
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
    return `请把这个任务路由给子代理 "${delegateTargetAgentName}"，并且只返回该子代理的最终答案。

路由规则：
- 如果指定子代理可用，不要由编排代理自己作答。
- 当前会话代理是 "${activeSessionAgentName}"，本次请求的执行代理是 "${delegateTargetAgentName}"。
- 请将本轮会话严格限定在目标子代理角色内，不要混用其他子代理的推理方式或输出格式。
- 必须严格保持任务中要求的输出契约。
- 不要在委派结果外层再包裹 Markdown 代码块、解释说明或额外文本。
- 任务中已经包含所需的规范或草稿上下文，除非任务明确要求，否则不要反问澄清问题。
- 这属于当前 Tutor 出题请求的 "${stageKey}" 阶段。

委派任务：
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
      spec_json: JSON.stringify(specContext.spec, null, 2),
      generation_constraints: generationConstraints,
    });

  const buildRevisionMessage = (
    previousDraftJson: string,
    evaluation: NormalizedEvaluationPayload,
    generationConstraints: string,
  ): string =>
    buildPrompt("direct-revision.md", {
      spec_json: JSON.stringify(specContext.spec, null, 2),
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

  const parseDraft = (content: string): DraftArtifact => ({
    content,
    draftJson: extractJsonObject(content),
    raw: parseRawGeneratedPayload(content, payload),
  });

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
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(INVALID_EVALUATION_PASSED_FLAG_ERROR)) {
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

      const parsed = parseEvaluationPayload(retryContent);
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
        detail: "正在渲染或合并图片资源。",
        log: `当前使用的图片位置：${raw.image_position || payload.image_placement || "stem_image"}。`,
      });
      const imagePosition = raw.image_position || payload.image_placement || "stem_image";
      try {
        const visualResult = await renderManimImageForQuestion({
          payload: effectivePayload,
          requestId,
          imagePosition,
          sceneName: raw.scene_name || "QuestionScene",
          imageCode: raw.image_code || "",
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
      knowledge_point: payload.knowledge_point,
    });
  };

  const logPipelineCompleted = (result: AiGenerateResponse): void => {
    logEvent("info", null, "ai_generate.pipeline.completed", {
      request_uuid: requestId,
      algorithm: payload.algorithm,
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
