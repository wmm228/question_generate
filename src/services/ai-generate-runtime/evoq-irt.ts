import { createHash, randomUUID } from "crypto";

import { callOahSessionText } from "../oah-client";
import { getOahCoreConfig } from "../oah-config";
import type { AiGenerateRuntime } from "./runtime";
import type { EvoqCandidateReview, NormalizedRawGeneratedPayload } from "./types";

export interface EvoqIrtVirtualStudent {
  name: string;
  original_model: string;
  theta: number;
  provider: "oah";
  api_type: "oah";
  model: string;
  prompt_type: "cot" | "ps" | "default" | "hint";
}

export interface EvoqIrtVirtualStudentResponse {
  model: string;
  original_model: string;
  runtime_model: string;
  prompt_type: string;
  theta: number;
  probability_correct: number;
  response_source: "deterministic_feature_model" | "live_api" | "live_api_fallback";
  threshold?: number;
  raw_response?: string;
  extracted_answer?: string;
  is_correct: boolean;
  fallback_reason?: string;
}

export interface EvoqIrtAggregate {
  estimated_b: number | null;
  difficulty_irt: number;
  soft_difficulty_irt: number;
}

export interface EvoqObjectiveDifficultyEvaluation {
  method: "irt";
  implementation_reference: string;
  formula: "P(correct)=sigmoid(theta-b)";
  target_difficulty_level: number;
  target_difficulty_irt: number;
  item_difficulty_b: number;
  algorithm_difficulty_irt: number;
  soft_difficulty_irt: number;
  estimated_b: number | null;
  difficulty_strict_match_irt: 0 | 1;
  difficulty_soft_match_irt: 0 | 1;
  is_diff_match: boolean;
  difficulty_cmp: "same" | "easier" | "harder";
  passrate_irt_strict: 0 | 1;
  passrate_irt_soft: 0 | 1;
  virtual_student_count: number;
  mode: "deterministic" | "live";
  responses: EvoqIrtVirtualStudentResponse[];
  external_difficulty_eval: string;
}

const NVIDIA_DEEPSEEK_V4_FLASH = "platform/deepseek-ai_deepseek-v4-flash";
const NVIDIA_QWEN35_397B = "platform/qwen_qwen3.5-397b-a17b";
const NVIDIA_QWEN3_NEXT_80B = "platform/qwen_qwen3-next-80b-a3b-instruct";
const NVIDIA_MINISTRAL_14B = "platform/mistralai_ministral-14b-instruct-2512";

export const EVOQ_IRT_VIRTUAL_STUDENTS: EvoqIrtVirtualStudent[] = [
  { name: "deepseek-v4-flash__cot", original_model: "deepseek-v3__cot", theta: 2.1562225111528597, provider: "oah", api_type: "oah", model: NVIDIA_DEEPSEEK_V4_FLASH, prompt_type: "cot" },
  { name: "ministral-14b-instruct-2512-speed128k__ps", original_model: "ERNIE-Speed-128K__ps", theta: -0.8788206709310187, provider: "oah", api_type: "oah", model: NVIDIA_MINISTRAL_14B, prompt_type: "ps" },
  { name: "qwen3.5-397b-a17b-gpt5__ps", original_model: "gpt-5__ps", theta: 4.68767960216943, provider: "oah", api_type: "oah", model: NVIDIA_QWEN35_397B, prompt_type: "ps" },
  { name: "qwen3.5-397b-a17b-gpt5__default", original_model: "gpt-5__default", theta: 3.359926076692211, provider: "oah", api_type: "oah", model: NVIDIA_QWEN35_397B, prompt_type: "default" },
  { name: "qwen3-next-80b-a3b-instruct-gpt5-mini__ps", original_model: "gpt-5-mini__ps", theta: 4.219574946806543, provider: "oah", api_type: "oah", model: NVIDIA_QWEN3_NEXT_80B, prompt_type: "ps" },
  { name: "deepseek-v4-flash__default", original_model: "deepseek-v3__default", theta: 4.054563065217586, provider: "oah", api_type: "oah", model: NVIDIA_DEEPSEEK_V4_FLASH, prompt_type: "default" },
  { name: "ministral-14b-instruct-2512-spark-lite__hint", original_model: "Spark Lite__hint", theta: -1.4261649727527093, provider: "oah", api_type: "oah", model: NVIDIA_MINISTRAL_14B, prompt_type: "hint" },
  { name: "qwen3-next-80b-a3b-instruct-gpt4o__default", original_model: "gpt-4o-2024-11-20__default", theta: 1.1450464509689402, provider: "oah", api_type: "oah", model: NVIDIA_QWEN3_NEXT_80B, prompt_type: "default" },
  { name: "ministral-14b-instruct-2512-speed8k__default", original_model: "ERNIE-Speed-8K__default", theta: -0.6205140805469449, provider: "oah", api_type: "oah", model: NVIDIA_MINISTRAL_14B, prompt_type: "default" },
  { name: "ministral-14b-instruct-2512-speed8k__ps", original_model: "ERNIE-Speed-8K__ps", theta: -0.7486110023088791, provider: "oah", api_type: "oah", model: NVIDIA_MINISTRAL_14B, prompt_type: "ps" },
  { name: "deepseek-v4-flash__ps", original_model: "deepseek-v3__ps", theta: 2.3380303118048436, provider: "oah", api_type: "oah", model: NVIDIA_DEEPSEEK_V4_FLASH, prompt_type: "ps" },
  { name: "ministral-14b-instruct-2512-tiny8k__ps", original_model: "ERNIE-Tiny-8K__ps", theta: -1.733752083647532, provider: "oah", api_type: "oah", model: NVIDIA_MINISTRAL_14B, prompt_type: "ps" },
];

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function deterministicUnit(seed: string): number {
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0) / 0xffffffff;
}

export function mapTutorDifficultyToEvoqDifficulty(difficulty: string | number): number {
  const parsed = typeof difficulty === "number" ? difficulty : Number.parseInt(normalizeString(difficulty), 10);
  if ([10, 30, 50, 60, 70, 80].includes(parsed)) {
    return parsed;
  }
  if ([20, 40].includes(parsed)) {
    return 30;
  }
  const mapping: Record<number, number> = {
    1: 10,
    2: 30,
    3: 50,
    4: 60,
    5: 70,
    6: 80,
  };
  return mapping[parsed] ?? 50;
}

function targetDifficultyToRepresentativeB(targetDifficulty: number): number {
  switch (targetDifficulty) {
    case 10:
      return -1.6;
    case 30:
      return -0.6;
    case 50:
      return 0.2;
    case 60:
      return 0.9;
    case 70:
      return 1.55;
    case 80:
      return 2.35;
    default:
      return 0.2;
  }
}

export function mapEvoqDifficultyFromB(estimatedB: number): number {
  if (estimatedB < -1.12) return 10;
  if (estimatedB < -0.19) return 30;
  if (estimatedB < 0.60) return 50;
  if (estimatedB < 1.20) return 60;
  if (estimatedB < 2.00) return 70;
  return 80;
}

export function estimateRaschDifficultyB(responses: Array<{ theta: number; is_correct: boolean }>): EvoqIrtAggregate {
  if (responses.length === 0) {
    return { estimated_b: null, difficulty_irt: 50, soft_difficulty_irt: 50 };
  }

  const correctCount = responses.reduce((sum, response) => sum + (response.is_correct ? 1 : 0), 0);
  if (correctCount === responses.length) {
    return { estimated_b: null, difficulty_irt: 10, soft_difficulty_irt: 10 };
  }
  if (correctCount === 0) {
    return { estimated_b: null, difficulty_irt: 80, soft_difficulty_irt: 80 };
  }

  let low = -8;
  let high = 8;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const expectedCorrect = responses.reduce((sum, response) => sum + sigmoid(response.theta - mid), 0);
    if (expectedCorrect > correctCount) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const estimatedB = (low + high) / 2;
  const clipped = clamp(estimatedB, -3, 3);
  const softDifficulty = 10 + ((clipped + 3) / 6) * 70;
  return {
    estimated_b: Number(estimatedB.toFixed(3)),
    difficulty_irt: mapEvoqDifficultyFromB(estimatedB),
    soft_difficulty_irt: Number(softDifficulty.toFixed(1)),
  };
}

function checkDifficultyMatch(predicted: number, target: number): { strict: 0 | 1; soft: 0 | 1 } {
  if (predicted === target) {
    return { strict: 1, soft: 1 };
  }
  if (target === 10 && (predicted === 10 || predicted === 30)) {
    return { strict: 0, soft: 1 };
  }
  if (target === 80 && (predicted === 70 || predicted === 80)) {
    return { strict: 0, soft: 1 };
  }
  if (Math.abs(predicted - target) <= 10) {
    return { strict: 0, soft: 1 };
  }
  return { strict: 0, soft: 0 };
}

function countMathSignals(text: string): number {
  const matches = text.match(/[=<>+\-*/^]|函数|方程|不等式|图像|斜率|截距|概率|导数|向量|几何|面积|体积/g);
  return matches ? matches.length : 0;
}

function estimateCandidateDifficultyB(
  runtime: AiGenerateRuntime,
  draft: NormalizedRawGeneratedPayload,
  targetDifficultyIrt: number,
): number {
  const question = normalizeString(draft.question);
  const solutionText = draft.solution_steps.join("\n");
  const optionText = (draft.options || []).join("\n");
  const combined = `${question}\n${optionText}\n${solutionText}`;

  const base = targetDifficultyToRepresentativeB(targetDifficultyIrt);
  const questionLength = Array.from(question).length;
  const solutionSteps = Math.max(1, draft.solution_steps.length);
  const avgOptionLength = draft.options && draft.options.length > 0
    ? draft.options.reduce((sum, option) => sum + Array.from(option).length, 0) / draft.options.length
    : 0;
  const mathSignals = countMathSignals(combined);

  const lengthAdjustment = clamp((questionLength - 80) / 220, -0.35, 0.45);
  const stepAdjustment = clamp((solutionSteps - 2) * 0.16, -0.18, 0.5);
  const optionAdjustment = clamp((avgOptionLength - 12) / 80, -0.15, 0.25);
  const signalAdjustment = clamp((mathSignals - 6) * 0.035, -0.2, 0.3);
  const imageAdjustment = runtime.payload.content_mode === "image" ? 0.15 : 0;

  return Number(clamp(
    base + lengthAdjustment + stepAdjustment + optionAdjustment + signalAdjustment + imageAdjustment,
    -3.5,
    3.5,
  ).toFixed(3));
}

function normalizeCorrectAnswer(draft: NormalizedRawGeneratedPayload): string {
  return normalizeString(draft.ground_truth).toUpperCase();
}

function extractChoiceAnswer(text: string): string {
  const normalized = normalizeString(text).toUpperCase();
  const strict = normalized.match(/(?:答案|ANSWER)\s*[:：]?\s*([A-D])/i);
  if (strict?.[1]) {
    return strict[1].toUpperCase();
  }
  const standalone = normalized.match(/\b([A-D])\b/);
  return standalone?.[1]?.toUpperCase() || "";
}

function buildWrongAnswer(draft: NormalizedRawGeneratedPayload, seed: string): string {
  const correctAnswer = normalizeCorrectAnswer(draft);
  if (draft.options && draft.options.length > 0) {
    const labels = ["A", "B", "C", "D"].filter((label) => label !== correctAnswer);
    return labels[Math.floor(deterministicUnit(seed) * labels.length) % labels.length] || "A";
  }
  if (correctAnswer === "正确") return "错误";
  if (correctAnswer === "错误") return "正确";
  return correctAnswer ? `${correctAnswer}（常见错误答案）` : "错误";
}

function deterministicResponse(
  runtime: AiGenerateRuntime,
  draft: NormalizedRawGeneratedPayload,
  model: EvoqIrtVirtualStudent,
  itemDifficultyB: number,
  fallbackReason = "",
  forcedCorrect?: boolean,
): EvoqIrtVirtualStudentResponse {
  const probabilityCorrect = clamp(sigmoid(model.theta - itemDifficultyB), 0, 1);
  const threshold = deterministicUnit(`${runtime.requestId}:${draft.question}:${model.name}:agent-evoq-irt`);
  const isCorrect = typeof forcedCorrect === "boolean" ? forcedCorrect : probabilityCorrect >= threshold;
  return {
    model: model.name,
    original_model: model.original_model,
    runtime_model: model.model,
    prompt_type: model.prompt_type,
    theta: Number(model.theta.toFixed(3)),
    probability_correct: Number(probabilityCorrect.toFixed(3)),
    threshold: typeof forcedCorrect === "boolean" ? undefined : Number(threshold.toFixed(3)),
    response_source: fallbackReason ? "live_api_fallback" : "deterministic_feature_model",
    fallback_reason: fallbackReason || undefined,
    is_correct: isCorrect,
    extracted_answer: isCorrect ? normalizeCorrectAnswer(draft) : buildWrongAnswer(draft, `${runtime.requestId}:${model.name}`),
  };
}

function deterministicResponses(
  runtime: AiGenerateRuntime,
  draft: NormalizedRawGeneratedPayload,
  itemDifficultyB: number,
): EvoqIrtVirtualStudentResponse[] {
  const probabilities = EVOQ_IRT_VIRTUAL_STUDENTS.map((model) => ({
    model,
    probabilityCorrect: clamp(sigmoid(model.theta - itemDifficultyB), 0, 1),
  }));
  const expectedCorrect = probabilities.reduce((sum, entry) => sum + entry.probabilityCorrect, 0);
  const correctCount = clamp(Math.round(expectedCorrect), 0, probabilities.length);
  const correctNames = new Set(
    [...probabilities]
      .sort((left, right) => {
        if (right.probabilityCorrect !== left.probabilityCorrect) {
          return right.probabilityCorrect - left.probabilityCorrect;
        }
        return left.model.name.localeCompare(right.model.name);
      })
      .slice(0, correctCount)
      .map((entry) => entry.model.name),
  );
  return probabilities.map((entry) =>
    deterministicResponse(runtime, draft, entry.model, itemDifficultyB, "", correctNames.has(entry.model.name)),
  );
}

function buildVirtualStudentPrompt(model: EvoqIrtVirtualStudent, draft: NormalizedRawGeneratedPayload): string {
  const options = (draft.options || []).map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n");
  const style =
    model.prompt_type === "cot"
      ? "可以在心里分步判断，但最终只输出答案。"
      : model.prompt_type === "ps"
        ? "优先直接判断最可能选项，最终只输出答案。"
        : model.prompt_type === "hint"
          ? "把自己当作能力较弱的学生，谨慎作答，最终只输出答案。"
          : "直接作答，最终只输出答案。";
  return [
    "你现在扮演 EvoQ IRT 难度评估中的一个虚拟学生模型。",
    `虚拟学生: ${model.name}`,
    `原始 EvoQ 学生模型: ${model.original_model}`,
    `theta: ${model.theta}`,
    style,
    "不要解释，不要输出推理过程。",
    "最后一行必须严格使用格式：答案: X，其中 X 是 A/B/C/D 中的一个字母。",
    "",
    `题干: ${draft.question}`,
    options ? `选项:\n${options}` : "",
  ].filter(Boolean).join("\n");
}

async function callLiveVirtualStudent(
  runtime: AiGenerateRuntime,
  draft: NormalizedRawGeneratedPayload,
  model: EvoqIrtVirtualStudent,
  itemDifficultyB: number,
): Promise<EvoqIrtVirtualStudentResponse> {
  const config = getOahCoreConfig();
  const requestId = `evoq-irt-${randomUUID()}`;
  try {
    const text = await callOahSessionText({
      baseUrl: config.baseUrl,
      requestId,
      content: buildVirtualStudentPrompt(model, draft),
      sessionTitle: `EvoQ IRT ${model.name} ${runtime.requestId}`,
      agentName: config.agentName || "question-orchestrator",
      modelRef: model.model,
      workspaceId: config.workspaceId || undefined,
      workspaceRuntime: config.workspaceRuntime || undefined,
      workspaceName: config.workspaceName || undefined,
      workspaceOwnerId: config.workspaceOwnerId || undefined,
      workspaceServiceName: config.workspaceServiceName || undefined,
      workspaceAutoCreate: config.workspaceAutoCreate,
    });
    const extracted = extractChoiceAnswer(text);
    const correct = normalizeCorrectAnswer(draft);
    return {
      ...deterministicResponse(runtime, draft, model, itemDifficultyB),
      response_source: "live_api",
      raw_response: text,
      extracted_answer: extracted,
      is_correct: Boolean(extracted) && extracted === correct,
    };
  } catch (error) {
    return deterministicResponse(
      runtime,
      draft,
      model,
      itemDifficultyB,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function resolveEvoqIrtMode(): "deterministic" | "live" {
  const value = normalizeString(process.env.TUTOR_EVOQ_IRT_ENSEMBLE_MODE || process.env.EDUQG_IRT_ENSEMBLE_MODE).toLowerCase();
  return value === "live" ? "live" : "deterministic";
}

function shouldUseStrictMatch(runtime: AiGenerateRuntime): boolean {
  const metric = normalizeString(runtime.specContext.spec.evoq_config.fitness_diff_metric);
  return metric === "irt_strict" || metric === "rankllm_strict" || !metric;
}

function buildExternalDifficultyReport(evaluation: Omit<EvoqObjectiveDifficultyEvaluation, "external_difficulty_eval">): string {
  const liveFallbacks = evaluation.responses.filter((response) => response.response_source === "live_api_fallback").length;
  const modelRefs = uniqueStrings(EVOQ_IRT_VIRTUAL_STUDENTS.map((student) => student.model)).join(", ");
  return [
    "【EvoQ 客观难度测定结果】",
    `- 方法: IRT / Rasch 1PL，公式 P(correct)=sigmoid(theta-b)。`,
    `- theta 来源: 沿用原 EvoQ difficulty_evaluator.json 的 12 个虚拟学生 theta；底层运行模型替换为已实测可返回文本的 NVIDIA NIM/OAH modelRef：${modelRefs}。`,
    `- 目标难度: Tutor ${evaluation.target_difficulty_level}/6 -> EvoQ IRT ${evaluation.target_difficulty_irt}。`,
    `- 实测难度: IRT=${evaluation.algorithm_difficulty_irt}，soft=${evaluation.soft_difficulty_irt}，estimated_b=${evaluation.estimated_b ?? "boundary"}。`,
    `- 候选题 b 估计: ${evaluation.item_difficulty_b}。`,
    `- 严格/宽松命中: ${evaluation.difficulty_strict_match_irt}/${evaluation.difficulty_soft_match_irt}。`,
    `- fitness 主判定: ${evaluation.is_diff_match ? "命中" : "未命中"}，方向=${evaluation.difficulty_cmp}。`,
    `- 虚拟学生数量: ${evaluation.virtual_student_count}，模式=${evaluation.mode}${liveFallbacks ? `，live fallback=${liveFallbacks}` : ""}。`,
    evaluation.is_diff_match
      ? "-> 结论: 难度满足当前 EvoQ fitness_diff_metric，可继续检查可解性、答案一致性和知识点相关性。"
      : evaluation.difficulty_cmp === "harder"
        ? "-> 结论: 当前候选题客观难度偏高，mutation_instructions 必须给出降低难度的具体修改。"
        : "-> 结论: 当前候选题客观难度偏低，mutation_instructions 必须给出增加区分度和推理深度的具体修改。",
  ].join("\n");
}

export async function evaluateEvoqIrtDifficultyForDraft(
  runtime: AiGenerateRuntime,
  draft: NormalizedRawGeneratedPayload,
): Promise<EvoqObjectiveDifficultyEvaluation> {
  const targetDifficultyLevel = Number.parseInt(runtime.payload.difficulty, 10) || runtime.specContext.spec.difficulty_level;
  const targetDifficultyIrt = mapTutorDifficultyToEvoqDifficulty(targetDifficultyLevel);
  const itemDifficultyB = estimateCandidateDifficultyB(runtime, draft, targetDifficultyIrt);
  const mode = resolveEvoqIrtMode();
  const responses: EvoqIrtVirtualStudentResponse[] = [];

  if (mode === "deterministic") {
    responses.push(...deterministicResponses(runtime, draft, itemDifficultyB));
  } else {
    for (const model of EVOQ_IRT_VIRTUAL_STUDENTS) {
      responses.push(await callLiveVirtualStudent(runtime, draft, model, itemDifficultyB));
    }
  }

  const aggregate = estimateRaschDifficultyB(responses);
  const match = checkDifficultyMatch(aggregate.difficulty_irt, targetDifficultyIrt);
  const isDiffMatch = shouldUseStrictMatch(runtime) ? match.strict === 1 : match.soft === 1;
  const difficultyCmp =
    isDiffMatch
      ? "same"
      : aggregate.difficulty_irt > targetDifficultyIrt
        ? "harder"
        : "easier";

  const baseEvaluation: Omit<EvoqObjectiveDifficultyEvaluation, "external_difficulty_eval"> = {
    method: "irt",
    implementation_reference: "EvoQ/evomcq/agent/unified_evaluator.py",
    formula: "P(correct)=sigmoid(theta-b)",
    target_difficulty_level: targetDifficultyLevel,
    target_difficulty_irt: targetDifficultyIrt,
    item_difficulty_b: itemDifficultyB,
    algorithm_difficulty_irt: aggregate.difficulty_irt,
    soft_difficulty_irt: aggregate.soft_difficulty_irt,
    estimated_b: aggregate.estimated_b,
    difficulty_strict_match_irt: match.strict,
    difficulty_soft_match_irt: match.soft,
    is_diff_match: isDiffMatch,
    difficulty_cmp: difficultyCmp,
    passrate_irt_strict: match.strict,
    passrate_irt_soft: match.soft,
    virtual_student_count: responses.length,
    mode,
    responses,
  };

  return {
    ...baseEvaluation,
    external_difficulty_eval: buildExternalDifficultyReport(baseEvaluation),
  };
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeString(value)).filter(Boolean)));
}

function objectiveIssue(objective: EvoqObjectiveDifficultyEvaluation): string {
  return `EvoQ IRT 难度未命中：目标 ${objective.target_difficulty_irt}，实测 ${objective.algorithm_difficulty_irt}，方向 ${objective.difficulty_cmp}`;
}

export function applyEvoqObjectiveDifficultyToReview(
  review: EvoqCandidateReview,
  objective: EvoqObjectiveDifficultyEvaluation,
): EvoqCandidateReview {
  const objectivePassed = objective.is_diff_match;
  const difficultyPenalty = objectivePassed ? 0 : objective.difficulty_soft_match_irt ? 12 : 28;
  const cappedScore = objectivePassed ? review.score : Math.min(review.score, objective.difficulty_soft_match_irt ? 78 : 62);
  const cappedFitness = objectivePassed ? review.fitness : Math.min(review.fitness, Math.max(1, review.fitness - difficultyPenalty));
  const directionInstruction =
    objective.difficulty_cmp === "harder"
      ? "降低题目难度：减少隐含条件、缩短推理链或降低计算复杂度。"
      : objective.difficulty_cmp === "easier"
        ? "提高题目难度：增加有效干扰项、增加一步关键推理或提高概念区分度。"
        : "";

  return {
    ...review,
    passed: review.passed && objectivePassed,
    score: cappedScore,
    fitness: cappedFitness,
    issues: objectivePassed ? review.issues : uniqueStrings([...review.issues, objectiveIssue(objective)]),
    weaknesses: objectivePassed ? review.weaknesses : uniqueStrings([...review.weaknesses, objectiveIssue(objective)]),
    mutation_instructions: uniqueStrings([
      review.mutation_instructions,
      objectivePassed ? "" : directionInstruction,
    ]).join(" "),
    next_action_hint: review.next_action_hint === "accept" && !objectivePassed ? "mutate" : review.next_action_hint,
    objective_difficulty: objective,
    actual_difficulty: objective.algorithm_difficulty_irt,
    is_diff_match: objective.is_diff_match,
    algorithm_difficulty_irt: objective.algorithm_difficulty_irt,
    difficulty_strict_match_irt: objective.difficulty_strict_match_irt,
    difficulty_soft_match_irt: objective.difficulty_soft_match_irt,
    passrate_irt_strict: objective.passrate_irt_strict,
    passrate_irt_soft: objective.passrate_irt_soft,
  };
}
