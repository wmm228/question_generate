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
  const qualityGate = isRecord(parsed.quality_gate) ? parsed.quality_gate : {};
  if ("passed" in qualityGate && typeof qualityGate.passed !== "boolean") {
    throw new Error("invalid passed flag");
  }
  const qualityGatePassed = typeof qualityGate.passed === "boolean" ? qualityGate.passed : true;
  const passed = parsed.passed && qualityGatePassed;
  const qualityGateIssues = normalizeStringArray(qualityGate.issues);
  const issues = normalizeStringArray(parsed.issues);
  const revisionInstructions = normalizeString(parsed.revision_instructions);
  const allIssues = Array.from(new Set([
    ...qualityGateIssues,
    ...(!qualityGatePassed && qualityGateIssues.length === 0 ? ["quality_gate failed without issues"] : []),
    ...issues,
  ]));
  if (!passed && !revisionInstructions && allIssues.length === 0) {
    throw new Error("missing actionable revision instructions");
  }
  return {
    passed,
    issues: allIssues,
    revision_instructions: revisionInstructions || allIssues.join("; "),
  };
}

function stripMultipleChoiceOptionLabel(option) {
  return option.replace(/^[A-D]\s*[.、:：)]\s*/i, "").trim();
}

function extractMultipleChoiceParts(question) {
  const lines = question.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const optionPattern = /^([A-D])\s*[.、:：)]\s*(.*)$/;
  const optionEntries = lines
    .map((line) => {
      const match = line.match(optionPattern);
      return match ? { key: match[1], text: stripMultipleChoiceOptionLabel(match[2].trim() || line) } : null;
    })
    .filter((entry) => entry !== null);
  const options = ["A", "B", "C", "D"]
    .filter((key) => optionEntries.some((entry) => entry.key === key))
    .map((key) => optionEntries.find((entry) => entry.key === key).text || "");
  const questionLines = lines.filter((line) => !optionPattern.test(line));
  return {
    question: options.length > 0 ? questionLines.join("\n").trim() : question.trim(),
    options,
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
  const match = markdown.match(/## (?:Machine-Readable Contract|机器可读合同)\s*```json\s*([\s\S]*?)\s*```/i);
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

  const qualityGateBlock = parseEvaluationPayload(
    '{"passed":true,"quality_gate":{"passed":false,"issues":["answer not unique"]},"issues":[],"revision_instructions":""}',
  );
  if (qualityGateBlock.passed !== false) {
    throw new Error("quality_gate.passed=false should block a passed evaluation");
  }
  assertEqual("qualityGateBlock revision", qualityGateBlock.revision_instructions, "answer not unique");

  let failed = false;
  try {
    parseEvaluationPayload('{"passed":"yes","issues":[],"revision_instructions":""}');
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error("invalid passed flag case should fail");
  }

  const multipleChoice = extractMultipleChoiceParts("下列说法正确的是？\nA. 选项一\nB、选项二\nC: 选项三\nD) 选项四");
  assertEqual("multipleChoice question", multipleChoice.question, "下列说法正确的是？");
  assertEqual("multipleChoice option A", multipleChoice.options[0], "选项一");
  assertEqual("multipleChoice option D", multipleChoice.options[3], "选项四");

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
    "dear-analyze.md",
    "dear-draft.md",
    "dear-rethink.md",
    "eqpr.md",
    "eqpr-design.md",
    "eqpr-draft.md",
    "eqpr-generation.md",
    "eqpr-process.md",
    "eqpr-refine.md",
    "eqpr-reflection.md",
    "eqpr-score.md",
    "evoq.md",
    "evoq-seed.md",
    "evoq-crossover.md",
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
  assert(contract.runtime_id === "tutor-question-generation", "runtime_id should be tutor-question-generation");
  assert(Array.isArray(contract.subagents) && contract.subagents.length === 3, "contract should expose 3 OAH subagents");
  for (const agent of [
    "question-generator",
    "question-evaluator",
    "student-simulator",
  ]) {
    assert(contract.subagents.includes(agent), `missing OAH subagent: ${agent}`);
  }
  assert(!("tools" in contract), "tutor agent contract should not expose skill tools");
  assert(!("tool_service" in contract), "tutor agent contract should not expose skill tool_service");
  assert(!("tool_routing" in contract), "tutor agent contract should not expose skill tool_routing");
  for (const algorithm of ["direct", "cot", "react", "dear", "eqpr", "evoq"]) {
    assert(isRecord(contract.algorithm_routes), "algorithm_routes missing");
    assert(isRecord(contract.algorithm_routes[algorithm]), `missing algorithm route: ${algorithm}`);
    assert(contract.algorithm_routes[algorithm].strategy === algorithm, `invalid algorithm route: ${algorithm}`);
  }
  for (const contentMode of ["text", "image"]) {
    assert(isRecord(contract.content_mode_routes), "content_mode_routes missing");
    assert(isRecord(contract.content_mode_routes[contentMode]), `missing content-mode route: ${contentMode}`);
  }

  const workbenchApiSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/frontend/question-agent-workbench-api.ts"),
    "utf8",
  );
  assert(
    workbenchApiSource.includes("/api/ai-question/generate"),
    "question-agent workbench API should call /api/ai-question/generate",
  );
  assert(
    workbenchApiSource.includes("/api/ai-question/status/"),
    "question-agent workbench API should call /api/ai-question/status/:requestId",
  );

  const workbenchSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/frontend/question-agent-workbench.ts"),
    "utf8",
  );
  assert(
    workbenchSource.includes("sendingPortraitReply"),
    "portrait chat should guard against duplicate send submissions",
  );
  assert(
    workbenchSource.includes("renderLocalTeacherNoticeMarkup"),
    "generation chat should render the teacher command as a normal local message",
  );
  assert(
    !workbenchSource.includes("endAssistantWait(false)"),
    "generation chat should not leave a stale pending teacher bubble after completion",
  );

  console.log("ai-generate regression: ok");
}

run();
