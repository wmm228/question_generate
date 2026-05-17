import { randomUUID } from "crypto";

import {
  buildPromptSpecJson,
  isRecord,
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

interface DearBranch {
  draft: DraftArtifact;
  rationale: string;
  score: number;
  goal: string;
}

interface EqprNode {
  id: string;
  thought: string;
  parent: EqprNode | null;
  children: EqprNode[];
  rewards: number[];
  reward: number;
  visited: number;
  depth: number;
  isTerminal: boolean;
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

const DEAR_BRANCH_COUNT = 2;
const DEAR_SCORE_THRESHOLD = 7;
const DEAR_MAX_ITERATIONS = 3;
const EQPR_EXPAND_WIDTH = 2;
const EQPR_ITERATIONS = 3;
const EQPR_MAX_DEPTH = 3;
const EQPR_MIN_DEPTH = 2;
const EQPR_W_EXP = 2.5;
const EQPR_SIMULATE_EXPAND_WIDTH = 1;
const EVOQ_DEFAULT_POPULATION_SIZE = 3;
const EVOQ_DEFAULT_GENERATIONS = 3;
const EVOQ_ELITE_RATIO = 0.5;
const EVOQ_LAMBDA_RATIO = 1.0;
const EVOQ_TOURNAMENT_K = 2;

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

function clampTenPointScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function serializeRecord(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function joinIssues(issues: string[]): string {
  return issues.filter(Boolean).join("；");
}

function joinFeedbackInstructions(evaluation: NormalizedEvaluationPayload): string {
  return [
    evaluation.revision_instructions,
    evaluation.algorithm_feedback.rethink_instructions,
    evaluation.algorithm_feedback.mutation_instructions,
    evaluation.algorithm_feedback.next_action_hint,
    joinIssues(evaluation.issues),
  ].filter(Boolean).join(" ");
}

function compareCandidates(left: EvoqPopulationCandidate, right: EvoqPopulationCandidate): number {
  if (left.review.passed !== right.review.passed) {
    return left.review.passed ? -1 : 1;
  }
  if (left.review.fitness !== right.review.fitness) {
    return right.review.fitness - left.review.fitness;
  }
  if (left.review.score !== right.review.score) {
    return right.review.score - left.review.score;
  }
  return left.review.issues.length - right.review.issues.length;
}

function buildGeneratorBindings(runtime: AiGenerateRuntime, extra: Record<string, string> = {}): Record<string, string> {
  return {
    spec_json: buildPromptSpecJson(runtime.specContext.spec),
    subject: runtime.payload.subject,
    knowledge_id: runtime.payload.knowledge_point,
    difficulty_target: runtime.payload.difficulty,
    generation_constraints: runtime.algorithmPrompt,
    few_shots: "当前 Tutor 请求未提供 few-shot 示例。",
    ...extra,
  };
}

function buildReferenceLikeItemJson(candidate: EvoqPopulationCandidate): Record<string, unknown> {
  return {
    id: candidate.id,
    stem: candidate.raw.question,
    options: candidate.raw.options
      ? {
          A: candidate.raw.options[0] || "",
          B: candidate.raw.options[1] || "",
          C: candidate.raw.options[2] || "",
          D: candidate.raw.options[3] || "",
        }
      : {},
    answer: candidate.raw.ground_truth,
    analysis: candidate.raw.solution_steps.join("\n"),
    reflection: candidate.review,
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
  const initialEvaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, options.evaluationStageKey);

  if (initialEvaluation.passed) {
    return draft;
  }

  runtime.updateProgress({
    stage: "evaluate",
    state: "active",
    detail: "草稿需要按评估反馈修订。",
    log: `修订要求：${joinFeedbackInstructions(initialEvaluation)}`,
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

  const reEvaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, `${options.evaluationStageKey}-retry`);

  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在修订后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || reEvaluation.algorithm_feedback.summary || "未知问题"}`,
    );
  }

  return draft;
}

async function runSinglePromptBaseline(
  runtime: AiGenerateRuntime,
  stageKey: string,
  initialDetail: string,
  revisionDetail: string,
): Promise<NormalizedRawGeneratedPayload> {
  const draft = await runValidatedDraft(runtime, {
    initialMessage: runtime.buildGeneratorMessage(runtime.algorithmPrompt),
    initialStageKey: stageKey,
    initialDetail,
    evaluationStageKey: `${stageKey}-evaluate`,
    revisionStageKey: `${stageKey}-revise`,
    revisionDetail,
  });
  return draft.raw;
}

async function executeDirectStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  return runSinglePromptBaseline(
    runtime,
    "direct-generate",
    "正在按 EvoQ Direct 基线生成单次草稿。",
    "正在根据评估反馈修订 Direct 草稿。",
  );
}

async function executeCotStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  return runSinglePromptBaseline(
    runtime,
    "cot-generate",
    "正在按 EvoQ CoT 基线生成含设计思路的草稿。",
    "正在根据评估反馈修订 CoT 草稿。",
  );
}

async function executeReactStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  return runSinglePromptBaseline(
    runtime,
    "react-generate",
    "正在按 EvoQ ReAct 基线生成 Thought-Action 草稿。",
    "正在根据评估反馈修订 ReAct 草稿。",
  );
}

function parseDearGoals(runtime: AiGenerateRuntime, content: string): string[] {
  const parsed = runtime.parseJsonRecord(content, "DeAR 分解结果");
  const rawGoals = Array.isArray(parsed.sub_goals) ? parsed.sub_goals : [];
  return rawGoals
    .map((goal) => isRecord(goal) || Array.isArray(goal) ? JSON.stringify(goal) : normalizeString(goal))
    .filter(Boolean)
    .slice(0, DEAR_BRANCH_COUNT);
}

async function analyzeDearGoal(
  runtime: AiGenerateRuntime,
  goal: string,
  index: number,
): Promise<DearBranch | null> {
  const content = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/dear-analyze.md", buildGeneratorBindings(runtime, {
      plan_json: goal,
    })),
    `dear-analyze-${index + 1}`,
  );

  try {
    const parsed = runtime.parseJsonRecord(content, "DeAR 分支分析");
    const item = isRecord(parsed.item) ? parsed.item : parsed;
    const draft = runtime.parseDraft(JSON.stringify(item));
    const selfAnalysis = normalizeString(parsed.self_analysis);
    const score = clampTenPointScore(readNumber(parsed.score, 1));
    return {
      draft,
      goal,
      rationale: selfAnalysis || "DeAR 分支分析未返回自评说明。",
      score,
    };
  } catch (error) {
    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `DeAR 分支 ${index + 1} 解析失败，已跳过。`,
      log: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function rethinkDearDraft(
  runtime: AiGenerateRuntime,
  branch: DearBranch,
  rationale: string,
  stageKey: string,
): Promise<DearBranch> {
  const content = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/dear-rethink.md", buildGeneratorBindings(runtime, {
      prev_item_json: branch.draft.draftJson,
      prev_rationale: branch.rationale,
      new_rationale: rationale,
    })),
    stageKey,
  );
  const draft = runtime.parseDraft(content);
  return {
    draft,
    goal: branch.goal,
    rationale,
    score: clampTenPointScore(branch.score + 1),
  };
}

async function executeDearStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在按 EvoQ DeAR 基线分解多个设计方向。",
    log: "正在调用 DeAR decompose。",
  });

  const decompositionContent = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/dear-decompose.md", buildGeneratorBindings(runtime, {
      plan_count: String(DEAR_BRANCH_COUNT),
    })),
    "dear-decompose",
  );
  const goals = parseDearGoals(runtime, decompositionContent);
  if (goals.length === 0) {
    throw new Error("DeAR 未产出可执行的设计子目标");
  }

  const branches: DearBranch[] = [];
  for (const [index, goal] of goals.entries()) {
    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `正在分析 DeAR 分支 ${index + 1}/${goals.length}。`,
      log: goal,
    });
    const branch = await analyzeDearGoal(runtime, goal, index);
    if (branch) {
      branches.push(branch);
    }
    if (branch && branch.score >= DEAR_SCORE_THRESHOLD) {
      break;
    }
  }

  const initialBest = branches.sort((left, right) => right.score - left.score)[0];
  if (!initialBest) {
    throw new Error("DeAR 所有分支均未生成可解析题目");
  }

  let best = initialBest;
  for (let iteration = 0; best.score < DEAR_SCORE_THRESHOLD && iteration < DEAR_MAX_ITERATIONS; iteration += 1) {
    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `DeAR 最优分支分数 ${best.score}/10，正在执行第 ${iteration + 1} 次 Rethink。`,
      log: best.rationale,
    });
    best = await rethinkDearDraft(
      runtime,
      best,
      "需要进一步提升题目质量和难度匹配度。",
      `dear-rethink-${iteration + 1}`,
    );
  }

  const evaluation = await runtime.evaluateDraftWithRetry(best.draft.draftJson, "dear-evaluate");
  if (evaluation.passed) {
    return best.draft.raw;
  }

  best = await rethinkDearDraft(runtime, best, joinFeedbackInstructions(evaluation), "dear-rethink-evaluate");
  const reEvaluation = await runtime.evaluateDraftWithRetry(best.draft.draftJson, "dear-re-evaluate");
  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在 DeAR 修订后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || reEvaluation.algorithm_feedback.summary || "未知问题"}`,
    );
  }
  return best.draft.raw;
}

function extractXmlTag(text: string, tag: string): string {
  const match = text.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
  return normalizeString(match?.[1]) || normalizeString(text);
}

function createEqprNode(thought: string, parent: EqprNode | null): EqprNode {
  return {
    id: randomUUID(),
    thought,
    parent,
    children: [],
    rewards: [],
    reward: 0,
    visited: 0,
    depth: parent ? parent.depth + 1 : 0,
    isTerminal: false,
  };
}

function eqprQ(node: EqprNode): number {
  if (node.rewards.length === 0) {
    return node.reward;
  }
  return node.rewards.reduce((sum, reward) => sum + reward, 0) / node.rewards.length;
}

function eqprUct(node: EqprNode): number {
  const parentVisits = node.parent?.rewards.length ?? 0;
  return eqprQ(node) + EQPR_W_EXP * Math.sqrt(Math.log(parentVisits + 1) / Math.max(1, node.rewards.length));
}

function collectEqprPath(node: EqprNode): EqprNode[] {
  const path: EqprNode[] = [];
  let current: EqprNode | null = node;
  while (current) {
    path.push(current);
    current = current.parent;
  }
  return path.reverse();
}

function selectEqprLeaf(root: EqprNode): EqprNode[] {
  const path = [root];
  let current = root;
  while (current.children.length > 0 && !current.isTerminal) {
    current = current.children.reduce((best, child) => eqprUct(child) > eqprUct(best) ? child : best);
    path.push(current);
  }
  return path;
}

function findBestEqprNode(paths: EqprNode[][], fallback: EqprNode): EqprNode {
  if (paths.length === 0) {
    return fallback;
  }
  const bestPath = paths.reduce((best, path) => {
    const pathScore = path.reduce((sum, node) => sum + node.reward, 0) / Math.max(1, path.length);
    const bestScore = best.reduce((sum, node) => sum + node.reward, 0) / Math.max(1, best.length);
    return pathScore > bestScore ? path : best;
  });
  return bestPath.reduce((best, node) => node.reward > best.reward ? node : best, fallback);
}

async function scoreEqprThought(runtime: AiGenerateRuntime, thought: string, stageKey: string): Promise<number> {
  const response = await runtime.callEvaluator(
    runtime.buildPrompt("algorithms/eqpr-score.md", buildGeneratorBindings(runtime, {
      thought,
    })),
    stageKey,
  );
  try {
    const parsed = runtime.parseJsonRecord(response, "EQPR 思路评分");
    return clampTenPointScore(readNumber(parsed.score, 5));
  } catch {
    return 5;
  }
}

async function expandEqprChildren(
  runtime: AiGenerateRuntime,
  node: EqprNode,
  expandWidth: number,
  stageKey: string,
): Promise<EqprNode[]> {
  const trajectory = collectEqprPath(node).map((pathNode, index) => `(${index}) ${pathNode.thought}`).join("\n");
  const response = await runtime.callEvaluator(
    runtime.buildPrompt("algorithms/eqpr-reflection.md", buildGeneratorBindings(runtime, {
      expand_width: String(expandWidth),
      Question_design_thought: node.thought,
      trajectory_thoughts: trajectory,
    })),
    stageKey,
  );

  try {
    const parsed = runtime.parseJsonRecord(response, "EQPR 反思扩展");
    const children = Array.isArray(parsed.children) ? parsed.children : [];
    const childNodes = children
      .filter(isRecord)
      .map((child) => {
        const thought = normalizeString(child.thought) || node.thought;
        const childNode = createEqprNode(thought, node);
        childNode.reward = clampTenPointScore(readNumber(child.score, 5));
        return childNode;
      });
    while (childNodes.length < expandWidth) {
      const fallback = createEqprNode(node.thought, node);
      fallback.reward = 5;
      childNodes.push(fallback);
    }
    return childNodes.slice(0, expandWidth);
  } catch {
    const fallback = createEqprNode(node.thought, node);
    fallback.reward = 5;
    return [fallback];
  }
}

async function simulateEqpr(
  runtime: AiGenerateRuntime,
  node: EqprNode,
  stageKey: string,
): Promise<{ best: EqprNode; path: EqprNode[] }> {
  if (node.depth >= EQPR_MAX_DEPTH || node.isTerminal) {
    node.isTerminal = true;
    return { best: node, path: [node] };
  }

  const children = await expandEqprChildren(runtime, node, EQPR_SIMULATE_EXPAND_WIDTH, stageKey);
  node.children.push(...children);
  const best = children.reduce((currentBest, child) => child.reward > currentBest.reward ? child : currentBest, node);
  return {
    best,
    path: collectEqprPath(best).filter((pathNode) => pathNode !== node.parent),
  };
}

function backpropagateEqpr(path: EqprNode[], reward: number): void {
  for (const node of [...path].reverse()) {
    node.rewards.push(reward);
    node.visited += 1;
  }
}

async function executeEqprStrategy(runtime: AiGenerateRuntime): Promise<NormalizedRawGeneratedPayload> {
  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "正在按 EvoQ EQPR/MCTS 生成初始出题思路。",
    log: "正在调用 EQPR design。",
  });

  const designContent = await runtime.callGenerator(
    runtime.buildPrompt("algorithms/eqpr-design.md", buildGeneratorBindings(runtime, {
      Knowledge: runtime.payload.knowledge_point,
      Difficulty: runtime.payload.difficulty,
    })),
    "eqpr-design",
  );
  const root = createEqprNode(extractXmlTag(designContent, "thought"), null);
  root.reward = await scoreEqprThought(runtime, root.thought, "eqpr-score-root");

  let bestNode = root;
  let mctsThreshold = root.reward;
  const minThreshold = root.reward;
  const iterationPaths: EqprNode[][] = [];

  for (let iteration = 0; iteration < EQPR_ITERATIONS; iteration += 1) {
    const path = selectEqprLeaf(root);
    const leaf = path[path.length - 1] || root;
    let rolloutReward = leaf.reward;

    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `EQPR MCTS 第 ${iteration + 1}/${EQPR_ITERATIONS} 轮。`,
      log: leaf.thought,
    });

    if (leaf.depth >= EQPR_MAX_DEPTH || leaf.reward < minThreshold * 0.8) {
      leaf.isTerminal = true;
    } else {
      const expanded = await expandEqprChildren(runtime, leaf, EQPR_EXPAND_WIDTH, `eqpr-expand-${iteration + 1}`);
      leaf.children.push(...expanded);
      const simulation = await simulateEqpr(runtime, leaf, `eqpr-simulate-${iteration + 1}`);
      for (const simNode of simulation.path) {
        if (!path.includes(simNode)) {
          path.push(simNode);
        }
      }
      rolloutReward = simulation.best.reward;
      if (simulation.best.reward > bestNode.reward) {
        bestNode = simulation.best;
      }
      if (simulation.best.reward > mctsThreshold && simulation.best.depth > EQPR_MIN_DEPTH) {
        simulation.best.isTerminal = true;
      }
      mctsThreshold = Math.max(mctsThreshold, simulation.best.reward);
    }

    backpropagateEqpr(path, rolloutReward);
    iterationPaths.push([...path]);
  }

  bestNode = findBestEqprNode(iterationPaths, bestNode);
  const bestPath = collectEqprPath(bestNode).map((node, index) => `步骤${index + 1}:${node.thought}`).join("；");

  runtime.updateProgress({
    stage: "generate",
    state: "active",
    detail: "EQPR 搜索完成，正在根据最佳思路链生成最终题目。",
    log: bestPath,
  });

  let draft = runtime.parseDraft(
    await runtime.callGenerator(
      runtime.buildPrompt("algorithms/eqpr-generation.md", buildGeneratorBindings(runtime, {
        Knowledge: runtime.payload.knowledge_point,
        Difficulty: runtime.payload.difficulty,
        Question_design_thought: bestPath,
      })),
      "eqpr-generation",
    ),
  );

  const evaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "eqpr-evaluate");
  if (evaluation.passed) {
    return draft.raw;
  }

  draft = runtime.parseDraft(
    await runtime.callGenerator(
      runtime.buildRevisionMessage(draft.draftJson, evaluation, runtime.algorithmPrompt),
      "eqpr-repair",
    ),
  );
  const reEvaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "eqpr-re-evaluate");
  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在 EQPR 修补后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || reEvaluation.algorithm_feedback.summary || "未知问题"}`,
    );
  }
  return draft.raw;
}

function parseEvoqReview(runtime: AiGenerateRuntime, content: string): EvoqCandidateReview {
  const parsed = runtime.parseJsonRecord(content, "EvoQ 候选评审");
  const issues = normalizeStringArray(parsed.issues);
  const algorithmFeedback = isRecord(parsed.algorithm_feedback) ? parsed.algorithm_feedback : {};
  const mutationInstructions = normalizeString(parsed.mutation_instructions) || normalizeString(parsed.weakness) || joinIssues(issues);
  const score = clampScore(readNumber(parsed.score, 0));
  const passed = readBoolean(parsed.passed, false);
  const reviewIssues = !passed && issues.length === 0 && !mutationInstructions
    ? ["EvoQ 候选评审未通过，但评审器没有返回具体问题"]
    : issues;

  return {
    passed,
    score,
    fitness: clampScore(readNumber(parsed.fitness, score)),
    strengths: normalizeStringArray(parsed.strengths).concat(normalizeStringArray(parsed.strength)),
    weaknesses: normalizeStringArray(parsed.weaknesses).concat(normalizeStringArray(parsed.weakness)),
    issues: reviewIssues,
    mutation_instructions: mutationInstructions,
    rethink_instructions: normalizeString(parsed.rethink_instructions) || normalizeString(algorithmFeedback.rethink_instructions),
    next_action_hint: normalizeString(parsed.next_action_hint) || normalizeString(algorithmFeedback.next_action_hint),
  };
}

async function reviewEvoqCandidate(
  runtime: AiGenerateRuntime,
  draftJson: string,
  stageKey: string,
): Promise<EvoqCandidateReview> {
  const reviewContent = await runtime.callEvaluator(
    runtime.buildPrompt("algorithms/evoq-ranker.md", buildGeneratorBindings(runtime, {
      draft_json: draftJson,
      item_json: draftJson,
      reference_items: "None provided.",
      external_difficulty_eval: "Tutor 当前未接入 EvoQ 原仓库的 IRT/RankLLM 客观难度器；请按目标难度和题目本身严格评估。",
    })),
    stageKey,
  );
  return parseEvoqReview(runtime, reviewContent);
}

async function buildEvoqCandidate(
  runtime: AiGenerateRuntime,
  content: string,
  idPrefix: string,
  reviewStageKey: string,
): Promise<EvoqPopulationCandidate> {
  const draft = runtime.parseDraft(content);
  const review = await reviewEvoqCandidate(runtime, draft.draftJson, reviewStageKey);
  return {
    id: `${idPrefix}-${randomUUID()}`,
    content,
    draftJson: draft.draftJson,
    raw: draft.raw,
    review,
  };
}

function tournamentSelect(candidates: EvoqPopulationCandidate[], k = EVOQ_TOURNAMENT_K): EvoqPopulationCandidate {
  const sampleSize = Math.min(k, candidates.length);
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, sampleSize);
  return sampled.sort(compareCandidates)[0] || candidates.sort(compareCandidates)[0];
}

function isEvoqEarlyStopCandidate(candidate: EvoqPopulationCandidate): boolean {
  return candidate.review.passed && candidate.review.fitness >= 90 && candidate.review.issues.length === 0;
}

export async function runEvoqPopulation(
  runtime: AiGenerateRuntime,
  options: RunEvoqPopulationOptions = {},
): Promise<RunEvoqPopulationResult> {
  const populationSize = Math.max(2, options.maxPopulationSize ?? EVOQ_DEFAULT_POPULATION_SIZE);
  const generations = Math.max(1, options.mutationRounds ?? EVOQ_DEFAULT_GENERATIONS);
  const seedStrategies = options.seedStrategies && options.seedStrategies.length > 0
    ? options.seedStrategies
    : Array.from({ length: populationSize }, (_, index) => `生成第 ${index + 1} 个风格不同、答案唯一的初始种子。`);

  let population: EvoqPopulationCandidate[] = [];

  for (let index = 0; index < populationSize; index += 1) {
    const seedStrategy = seedStrategies[index % seedStrategies.length] || "";
    runtime.updateProgress({
      stage: "generate",
      state: "active",
      detail: `正在按 EvoQ GA 初始化种群 ${index + 1}/${populationSize}。`,
      log: seedStrategy,
    });

    const content = await runtime.callGenerator(
      runtime.buildPrompt("algorithms/evoq-seed.md", buildGeneratorBindings(runtime, {
        seed_strategy: seedStrategy,
      })),
      `evoq-seed-${index + 1}`,
    );
    population.push(await buildEvoqCandidate(runtime, content, `evoq-seed-${index + 1}`, `evoq-rank-seed-${index + 1}`));
  }

  population = population.sort(compareCandidates).slice(0, populationSize);
  if (population[0] && isEvoqEarlyStopCandidate(population[0])) {
    return { candidates: population, best: population[0] };
  }

  for (let generation = 0; generation < generations; generation += 1) {
    const sortedPopulation = population.sort(compareCandidates);
    const eliteCount = Math.max(1, Math.floor(populationSize * EVOQ_ELITE_RATIO));
    const elites = sortedPopulation.slice(0, eliteCount);
    const offspringTarget = Math.max(1, Math.floor(populationSize * EVOQ_LAMBDA_RATIO));
    const offspring: EvoqPopulationCandidate[] = [];
    let attempts = 0;
    const maxAttempts = offspringTarget * 3;

    while (offspring.length < offspringTarget && attempts < maxAttempts) {
      attempts += 1;
      const parentA = tournamentSelect(population);
      const parentB = tournamentSelect(elites);

      runtime.updateProgress({
        stage: "generate",
        state: "active",
        detail: `EvoQ 第 ${generation + 1}/${generations} 代交叉生成。`,
        log: `${parentA.id} x ${parentB.id}`,
      });

      const childContent = await runtime.callGenerator(
        runtime.buildPrompt("algorithms/evoq-crossover.md", buildGeneratorBindings(runtime, {
          parent_a_info: serializeRecord(buildReferenceLikeItemJson(parentA)),
          parent_b_info: serializeRecord(buildReferenceLikeItemJson(parentB)),
        })),
        `evoq-crossover-${generation + 1}-${attempts}`,
      );
      const child = await buildEvoqCandidate(
        runtime,
        childContent,
        `evoq-child-${generation + 1}-${attempts}`,
        `evoq-rank-child-${generation + 1}-${attempts}`,
      );

      runtime.updateProgress({
        stage: "generate",
        state: "active",
        detail: `EvoQ 第 ${generation + 1}/${generations} 代变异修复。`,
        log: child.review.mutation_instructions || joinIssues(child.review.issues),
      });

      const mutantContent = await runtime.callGenerator(
        runtime.buildPrompt("algorithms/evoq-mutate.md", buildGeneratorBindings(runtime, {
          input_data: serializeRecord(buildReferenceLikeItemJson(child)),
        })),
        `evoq-mutate-${generation + 1}-${attempts}`,
      );
      const mutant = await buildEvoqCandidate(
        runtime,
        mutantContent,
        `evoq-mutant-${generation + 1}-${attempts}`,
        `evoq-rank-mutant-${generation + 1}-${attempts}`,
      );
      offspring.push(mutant);
    }

    population = [...population, ...offspring].sort(compareCandidates).slice(0, populationSize);
    if (population[0] && isEvoqEarlyStopCandidate(population[0])) {
      break;
    }
  }

  const ranked = population.sort(compareCandidates);
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
${[
  population.best.review.mutation_instructions,
  population.best.review.rethink_instructions,
  population.best.review.next_action_hint,
  joinIssues(population.best.review.issues),
].filter(Boolean).join("\n")}`;

  draft = runtime.parseDraft(
    await runtime.callGenerator(
      runtime.buildRevisionMessage(draft.draftJson, evaluation, evolutionaryConstraints),
      "evoq-repair",
    ),
  );

  const reEvaluation = await runtime.evaluateDraftWithRetry(draft.draftJson, "evoq-final-re-evaluate");
  if (!reEvaluation.passed) {
    throw new Error(
      `AI 评估在 EvoQ 修补后仍未通过：${joinIssues(reEvaluation.issues) || reEvaluation.revision_instructions || reEvaluation.algorithm_feedback.summary || "未知问题"}`,
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
