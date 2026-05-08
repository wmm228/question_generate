import { randomUUID } from "crypto";

import {
  normalizeString,
  normalizeStringArray,
  type AiGenerateRuntime,
} from "./runtime";
import type {
  DraftArtifact,
  EvoqCandidateReview,
  EvoqPopulationCandidate,
  NormalizedEvaluationPayload,
  NormalizedRawGeneratedPayload,
} from "./types";

interface EqprProcessAudit {
  solvable: boolean;
  issues: string[];
  refine_instructions: string;
  answer_path: string[];
}

interface ValidatedDraftOptions {
  initialMessage: string;
  initialStageKey: string;
  initialDetail: string;
  evaluationStageKey: string;
  revisionStageKey: string;
  revisionDetail: string;
  generationConstraints?: string;
  buildRevisionMessage?: (
    artifact: DraftArtifact,
    evaluation: NormalizedEvaluationPayload,
  ) => string;
}

export interface RunEvoqPopulationOptions {
  seedStrategies?: string[];
  mutationRounds?: number;
  maxPopulationSize?: number;
}

export interface RunEvoqPopulationResult {
  candidates: EvoqPopulationCandidate[];
  best: EvoqPopulationCandidate;
}

function readNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(normalizeString(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function serializeRecord(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function buildEmptyEvaluation(): string {
  return JSON.stringify(
    {
      passed: true,
      issues: [],
      revision_instructions: "",
    },
    null,
    2,
  );
}

function joinIssues(issues: string[]): string {
  return issues.filter(Boolean).join("；");
}

function normalizeMatchText(value: string): string {
  return normalizeString(value).toLowerCase();
}

function buildKnowledgeIndicators(knowledgePoint: string): string[] {
  const normalized = normalizeMatchText(knowledgePoint);
  const indicators = new Set<string>();

  for (const sequence of normalized.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    indicators.add(sequence);

    if (sequence.length >= 4) {
      for (let index = 0; index <= sequence.length - 2; index += 1) {
        indicators.add(sequence.slice(index, index + 2));
      }
    }

    if (sequence.length >= 6) {
      for (let index = 0; index <= sequence.length - 3; index += 1) {
        indicators.add(sequence.slice(index, index + 3));
      }
    }
  }

  for (const token of normalized.match(/[a-z0-9]+/g) || []) {
    if (token.length >= 3) {
      indicators.add(token);
    }
  }

  return [...indicators].filter((item) => item.length >= 2);
}

function buildRequiredAnchorGroups(knowledgePoint: string): string[][] {
  const normalized = normalizeMatchText(knowledgePoint);
  const groups: string[][] = [];

  const pushGroup = (...terms: string[]): void => {
    const normalizedTerms = terms.map((term) => normalizeMatchText(term)).filter(Boolean);
    if (normalizedTerms.length > 0) {
      groups.push(normalizedTerms);
    }
  };

  if (normalized.includes("图像性质")) {
    pushGroup("图像");
    pushGroup("性质", "斜率", "截距", "交点", "增减", "象限", "位置");
  } else {
    if (normalized.includes("图像")) {
      pushGroup("图像");
    }
    if (normalized.includes("性质")) {
      pushGroup("性质", "特点", "特征");
    }
  }

  if (normalized.includes("斜率")) {
    pushGroup("斜率", "k");
  }
  if (normalized.includes("截距")) {
    pushGroup("截距");
  }
  if (normalized.includes("定义域")) {
    pushGroup("定义域");
  }
  if (normalized.includes("值域")) {
    pushGroup("值域");
  }
  if (normalized.includes("单调")) {
    pushGroup("单调", "增减");
  }
  if (normalized.includes("最值")) {
    pushGroup("最值", "最大值", "最小值");
  }
  if (normalized.includes("对称")) {
    pushGroup("对称", "对称轴");
  }
  if (normalized.includes("平移")) {
    pushGroup("平移");
  }
  if (normalized.includes("应用")) {
    pushGroup("应用", "实际");
  }

  return groups;
}

function countKnowledgeIndicatorMatches(knowledgePoint: string, draftText: string): number {
  const normalizedDraftText = normalizeMatchText(draftText);
  if (!normalizedDraftText) {
    return 0;
  }

  const indicators = buildKnowledgeIndicators(knowledgePoint);
  if (indicators.length === 0) {
    return 0;
  }

  return indicators.filter((indicator) => normalizedDraftText.includes(indicator)).length;
}

function buildLocalDraftEvaluation(
  runtime: AiGenerateRuntime,
  draft: DraftArtifact,
): NormalizedEvaluationPayload {
  const issues: string[] = [];
  const combinedDraftText = [
    draft.raw.question,
    ...draft.raw.solution_steps,
    draft.raw.ground_truth,
  ].join("\n");

  const matchedIndicators = countKnowledgeIndicatorMatches(runtime.payload.knowledge_point, combinedDraftText);
  if (matchedIndicators < 2) {
    issues.push(`生成结果对已确认知识点“${runtime.payload.knowledge_point}”的聚焦程度不足。`);
  }

  const normalizedDraftText = normalizeMatchText(combinedDraftText);
  for (const group of buildRequiredAnchorGroups(runtime.payload.knowledge_point)) {
    const matched = group.some((term) => normalizedDraftText.includes(term));
    if (!matched) {
      issues.push(
        `生成结果缺少知识点“${runtime.payload.knowledge_point}”对应的显式子能力锚点，至少应覆盖以下之一：${group.join("、")}。`,
      );
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    revision_instructions:
      issues.length > 0
        ? `请重新生成题目，使题干与解析都显式聚焦“${runtime.payload.knowledge_point}”，覆盖必要的子能力表述，并删除无关内容。`
        : "",
  };
}

function mergeEvaluations(
  primary: NormalizedEvaluationPayload,
  secondary: NormalizedEvaluationPayload,
): NormalizedEvaluationPayload {
  if (primary.passed && secondary.passed) {
    return primary;
  }

  const issues = [...primary.issues, ...secondary.issues];
  return {
    passed: false,
    issues,
    revision_instructions: [primary.revision_instructions, secondary.revision_instructions]
      .filter(Boolean)
      .join(" "),
  };
}

function compareCandidates(left: EvoqPopulationCandidate, right: EvoqPopulationCandidate): number {
  if (left.review.passed !== right.review.passed) {
    return left.review.passed ? -1 : 1;
  }
  if (left.review.score !== right.review.score) {
    return right.review.score - left.review.score;
  }
  return left.review.issues.length - right.review.issues.length;
}

function defaultEvoqSeedStrategies(contentMode: AiGenerateRuntime["payload"]["content_mode"]): string[] {
  const baseStrategies = [
    "在保证答案唯一明确的前提下，尽量提升干扰项质量。",
    "保持题干精炼，但让解题过程具备清晰的多步推理。",
    "强化概念区分度，让不同掌握水平的学生明显拉开差距。",
  ];

  if (contentMode === "image") {
    return ["让配图成为正确作答不可替代的信息来源。", ...baseStrategies];
  }

  return baseStrategies;
}

function parseEqprProcessAudit(runtime: AiGenerateRuntime, content: string): EqprProcessAudit {
  const parsed = runtime.parseJsonRecord(content, "EQPR 过程审查");
  return {
    solvable: readBoolean(parsed.solvable, false),
    issues: normalizeStringArray(parsed.issues),
    refine_instructions: normalizeString(parsed.refine_instructions),
    answer_path: normalizeStringArray(parsed.answer_path),
  };
}

function parseEvoqReview(runtime: AiGenerateRuntime, content: string): EvoqCandidateReview {
  const parsed = runtime.parseJsonRecord(content, "EvoQ 候选评审");
  const issues = normalizeStringArray(parsed.issues);
  const mutationInstructions = normalizeString(parsed.mutation_instructions) || joinIssues(issues);

  return {
    passed: readBoolean(parsed.passed, false),
    score: clampScore(readNumber(parsed.score, 0)),
    strengths: normalizeStringArray(parsed.strengths),
    issues,
    mutation_instructions: mutationInstructions,
  };
}

async function runValidatedDraft(
  runtime: AiGenerateRuntime,
  options: ValidatedDraftOptions,
): Promise<DraftArtifact> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: options.initialDetail,
    log: `正在调用生成阶段 ${options.initialStageKey}。`,
  });

  const initialContent = await runtime.callGenerator(options.initialMessage, options.initialStageKey);
  let draft = runtime.parseDraft(initialContent);
  const initialEvaluation = mergeEvaluations(
    await runtime.evaluateDraftWithRetry(draft.draftJson, options.evaluationStageKey),
    buildLocalDraftEvaluation(runtime, draft),
  );

  if (initialEvaluation.passed) {
    return draft;
  }

  runtime.updateProgress({
    stage: "evaluate",
    state: "active",
    detail: "远程评估与本地约束检查均认为草稿需要修订。",
    log: `修订要求：${initialEvaluation.revision_instructions || joinIssues(initialEvaluation.issues)}`,
  });

  const generationConstraints = options.generationConstraints || runtime.algorithmPrompt;
  const revisionMessageBuilder =
    options.buildRevisionMessage ||
    ((artifact: DraftArtifact, evaluation: NormalizedEvaluationPayload) =>
      runtime.buildRevisionMessage(artifact.draftJson, evaluation, generationConstraints));

  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: options.revisionDetail,
    log: `正在调用修订阶段 ${options.revisionStageKey}。`,
  });

  const revisedContent = await runtime.callGenerator(
    revisionMessageBuilder(draft, initialEvaluation),
    options.revisionStageKey,
  );
  draft = runtime.parseDraft(revisedContent);

  const reEvaluation = mergeEvaluations(
    await runtime.evaluateDraftWithRetry(draft.draftJson, `${options.evaluationStageKey}-retry`),
    buildLocalDraftEvaluation(runtime, draft),
  );

  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在修订后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || "未知问题"}`,
    );
  }

  return draft;
}

async function executeDirectStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  const draft = await runValidatedDraft(runtime, {
    initialMessage: runtime.buildGeneratorMessage(runtime.algorithmPrompt),
    initialStageKey: "direct-generate",
    initialDetail: "正在生成直接出题草稿。",
    evaluationStageKey: "direct-evaluate",
    revisionStageKey: "direct-revise",
    revisionDetail: "正在根据评估反馈修订直接出题草稿。",
  });
  return draft.raw;
}

async function executeCotStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在规划分步推理的控制结构。",
    log: "正在调用 COT 规划阶段。",
  });

  const planContent = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/cot-plan.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      algorithm_constraints: runtime.algorithmPrompt,
    }),
    "cot-plan",
  );
  const planJson = runtime.extractJsonObject(planContent);
  const cotConstraints = `${runtime.algorithmPrompt}\n\n已批准的推理规划：\n${planJson}`;

  const draft = await runValidatedDraft(runtime, {
    initialMessage: runtime.buildPrompt("algorithms/cot-draft.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      plan_json: planJson,
      generation_constraints: cotConstraints,
    }),
    initialStageKey: "cot-draft",
    initialDetail: "正在根据推理规划生成 COT 草稿。",
    evaluationStageKey: "cot-evaluate",
    revisionStageKey: "cot-revise",
    revisionDetail: "正在在保留推理规划的前提下修订 COT 草稿。",
    generationConstraints: cotConstraints,
  });

  return draft.raw;
}

async function executeReactStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在规划 ReAct 出题循环。",
    log: "正在调用 ReAct 规划阶段。",
  });

  const planContent = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/react-plan.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      algorithm_constraints: runtime.algorithmPrompt,
    }),
    "react-plan",
  );
  const planJson = runtime.extractJsonObject(planContent);

  const draft = await runValidatedDraft(runtime, {
    initialMessage: runtime.buildPrompt("algorithms/react-draft.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      plan_json: planJson,
      generation_constraints: runtime.algorithmPrompt,
    }),
    initialStageKey: "react-draft",
    initialDetail: "正在生成 ReAct 草稿。",
    evaluationStageKey: "react-evaluate",
    revisionStageKey: "react-revise",
    revisionDetail: "正在根据评估观察结果修订 ReAct 草稿。",
    buildRevisionMessage: (draftArtifact, evaluation) =>
      runtime.buildPrompt("algorithms/react-revision.md", {
        spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
        plan_json: planJson,
        draft_json: draftArtifact.draftJson,
        evaluation_json: JSON.stringify(evaluation, null, 2),
        generation_constraints: runtime.algorithmPrompt,
      }),
  });

  return draft.raw;
}

async function executeDearStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在为 DeAR 分解目标概念。",
    log: "正在调用 DeAR 分解阶段。",
  });

  const decompositionContent = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/dear-decompose.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      algorithm_constraints: runtime.algorithmPrompt,
    }),
    "dear-decompose",
  );
  const decompositionJson = runtime.extractJsonObject(decompositionContent);

  const draft = await runValidatedDraft(runtime, {
    initialMessage: runtime.buildPrompt("algorithms/dear-draft.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      decomposition_json: decompositionJson,
      generation_constraints: runtime.algorithmPrompt,
    }),
    initialStageKey: "dear-draft",
    initialDetail: "正在根据分解结果生成 DeAR 草稿。",
    evaluationStageKey: "dear-evaluate",
    revisionStageKey: "dear-rethink",
    revisionDetail: "正在根据评估分析重新思考并修订 DeAR 草稿。",
    buildRevisionMessage: (draftArtifact, evaluation) =>
      runtime.buildPrompt("algorithms/dear-rethink.md", {
        spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
        decomposition_json: decompositionJson,
        draft_json: draftArtifact.draftJson,
        evaluation_json: JSON.stringify(evaluation, null, 2),
        generation_constraints: runtime.algorithmPrompt,
      }),
  });

  return draft.raw;
}

async function executeEqprStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在设计 EQPR 挑战简述。",
    log: "正在调用 EQPR 设计阶段。",
  });

  const designContent = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/eqpr-design.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      algorithm_constraints: runtime.algorithmPrompt,
    }),
    "eqpr-design",
  );
  const designJson = runtime.extractJsonObject(designContent);

  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在生成初版 EQPR 草稿。",
    log: "正在调用 EQPR 起草阶段。",
  });

  let draft = runtime.parseDraft(
    await runtime.callGenerator(
      runtime.buildPrompt("algorithms/eqpr-draft.md", {
        spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
        design_json: designJson,
        generation_constraints: runtime.algorithmPrompt,
      }),
      "eqpr-draft",
    ),
  );

  runtime.updateProgress({
    stage: "evaluate",
    state: "active",
    detail: "正在在最终评估前审查预期解题路径。",
    log: "正在调用 EQPR 过程审查阶段。",
  });

  const processContent = await runtime.callEvaluator(
    runtime.buildPrompt("algorithms/eqpr-process.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      design_json: designJson,
      draft_json: draft.draftJson,
    }),
    "eqpr-process",
  );
  const processAudit = parseEqprProcessAudit(runtime, processContent);

  if (!processAudit.solvable || processAudit.issues.length > 0 || processAudit.refine_instructions) {
    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: "过程审查未通过，正在修订 EQPR 草稿。",
      log: `过程审查修订要求：${processAudit.refine_instructions || joinIssues(processAudit.issues)}`,
    });

    draft = runtime.parseDraft(
      await runtime.callGenerator(
        runtime.buildPrompt("algorithms/eqpr-refine.md", {
          spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
          design_json: designJson,
          draft_json: draft.draftJson,
          process_json: JSON.stringify(processAudit, null, 2),
          evaluation_json: buildEmptyEvaluation(),
          generation_constraints: runtime.algorithmPrompt,
        }),
        "eqpr-refine-process",
      ),
    );
  }

  const evaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "eqpr-evaluate");
  if (evaluation.passed) {
    return draft.raw;
  }

  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "评估未通过，正在继续修订 EQPR 草稿。",
    log: `评估修订要求：${evaluation.revision_instructions || joinIssues(evaluation.issues)}`,
  });

  draft = runtime.parseDraft(
    await runtime.callGenerator(
      runtime.buildPrompt("algorithms/eqpr-refine.md", {
        spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
        design_json: designJson,
        draft_json: draft.draftJson,
        process_json: JSON.stringify(processAudit, null, 2),
        evaluation_json: JSON.stringify(evaluation, null, 2),
        generation_constraints: runtime.algorithmPrompt,
      }),
      "eqpr-refine-evaluate",
    ),
  );

  const reEvaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "eqpr-re-evaluate");
  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在 EQPR 修订后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || "未知问题"}`,
    );
  }

  return draft.raw;
}

async function reviewEvoqCandidate(
  runtime: AiGenerateRuntime,
  draftJson: string,
  stageKey: string,
): Promise<EvoqCandidateReview> {
  const reviewContent = await runtime.callEvaluator(
    runtime.buildPrompt("algorithms/evoq-ranker.md", {
      spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
      draft_json: draftJson,
    }),
    stageKey,
  );
  return parseEvoqReview(runtime, reviewContent);
}

export async function runEvoqPopulation(
  runtime: AiGenerateRuntime,
  options: RunEvoqPopulationOptions = {},
): Promise<RunEvoqPopulationResult> {
  const seedStrategies =
    options.seedStrategies && options.seedStrategies.length > 0
      ? options.seedStrategies
      : defaultEvoqSeedStrategies(runtime.payload.content_mode);
  const mutationRounds = Math.max(1, options.mutationRounds ?? 1);
  const maxPopulationSize = Math.max(2, options.maxPopulationSize ?? seedStrategies.length + mutationRounds);

  let population: EvoqPopulationCandidate[] = [];

  for (const [index, seedStrategy] of seedStrategies.entries()) {
    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `正在生成 EvoQ 初始候选 ${index + 1}。`,
      log: `初始策略：${seedStrategy}`,
    });

    const content = await runtime.callGenerator(
      runtime.buildPrompt("algorithms/evoq-seed.md", {
        spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
        seed_strategy: seedStrategy,
        generation_constraints: runtime.algorithmPrompt,
      }),
      `evoq-seed-${index + 1}`,
    );
    const draft = runtime.parseDraft(content);
    const review = await reviewEvoqCandidate(runtime, draft.draftJson, `evoq-rank-seed-${index + 1}`);

    population.push({
      id: `evoq-seed-${index + 1}-${randomUUID()}`,
      content,
      draftJson: draft.draftJson,
      raw: draft.raw,
      review,
    });
    population = [...population].sort(compareCandidates).slice(0, maxPopulationSize);
  }

  for (let round = 0; round < mutationRounds; round += 1) {
    const ranked = [...population].sort(compareCandidates);
    const parents = ranked.slice(0, 2);
    if (parents.length < 2) {
      break;
    }

    const mutationGoal = [
      parents[0].review.mutation_instructions,
      parents[1].review.mutation_instructions,
      runtime.payload.content_mode === "image"
        ? "保持配图对作答具有不可替代性。"
        : "保持题干简洁，同时继续提升区分度。",
    ]
      .filter(Boolean)
      .join(" ");

    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `正在执行 EvoQ 变异，第 ${round + 1} 轮。`,
      log: mutationGoal,
    });

    const content = await runtime.callGenerator(
      runtime.buildPrompt("algorithms/evoq-mutate.md", {
        spec_json: JSON.stringify(runtime.specContext.spec, null, 2),
        parent_a_json: parents[0].draftJson,
        parent_a_summary: serializeRecord({
          score: parents[0].review.score,
          strengths: parents[0].review.strengths,
          issues: parents[0].review.issues,
        }),
        parent_b_json: parents[1].draftJson,
        parent_b_summary: serializeRecord({
          score: parents[1].review.score,
          strengths: parents[1].review.strengths,
          issues: parents[1].review.issues,
        }),
        mutation_goal: mutationGoal,
        generation_constraints: runtime.algorithmPrompt,
      }),
      `evoq-mutate-${round + 1}`,
    );
    const draft = runtime.parseDraft(content);
    const review = await reviewEvoqCandidate(runtime, draft.draftJson, `evoq-rank-mutation-${round + 1}`);

    population = [
      ...population,
      {
        id: `evoq-child-${round + 1}-${randomUUID()}`,
        content,
        draftJson: draft.draftJson,
        raw: draft.raw,
        review,
      },
    ]
      .sort(compareCandidates)
      .slice(0, maxPopulationSize);
  }

  const ranked = [...population].sort(compareCandidates);
  const best = ranked[0];
  if (!best) {
    throw new Error("EvoQ 未产出任何候选题目");
  }

  return {
    candidates: ranked,
    best,
  };
}

async function executeEvoqStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  const population = await runEvoqPopulation(runtime);
  let draft: DraftArtifact = {
    content: population.best.content,
    draftJson: population.best.draftJson,
    raw: population.best.raw,
  };

  const evaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "evoq-final-evaluate");
  if (evaluation.passed) {
    return draft.raw;
  }

  const evolutionaryConstraints = `${runtime.algorithmPrompt}

当前最佳候选的优势：
${population.best.review.strengths.join("\n") || "- 无"}

变异优化方向：
${population.best.review.mutation_instructions || joinIssues(population.best.review.issues)}`;

  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "最终评估未通过，正在修补最佳 EvoQ 候选。",
    log: evaluation.revision_instructions || joinIssues(evaluation.issues),
  });

  draft = runtime.parseDraft(
    await runtime.callGenerator(
      runtime.buildRevisionMessage(draft.draftJson, evaluation, evolutionaryConstraints),
      "evoq-repair",
    ),
  );

  const reEvaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "evoq-final-re-evaluate");
  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在 EvoQ 修补后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || "未知问题"}`,
    );
  }

  return draft.raw;
}

export async function executeAlgorithmStrategy(
  runtime: AiGenerateRuntime,
): Promise<NormalizedRawGeneratedPayload> {
  switch (runtime.payload.algorithm) {
    case "direct":
      return executeDirectStrategy(runtime);
    case "cot":
      return executeCotStrategy(runtime);
    case "react":
      return executeReactStrategy(runtime);
    case "dear":
      return executeDearStrategy(runtime);
    case "eqpr":
      return executeEqprStrategy(runtime);
    case "evoq":
      return executeEvoqStrategy(runtime);
    default:
      return executeDirectStrategy(runtime);
  }
}
