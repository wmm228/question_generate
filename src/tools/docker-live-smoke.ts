import { generateAiQuestion } from "../services/ai-generate";
import { callOahSessionText } from "../services/oah-client";
import type { AiGenAlgorithm, AiGenPayload } from "../types/ai-generate";

const NVIDIA_MODEL_REFS = [
  "platform/deepseek-ai_deepseek-v4-flash",
  "platform/qwen_qwen3.5-397b-a17b",
  "platform/qwen_qwen3-next-80b-a3b-instruct",
  "platform/mistralai_ministral-14b-instruct-2512",
] as const;

const ALGORITHMS = ["direct", "cot", "react", "dear", "eqpr", "evoq"] as const;
const writeResult = console.log.bind(console);

if (process.env.SMOKE_QUIET !== "false") {
  console.log = () => undefined;
}

function parseList(value: string | undefined, fallback: readonly string[]): string[] {
  const parsed = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : [...fallback];
}

function parseAlgorithms(): AiGenAlgorithm[] {
  const parsed = parseList(process.env.SMOKE_ALGORITHMS, ALGORITHMS)
    .filter((item): item is AiGenAlgorithm => (ALGORITHMS as readonly string[]).includes(item));
  return parsed.length > 0 ? parsed : [...ALGORITHMS];
}

function basePayload(algorithm: AiGenAlgorithm): AiGenPayload {
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

async function runModelSmoke(): Promise<void> {
  const modelRefs = parseList(process.env.SMOKE_MODELS, NVIDIA_MODEL_REFS);
  const results = [];
  for (const modelRef of modelRefs) {
    const startedAt = Date.now();
    try {
      const text = await callOahSessionText({
        baseUrl: process.env.OAH_BASE_URL || "",
        requestId: `docker-model-smoke-${Date.now()}`,
        content: 'Return exactly this JSON object and nothing else: {"ok":true,"answer":"passed"}',
        sessionTitle: `docker model smoke ${modelRef}`,
        agentName: process.env.OAH_AGENT_NAME,
        modelRef,
        workspaceRuntime: process.env.OAH_WORKSPACE_RUNTIME,
        workspaceName: process.env.OAH_WORKSPACE_NAME,
        workspaceOwnerId: process.env.OAH_WORKSPACE_OWNER_ID,
        workspaceServiceName: process.env.OAH_WORKSPACE_SERVICE_NAME,
        workspaceAutoCreate: true,
        requestTimeoutMs: Number(process.env.OAH_REQUEST_TIMEOUT_MS || 600000),
        runTimeoutMs: Number(process.env.SMOKE_RUN_TIMEOUT_MS || 300000),
      });
      results.push({
        modelRef,
        ok: true,
        ms: Date.now() - startedAt,
        length: text.length,
        preview: text.slice(0, 120),
      });
    } catch (error) {
      results.push({
        modelRef,
        ok: false,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  writeResult(JSON.stringify({ mode: "models", results }, null, 2));
  if (results.some((result) => !result.ok || result.length === 0)) {
    process.exitCode = 1;
  }
}

async function runAlgorithmSmoke(): Promise<void> {
  const algorithms = parseAlgorithms();
  const results = [];
  for (const algorithm of algorithms) {
    const startedAt = Date.now();
    try {
      const result = await generateAiQuestion(basePayload(algorithm), `docker-live-${algorithm}-${Date.now()}`);
      results.push({
        algorithm,
        ok: true,
        ms: Date.now() - startedAt,
        answer: result.ground_truth,
        optionCount: Array.isArray(result.options) ? result.options.length : null,
        questionPreview: String(result.question || "").slice(0, 120),
      });
    } catch (error) {
      results.push({
        algorithm,
        ok: false,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  writeResult(JSON.stringify({ mode: "algorithms", results }, null, 2));
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  if (process.env.SMOKE_TARGET === "models") {
    await runModelSmoke();
    return;
  }
  await runAlgorithmSmoke();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
