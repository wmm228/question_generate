const fs = require("fs");
const path = require("path");

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractJsonObject(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) {
    throw new Error("empty content");
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch && fencedMatch[1]) {
    const fencedInner = fencedMatch[1].trim();
    if (fencedInner.startsWith("{") && fencedInner.endsWith("}")) {
      const parsed = JSON.parse(fencedInner);
      if (isRecord(parsed)) {
        return fencedInner;
      }
    }
  }

  const candidateStarts = [];
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
        const parsed = JSON.parse(candidate);
        if (isRecord(parsed)) {
          return candidate;
        }
      } catch {
        // keep scanning
      }
    }
  }

  throw new Error("invalid json content");
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }
  const text = normalizeString(value);
  return text ? [text] : [];
}

function parseEvaluationPayload(content) {
  const parsed = JSON.parse(extractJsonObject(content));
  if (!isRecord(parsed)) {
    throw new Error("invalid evaluation payload object");
  }
  if (typeof parsed.passed !== "boolean") {
    throw new Error("invalid passed flag");
  }
  const issues = normalizeStringArray(parsed.issues);
  const revisionInstructions = normalizeString(parsed.revision_instructions);
  if (!parsed.passed && !revisionInstructions && issues.length === 0) {
    throw new Error("missing actionable revision instructions");
  }
  return {
    passed: parsed.passed,
    issues,
    revision_instructions: revisionInstructions || issues.join("; "),
  };
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch\nexpected: ${expected}\nactual: ${actual}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readContractDocument() {
  const contractPath = path.resolve(process.cwd(), "oah-runtimes/tutor-question-generation/AGENTS.md");
  if (!fs.existsSync(contractPath)) {
    throw new Error(`missing contract source: ${contractPath}`);
  }
  const markdown = fs.readFileSync(contractPath, "utf8");
  const match = markdown.match(/## Machine-Readable Contract\s*```json\s*([\s\S]*?)\s*```/i);
  if (!match || !match[1]) {
    throw new Error("machine-readable contract block missing");
  }
  return JSON.parse(match[1]);
}

function run() {
  const jsonOnly = '{"question":"Q","solution_steps":["S"],"ground_truth":"A"}';
  assertEqual("jsonOnly", extractJsonObject(jsonOnly), jsonOnly);

  const fenced = '```json\n{"passed":true,"issues":[],"revision_instructions":""}\n```';
  assertEqual("fenced", extractJsonObject(fenced), '{"passed":true,"issues":[],"revision_instructions":""}');

  const mixed = 'Some lead text\n{"passed":false,"issues":["bad"],"revision_instructions":"fix it"}\nSome tail text';
  assertEqual("mixed", extractJsonObject(mixed), '{"passed":false,"issues":["bad"],"revision_instructions":"fix it"}');

  const evalOk = parseEvaluationPayload(fenced);
  if (evalOk.passed !== true || evalOk.issues.length !== 0) {
    throw new Error("evalOk failed");
  }

  const evalFix = parseEvaluationPayload('{"passed":false,"issues":["need image"],"revision_instructions":""}');
  if (evalFix.passed !== false) {
    throw new Error("evalFix passed flag incorrect");
  }
  assertEqual("evalFix revision", evalFix.revision_instructions, "need image");

  let failed = false;
  try {
    parseEvaluationPayload('{"passed":"yes","issues":[],"revision_instructions":""}');
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error("invalid passed flag case should fail");
  }

  const promptDir = path.resolve(process.cwd(), "src/prompts/question-agents");
  for (const file of ["direct-generator.md", "direct-evaluator.md", "direct-revision.md"]) {
    const target = path.resolve(promptDir, file);
    if (!fs.existsSync(target)) {
      throw new Error(`missing prompt template: ${target}`);
    }
  }

  const algorithmPromptDir = path.resolve(promptDir, "algorithms");
  for (const file of [
    "direct.md",
    "cot.md",
    "cot-plan.md",
    "cot-draft.md",
    "react.md",
    "react-plan.md",
    "react-draft.md",
    "react-revision.md",
    "dear.md",
    "dear-decompose.md",
    "dear-draft.md",
    "dear-rethink.md",
    "eqpr.md",
    "eqpr-design.md",
    "eqpr-draft.md",
    "eqpr-process.md",
    "eqpr-refine.md",
    "evoq.md",
    "evoq-seed.md",
    "evoq-ranker.md",
    "evoq-mutate.md",
  ]) {
    const target = path.resolve(algorithmPromptDir, file);
    if (!fs.existsSync(target)) {
      throw new Error(`missing algorithm prompt template: ${target}`);
    }
  }

  const contract = readContractDocument();
  assert(contract.main_agent === "question-orchestrator", "main_agent should be question-orchestrator");
  for (const algorithm of ["direct", "cot", "react", "dear", "eqpr", "evoq"]) {
    assert(isRecord(contract.tool_routing), "tool_routing missing");
    assert(isRecord(contract.tool_routing.by_algorithm), "tool_routing.by_algorithm missing");
    assert(Array.isArray(contract.tool_routing.by_algorithm[algorithm]), `missing algorithm route: ${algorithm}`);
  }
  for (const contentMode of ["text", "image"]) {
    assert(isRecord(contract.tool_routing), "tool_routing missing");
    assert(isRecord(contract.tool_routing.by_content_mode), "tool_routing.by_content_mode missing");
    assert(isRecord(contract.tool_routing.by_content_mode[contentMode]), `missing content-mode route: ${contentMode}`);
  }

  const workbenchSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/frontend/question-agent-workbench.ts"),
    "utf8",
  );
  assert(
    workbenchSource.includes("/api/ai-question/generate"),
    "question-agent workbench should call /api/ai-question/generate",
  );
  assert(
    workbenchSource.includes("/api/ai-question/status/"),
    "question-agent workbench should call /api/ai-question/status/:requestId",
  );

  console.log("ai-generate regression: ok");
}

run();
