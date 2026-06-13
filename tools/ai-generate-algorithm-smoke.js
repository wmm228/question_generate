require("ts-node/register/transpile-only");

const fs = require("fs");
const path = require("path");

const {
  executeAlgorithmStrategy,
} = require("../src/services/ai-generate-runtime/strategies");
const {
  EVOQ_IRT_VIRTUAL_STUDENTS,
  evaluateEvoqIrtDifficultyForDraft,
  mapTutorDifficultyToEvoqDifficulty,
} = require("../src/services/ai-generate-runtime/evoq-irt");
const {
  buildPromptSpecJson,
  extractJsonObject,
  parseRawGeneratedPayload,
  serializeNormalizedDraftForPrompt,
} = require("../src/services/ai-generate-runtime/runtime");
const {
  normalizeQuestionGenerationSpec,
} = require("../src/services/question-agent-spec");

const algorithms = ["direct", "cot", "react", "dear", "eqpr", "evoq"];
const primaryOahModelRef = "platform/qwen_qwen3.5-397b-a17b";

function applyBindings(template, bindings) {
  return Object.entries(bindings).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{${key}}`, value),
    template,
  );
}

function loadPrompt(name) {
  return fs.readFileSync(path.resolve(process.cwd(), "src/prompts/question-agents", name), "utf8");
}

function makePayload(algorithm) {
  return {
    subject: "数学",
    knowledge_point: "一次函数图像中斜率与截距符号判断",
    difficulty: "3",
    algorithm,
    question_type: "multiple_choice",
    content_mode: "text",
    image_placement: "",
    image_targets: [],
    image_mode: "none",
  };
}

function makeDraft(label, referenceShape = false) {
  if (referenceShape) {
    return JSON.stringify({
      stem: `${label}：已知一次函数 y=kx+b 的图像经过第二、三、四象限，下列判断正确的是？`,
      options: {
        A: "k<0 且 b<0",
        B: "k>0 且 b<0",
        C: "k<0 且 b>0",
        D: "k>0 且 b>0",
      },
      answer: "A",
      analysis: "图像过第二、四象限说明 k<0；与 y 轴交于负半轴说明 b<0，所以选 A。",
    });
  }
  return JSON.stringify({
    question: `${label}：已知一次函数 y=kx+b 的图像经过第二、三、四象限，下列判断正确的是？`,
    options: ["k<0 且 b<0", "k>0 且 b<0", "k<0 且 b>0", "k>0 且 b>0"],
    ground_truth: "A",
    solution_steps: ["图像过第二、四象限说明 k<0。", "与 y 轴交于负半轴说明 b<0，所以选 A。"],
  });
}

function makeEvaluation(passed = true) {
  return {
    passed,
    score: passed ? 90 : 40,
    fitness: passed ? 90 : 40,
    strengths: passed ? ["结构完整"] : [],
    weaknesses: passed ? [] : ["需要修订"],
    issues: passed ? [] : ["需要修订"],
    difficulty_direction: "matched",
    revision_instructions: passed ? "" : "修订题干与答案。",
    algorithm_feedback: {
      summary: passed ? "可放行" : "需要修订",
      mutation_instructions: passed ? "保持结构。" : "修订缺陷。",
      rethink_instructions: "",
      next_action_hint: passed ? "accept" : "revise",
    },
  };
}

function makeReview(stageKey) {
  const isMutant = stageKey.includes("mutant");
  const isChild = stageKey.includes("child");
  const score = isMutant ? 94 : isChild ? 82 : 68;
  return JSON.stringify({
    passed: true,
    score,
    fitness: score,
    strengths: ["知识点贴合", "选项互斥"],
    weaknesses: isMutant ? [] : ["还可以进一步贴近目标难度"],
    issues: [],
    mutation_instructions: isMutant ? "保持当前设计。" : "最小幅度调整数字和干扰项。",
    rethink_instructions: "复查斜率和截距符号关系。",
    next_action_hint: isMutant ? "accept" : "mutate",
  });
}

function makeRuntime(algorithm, options = {}) {
  const payload = makePayload(algorithm);
  const specContext = normalizeQuestionGenerationSpec({
    ...payload,
    request_uuid: `smoke-${algorithm}`,
  });
  const generatorStages = [];
  const evaluatorStages = [];
  let malformedEvoqReviewsRemaining = Number(options.malformedEvoqReviews || 0);

  const runtime = {
    payload,
    requestId: `smoke-${algorithm}`,
    specContext,
    generatorAgent: specContext.spec.generation_contract.generator_agent,
    evaluatorAgent: specContext.spec.generation_contract.evaluator_agent,
    algorithmPrompt: `算法 smoke 约束：${algorithm}`,
    updateProgress: () => undefined,
    buildPrompt: (name, bindings) => applyBindings(loadPrompt(name), bindings),
    buildGeneratorMessage: (generationConstraints) => applyBindings(loadPrompt("direct-generator.md"), {
      spec_json: buildPromptSpecJson(specContext.spec),
      subject: payload.subject,
      generation_constraints: generationConstraints,
    }),
    buildRevisionMessage: (previousDraftJson, evaluation, generationConstraints) => applyBindings(loadPrompt("direct-revision.md"), {
      spec_json: buildPromptSpecJson(specContext.spec),
      draft_json: previousDraftJson,
      issues_json: JSON.stringify(evaluation.issues, null, 2),
      revision_instructions: evaluation.revision_instructions,
      generation_constraints: generationConstraints,
    }),
    callGenerator: async (_content, stageKey) => {
      generatorStages.push(stageKey);
      if (stageKey === "dear-decompose") {
        return JSON.stringify({
          sub_goals: ["计划1：符号判断", "计划2：图像象限"],
        });
      }
      if (stageKey === "dear-analyze-1") {
        return JSON.stringify({
          item: JSON.parse(makeDraft("dear-analyze-1")),
          self_analysis: "难度略低",
          score: 5,
        });
      }
      if (stageKey === "dear-analyze-2") {
        return JSON.stringify({
          item: JSON.parse(makeDraft("dear-analyze-2")),
          self_analysis: "还需增强区分度",
          score: 6,
        });
      }
      if (stageKey.startsWith("dear-rethink")) {
        return makeDraft(stageKey);
      }
      if (stageKey === "eqpr-design") {
        return "<thought>用象限信息反推 k 与 b 的符号</thought>";
      }
      if (stageKey === "eqpr-generation") {
        return makeDraft("eqpr-generation");
      }
      if (stageKey.startsWith("evoq-seed")) {
        return makeDraft(stageKey);
      }
      if (stageKey.startsWith("evoq-crossover")) {
        return makeDraft(stageKey);
      }
      if (stageKey.startsWith("evoq-mutate")) {
        return makeDraft(stageKey);
      }
      if (stageKey.includes("revise") || stageKey.includes("repair")) {
        return makeDraft(stageKey);
      }
      return makeDraft(stageKey, true);
    },
    callEvaluator: async (_content, stageKey) => {
      evaluatorStages.push(stageKey);
      if (stageKey.startsWith("eqpr-score")) {
        return JSON.stringify({ score: 6 });
      }
      if (stageKey.startsWith("eqpr-expand") || stageKey.startsWith("eqpr-simulate")) {
        return JSON.stringify({
          children: [
            { gradient: "区分度不足", thought: `${stageKey} 优化思路A`, score: 7 },
            { gradient: "数字太直给", thought: `${stageKey} 优化思路B`, score: 8 },
          ],
        });
      }
      if (stageKey.includes("evoq-rank")) {
        if (malformedEvoqReviewsRemaining > 0) {
          malformedEvoqReviewsRemaining -= 1;
          return "评审器输出了自然语言，没有返回 JSON。";
        }
        return makeReview(stageKey);
      }
      return JSON.stringify(makeEvaluation(true));
    },
    extractJsonObject,
    parseJsonRecord: (content, errorLabel) => {
      const jsonText = extractJsonObject(content);
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${errorLabel} 返回的 JSON 不是对象`);
      }
      return parsed;
    },
    parseDraft: (content) => {
      const raw = parseRawGeneratedPayload(content, payload);
      return {
        content,
        draftJson: serializeNormalizedDraftForPrompt(raw),
        raw,
      };
    },
    evaluateDraftWithRetry: async (draftJson, stageKeyPrefix) => {
      evaluatorStages.push(stageKeyPrefix);
      JSON.parse(extractJsonObject(draftJson));
      return makeEvaluation(true);
    },
    finalize: async (raw) => raw,
    logPipelineStarted: () => undefined,
    logPipelineCompleted: () => undefined,
    logPipelineFailed: () => undefined,
  };

  return { runtime, generatorStages, evaluatorStages };
}

async function smokeEvoqMalformedReviewFallback() {
  const { runtime, evaluatorStages } = makeRuntime("evoq", { malformedEvoqReviews: 1 });
  const result = await executeAlgorithmStrategy(runtime);
  assert(result.question.includes("一次函数"), "evoq malformed review fallback: question should be generated");
  assert(Array.isArray(result.options) && result.options.length === 4, "evoq malformed review fallback: options should have 4 entries");
  assert(result.ground_truth === "A", "evoq malformed review fallback: ground_truth should be A");
  assert(evaluatorStages.some((stage) => stage.includes("evoq-rank")), "evoq malformed review fallback: missing rank stage");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function smokeAlgorithm(algorithm) {
  const { runtime, generatorStages, evaluatorStages } = makeRuntime(algorithm);
  const result = await executeAlgorithmStrategy(runtime);

  assert(result.question.includes("一次函数"), `${algorithm}: question should be generated`);
  assert(Array.isArray(result.options) && result.options.length === 4, `${algorithm}: options should have 4 entries`);
  assert(result.ground_truth === "A", `${algorithm}: ground_truth should be A`);
  assert(result.solution_steps.length > 0, `${algorithm}: solution_steps should be non-empty`);

  if (algorithm === "dear") {
    assert(generatorStages.includes("dear-decompose"), "dear: missing decompose stage");
    assert(generatorStages.includes("dear-analyze-1"), "dear: missing analyze stage");
    assert(generatorStages.some((stage) => stage.startsWith("dear-rethink")), "dear: missing rethink stage");
  }
  if (algorithm === "eqpr") {
    assert(generatorStages.includes("eqpr-design"), "eqpr: missing design stage");
    assert(generatorStages.includes("eqpr-generation"), "eqpr: missing generation stage");
    assert(evaluatorStages.some((stage) => stage.startsWith("eqpr-score")), "eqpr: missing score stage");
    assert(evaluatorStages.some((stage) => stage.startsWith("eqpr-expand")), "eqpr: missing expand stage");
  }
  if (algorithm === "evoq") {
    assert(generatorStages.some((stage) => stage.startsWith("evoq-seed")), "evoq: missing seed stage");
    assert(generatorStages.some((stage) => stage.startsWith("evoq-crossover")), "evoq: missing crossover stage");
    assert(generatorStages.some((stage) => stage.startsWith("evoq-mutate")), "evoq: missing mutate stage");
    assert(evaluatorStages.some((stage) => stage.includes("evoq-rank")), "evoq: missing rank stage");
  }

  return {
    algorithm,
    generatorStages,
    evaluatorStages,
  };
}

async function smokeEvoqIrtContract() {
  assert(EVOQ_IRT_VIRTUAL_STUDENTS.length === 12, "evoq irt: should keep 12 virtual students");
  const allowedNvidiaModelRefs = new Set([
    "platform/deepseek-ai_deepseek-v4-flash",
    "platform/qwen_qwen3.5-397b-a17b",
    "platform/qwen_qwen3-next-80b-a3b-instruct",
    "platform/mistralai_ministral-14b-instruct-2512",
  ]);
  for (const model of EVOQ_IRT_VIRTUAL_STUDENTS) {
    assert(model.provider === "oah", `evoq irt: ${model.name} should use OAH`);
    assert(model.api_type === "oah", `evoq irt: ${model.name} api_type should be OAH`);
    assert(allowedNvidiaModelRefs.has(model.model), `evoq irt: ${model.name} should use a tested NVIDIA modelRef`);
    assert(typeof model.original_model === "string" && model.original_model.includes("__"), `evoq irt: ${model.name} should preserve original model mapping`);
    assert(typeof model.theta === "number" && Number.isFinite(model.theta), `evoq irt: ${model.name} should define theta`);
  }
  assert(mapTutorDifficultyToEvoqDifficulty(1) === 10, "evoq irt: difficulty 1 should map to 10");
  assert(mapTutorDifficultyToEvoqDifficulty(2) === 30, "evoq irt: difficulty 2 should map to 30");
  assert(mapTutorDifficultyToEvoqDifficulty(3) === 50, "evoq irt: difficulty 3 should map to 50");
  assert(mapTutorDifficultyToEvoqDifficulty(4) === 60, "evoq irt: difficulty 4 should map to 60");
  assert(mapTutorDifficultyToEvoqDifficulty(5) === 70, "evoq irt: difficulty 5 should map to 70");
  assert(mapTutorDifficultyToEvoqDifficulty(6) === 80, "evoq irt: difficulty 6 should map to 80");

  const payload = makePayload("evoq");
  const specContext = normalizeQuestionGenerationSpec({
    ...payload,
    request_uuid: "smoke-evoq-irt",
  });
  const objective = await evaluateEvoqIrtDifficultyForDraft(
    {
      payload,
      requestId: "smoke-evoq-irt",
      specContext,
    },
    JSON.parse(makeDraft("evoq-irt-objective")),
  );
  assert(objective.method === "irt", "evoq irt: objective method should be irt");
  assert(objective.virtual_student_count === 12, "evoq irt: objective should use 12 virtual students");
  assert([10, 30, 50, 60, 70, 80].includes(objective.algorithm_difficulty_irt), "evoq irt: prediction should use EvoQ buckets");
  assert(objective.external_difficulty_eval.includes("EvoQ"), "evoq irt: should produce external difficulty report");
}

function smokeOahDeploymentConfig() {
  const runtimeSettingsPath = path.resolve(
    process.cwd(),
    "deploy/oah-deploy-root/source/runtimes/tutor-question-generation/.openharness/settings.yaml",
  );
  const dockerEnvPath = path.resolve(process.cwd(), ".env.docker");
  const localEnvPath = path.resolve(process.cwd(), ".env");

  const runtimeSettings = fs.readFileSync(runtimeSettingsPath, "utf8");
  const dockerEnv = fs.readFileSync(dockerEnvPath, "utf8");
  const localEnv = fs.readFileSync(localEnvPath, "utf8");

  for (const forbidden of ["nvidia_nemotron", "nemotron-3-nano", "platform/kimi-", "platform/GLM-"]) {
    assert(!runtimeSettings.includes(forbidden), `oah deployment settings must not contain old model marker: ${forbidden}`);
  }

  const modelRefs = [...runtimeSettings.matchAll(/ref:\s*(platform\/[^\s]+)/g)].map((match) => match[1]);
  assert(modelRefs.length >= 5, "oah deployment settings should configure model refs for all runtime roles");
  for (const modelRef of modelRefs) {
    assert(modelRef === primaryOahModelRef, `oah deployment settings should use ${primaryOahModelRef}, got ${modelRef}`);
  }

  for (const [label, content] of [[".env", localEnv], [".env.docker", dockerEnv]]) {
    assert(content.includes(`OAH_MODEL_NAME=${primaryOahModelRef}`), `${label} should pin OAH_MODEL_NAME to ${primaryOahModelRef}`);
    assert(content.includes("OAH_REQUEST_TIMEOUT_MS=600000"), `${label} should use a 600s OAH request timeout`);
  }
}

async function run() {
  smokeOahDeploymentConfig();
  await smokeEvoqIrtContract();
  await smokeEvoqMalformedReviewFallback();
  const summaries = [];
  for (const algorithm of algorithms) {
    summaries.push(await smokeAlgorithm(algorithm));
  }
  for (const summary of summaries) {
    console.log(`${summary.algorithm}: generators=${summary.generatorStages.length}, evaluators=${summary.evaluatorStages.length}`);
  }
  console.log("ai-generate algorithm smoke: ok");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
