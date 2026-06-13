import fs from "fs";
import path from "path";

import { AI_GEN_ALGORITHMS, AI_GEN_CONTENT_MODES, type AiGenAlgorithm, type AiGenContentMode } from "../types/ai-generate";
import {
  QUESTION_AGENT_ROLES,
  QUESTION_CONTROLLED_FIELD_KEYS,
  QUESTION_TOOL_NAMES,
  type QuestionAgentConfirmationRequirement,
  type QuestionAgentContentModeRoute,
  type QuestionAgentContractDocument,
  type QuestionAgentFinalResponseContract,
  type QuestionAgentPublicGroup,
  type QuestionAgentRole,
  type QuestionAgentToolService,
  type QuestionAgentToolRouting,
  type QuestionControlledFieldKey,
  type QuestionToolName,
} from "../types/question-agent";

const CONTRACT_HEADINGS = ["## 机器可读合同", "## Machine-Readable Contract"];

const ROLE_SET = new Set<string>(QUESTION_AGENT_ROLES);
const TOOL_SET = new Set<string>(QUESTION_TOOL_NAMES);
const CONTROLLED_FIELD_SET = new Set<string>(QUESTION_CONTROLLED_FIELD_KEYS);
const CONTENT_MODE_SET = new Set<string>(AI_GEN_CONTENT_MODES);
const ALGORITHM_SET = new Set<string>(AI_GEN_ALGORITHMS);

let cachedContract: QuestionAgentContractDocument | null = null;
let cachedContractSourcePath = "";
let cachedContractMtimeMs = -1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string array`);
  }
  const values = value.map((item) => normalizeString(item)).filter(Boolean);
  if (values.length !== value.length) {
    throw new Error(`${label} contains an invalid string item`);
  }
  return values;
}

function normalizeOptionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  return normalizeStringArray(value, label);
}

function normalizeStringOrBooleanArray(value: unknown, label: string): Array<string | boolean> {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be a string or boolean array`);
  }
  return value.map((item) => {
    if (typeof item === "boolean") {
      return item;
    }
    const normalized = normalizeString(item);
    if (!normalized) {
      throw new Error(`${label} contains an invalid item`);
    }
    return normalized;
  });
}

function parsePositiveIntegerOrNull(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(normalizeString(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

function assertExactMembers(actual: readonly string[], expected: readonly string[], label: string): void {
  const duplicateMembers = actual.filter((item, index) => actual.indexOf(item) !== index);
  if (duplicateMembers.length > 0) {
    throw new Error(`${label} contains duplicate entries: ${Array.from(new Set(duplicateMembers)).join(", ")}`);
  }

  const missingMembers = expected.filter((item) => !actual.includes(item));
  const extraMembers = actual.filter((item) => !expected.includes(item));
  if (missingMembers.length > 0 || extraMembers.length > 0) {
    const details = [
      missingMembers.length > 0 ? `missing: ${missingMembers.join(", ")}` : "",
      extraMembers.length > 0 ? `extra: ${extraMembers.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`${label} must exactly match the migrated question agent contract (${details})`);
  }
}

function findContractPath(): string {
  const candidatePaths = [
    path.resolve(process.cwd(), "oah-runtimes/tutor-question-generation/AGENTS.md"),
    path.resolve(__dirname, "../../oah-runtimes/tutor-question-generation/AGENTS.md"),
    path.resolve(__dirname, "../../../oah-runtimes/tutor-question-generation/AGENTS.md"),
  ];
  const foundPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!foundPath) {
    throw new Error("未找到题目生成智能体合同源文件");
  }
  return foundPath;
}

function extractContractJson(markdown: string): string {
  for (const heading of CONTRACT_HEADINGS) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = markdown.match(new RegExp(`${escapedHeading}\\s*\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\``, "i"));
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  throw new Error("未找到题目生成智能体的机器可读合同 JSON 块");
}

function parseQuestionAgentRole(value: unknown, label: string): QuestionAgentRole {
  const normalized = normalizeString(value);
  if (!ROLE_SET.has(normalized)) {
    throw new Error(`${label} must be one of the configured question agent roles`);
  }
  return normalized as QuestionAgentRole;
}

function parseQuestionAgentRoleArray(value: unknown, label: string): QuestionAgentRole[] {
  return normalizeStringArray(value, label).map((item) => parseQuestionAgentRole(item, label));
}

function parseQuestionToolNameArray(value: unknown, label: string): QuestionToolName[] {
  return normalizeStringArray(value, label).map((item) => {
    if (!TOOL_SET.has(item)) {
      throw new Error(`${label} contains an unknown question tool: ${item}`);
    }
    return item as QuestionToolName;
  });
}

function parseControlledFieldArray(value: unknown, label: string): QuestionControlledFieldKey[] {
  return normalizeStringArray(value, label).map((item) => {
    if (!CONTROLLED_FIELD_SET.has(item)) {
      throw new Error(`${label} contains an unknown controlled field: ${item}`);
    }
    return item as QuestionControlledFieldKey;
  });
}

function parseContentModeRoute(value: unknown, label: string): QuestionAgentContentModeRoute {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return {
    generator_agent: parseQuestionAgentRole(value.generator_agent, `${label}.generator_agent`),
    evaluator_agent: parseQuestionAgentRole(value.evaluator_agent, `${label}.evaluator_agent`),
    generator_tools: parseQuestionToolNameArray(value.generator_tools, `${label}.generator_tools`),
    evaluator_tools: parseQuestionToolNameArray(value.evaluator_tools, `${label}.evaluator_tools`),
  };
}

function parseToolRouting(value: unknown): QuestionAgentToolRouting {
  if (!isRecord(value)) {
    throw new Error("tool_routing must be an object");
  }
  if (!isRecord(value.by_content_mode)) {
    throw new Error("tool_routing.by_content_mode must be an object");
  }
  if (!isRecord(value.by_algorithm)) {
    throw new Error("tool_routing.by_algorithm must be an object");
  }

  const byContentMode = {} as Record<AiGenContentMode, QuestionAgentContentModeRoute>;
  for (const contentMode of AI_GEN_CONTENT_MODES) {
    if (!CONTENT_MODE_SET.has(contentMode)) {
      continue;
    }
    byContentMode[contentMode] = parseContentModeRoute(
      value.by_content_mode[contentMode],
      `tool_routing.by_content_mode.${contentMode}`,
    );
  }

  const byAlgorithm = {} as Record<AiGenAlgorithm, QuestionToolName[]>;
  for (const algorithm of AI_GEN_ALGORITHMS) {
    if (!ALGORITHM_SET.has(algorithm)) {
      continue;
    }
    byAlgorithm[algorithm] = parseQuestionToolNameArray(
      value.by_algorithm[algorithm],
      `tool_routing.by_algorithm.${algorithm}`,
    );
  }

  return {
    shared: parseQuestionToolNameArray(value.shared, "tool_routing.shared"),
    by_content_mode: byContentMode,
    by_algorithm: byAlgorithm,
  };
}

function parseAlgorithmAgentMap(value: unknown): Record<AiGenAlgorithm, string> {
  if (!isRecord(value)) {
    throw new Error("algorithm_agents must be an object");
  }

  const algorithmAgents = {} as Record<AiGenAlgorithm, string>;
  for (const algorithm of AI_GEN_ALGORITHMS) {
    const agentName = normalizeString(value[algorithm]);
    if (!agentName) {
      throw new Error(`algorithm_agents missing required algorithm: ${algorithm}`);
    }
    algorithmAgents[algorithm] = agentName;
  }
  return algorithmAgents;
}

function parsePublicAgentGroups(value: unknown): QuestionAgentPublicGroup[] {
  if (!Array.isArray(value)) {
    throw new Error("public_agent_groups must be an array");
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`public_agent_groups[${index}] must be an object`);
    }
    const name = normalizeString(item.name);
    const owner = normalizeString(item.owner);
    const members = normalizeStringArray(item.members, `public_agent_groups[${index}].members`);
    const purpose = normalizeString(item.purpose);
    if (!name || !owner || members.length === 0 || !purpose) {
      throw new Error(`public_agent_groups[${index}] requires name, owner, members, and purpose`);
    }
    return {
      name,
      owner,
      members,
      purpose,
    };
  });
}

function parseToolService(value: unknown): QuestionAgentToolService {
  if (!isRecord(value)) {
    throw new Error("tool_service must be an object");
  }

  const endpoints = {} as Record<QuestionToolName, string>;
  for (const tool of QUESTION_TOOL_NAMES) {
    const endpoint = normalizeString(value[tool]);
    if (!endpoint) {
      throw new Error(`tool_service missing endpoint for ${tool}`);
    }
    endpoints[tool] = endpoint;
  }

  const name = normalizeString(value.name);
  const baseUrl = normalizeString(value.base_url);
  const health = normalizeString(value.health);
  const openapi = normalizeString(value.openapi);
  const compatibilityGenerate = normalizeString(value.compatibility_generate);
  const genericToolDispatch = normalizeString(value.generic_tool_dispatch);
  if (!name || !baseUrl || !health || !openapi || !compatibilityGenerate || !genericToolDispatch) {
    throw new Error("tool_service requires name, base_url, health, openapi, compatibility_generate, and generic_tool_dispatch");
  }

  return {
    name,
    base_url: baseUrl,
    health,
    openapi,
    endpoints,
    compatibility_generate: compatibilityGenerate,
    generic_tool_dispatch: genericToolDispatch,
  };
}

function parseConfirmationRequirement(value: unknown, label: string): QuestionAgentConfirmationRequirement {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  const field = normalizeString(value.field);
  if (!CONTROLLED_FIELD_SET.has(field)) {
    throw new Error(`${label}.field must be a supported controlled field`);
  }
  const when = normalizeString(value.when);
  if (when !== "always" && when !== "image_only") {
    throw new Error(`${label}.when must be "always" or "image_only"`);
  }
  const message = normalizeString(value.message);
  if (!message) {
    throw new Error(`${label}.message must be a non-empty string`);
  }
  return {
    field: field as QuestionControlledFieldKey,
    when,
    message,
  };
}

function parseFinalResponseContract(value: unknown): QuestionAgentFinalResponseContract {
  if (!isRecord(value)) {
    throw new Error("final_response_contract must be an object");
  }

  const optionCount = parsePositiveIntegerOrNull(
    value.multiple_choice_option_count,
    "final_response_contract.multiple_choice_option_count",
  );
  if (optionCount === null) {
    throw new Error("final_response_contract.multiple_choice_option_count must be a positive number");
  }

  const multipleChoiceGroundTruthFormat = normalizeString(value.multiple_choice_ground_truth_format);
  if (!multipleChoiceGroundTruthFormat) {
    throw new Error("final_response_contract.multiple_choice_ground_truth_format must be a non-empty string");
  }

  return {
    version: normalizeString(value.version),
    required_fields: normalizeStringArray(value.required_fields, "final_response_contract.required_fields"),
    legacy_required_fields: normalizeOptionalStringArray(
      value.legacy_required_fields,
      "final_response_contract.legacy_required_fields",
    ),
    item_required_fields: normalizeOptionalStringArray(
      value.item_required_fields,
      "final_response_contract.item_required_fields",
    ),
    image_additional_fields: normalizeStringArray(
      value.image_additional_fields,
      "final_response_contract.image_additional_fields",
    ),
    multiple_choice_option_count: optionCount,
    multiple_choice_ground_truth_format: multipleChoiceGroundTruthFormat,
    single_choice_option_count: parsePositiveIntegerOrNull(
      value.single_choice_option_count,
      "final_response_contract.single_choice_option_count",
    ),
    single_choice_answer_format: normalizeString(value.single_choice_answer_format),
    true_false_ground_truth_values: normalizeStringOrBooleanArray(
      value.true_false_ground_truth_values,
      "final_response_contract.true_false_ground_truth_values",
    ),
  };
}

function parseQuestionAgentContractDocument(value: unknown): QuestionAgentContractDocument {
  if (!isRecord(value)) {
    throw new Error("Question agent contract JSON must be an object");
  }

  const specVersion = normalizeString(value.spec_version);
  if (specVersion !== "edu-question-spec.v1") {
    throw new Error(`Unsupported question agent contract version: ${specVersion}`);
  }

  if (!Array.isArray(value.explicit_confirmation_requirements)) {
    throw new Error("explicit_confirmation_requirements must be an array");
  }

  const mainAgent = parseQuestionAgentRole(value.main_agent, "main_agent");
  const subagents = parseQuestionAgentRoleArray(value.subagents, "subagents");
  const tools = parseQuestionToolNameArray(value.tools, "tools");
  assertExactMembers(
    subagents,
    QUESTION_AGENT_ROLES.filter((role) => role !== mainAgent),
    "subagents",
  );
  assertExactMembers(tools, QUESTION_TOOL_NAMES, "tools");
  const algorithmAgents = parseAlgorithmAgentMap(value.algorithm_agents);
  const publicAgentGroups = parsePublicAgentGroups(value.public_agent_groups);

  return {
    spec_version: specVersion,
    runtime_id: normalizeString(value.runtime_id) || "tutor-question-generation",
    main_agent: mainAgent,
    subagents,
    algorithm_agents: algorithmAgents,
    public_agent_groups: publicAgentGroups,
    compatibility_policy: normalizeStringArray(value.compatibility_policy, "compatibility_policy"),
    tools,
    runtime_candidates: normalizeStringArray(value.runtime_candidates, "runtime_candidates"),
    human_controlled_fields: parseControlledFieldArray(value.human_controlled_fields, "human_controlled_fields"),
    agent_controlled_fields: normalizeStringArray(value.agent_controlled_fields, "agent_controlled_fields"),
    explicit_confirmation_requirements: value.explicit_confirmation_requirements.map((item, index) =>
      parseConfirmationRequirement(item, `explicit_confirmation_requirements[${index}]`),
    ),
    human_controlled_rules: normalizeStringArray(value.human_controlled_rules, "human_controlled_rules"),
    decision_rules: normalizeStringArray(value.decision_rules, "decision_rules"),
    validation_rules: normalizeStringArray(value.validation_rules, "validation_rules"),
    tool_service: parseToolService(value.tool_service),
    tool_routing: parseToolRouting(value.tool_routing),
    final_response_contract: parseFinalResponseContract(value.final_response_contract),
  };
}

function loadQuestionAgentContract(): QuestionAgentContractDocument {
  const contractSourcePath = findContractPath();
  const contractStat = fs.statSync(contractSourcePath);
  const markdown = fs.readFileSync(contractSourcePath, "utf-8");
  const contractJson = extractContractJson(markdown);
  let parsed: unknown;
  try {
    parsed = JSON.parse(contractJson);
  } catch (error) {
    throw new Error(
      `Failed to parse question agent contract JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  cachedContractSourcePath = contractSourcePath;
  cachedContractMtimeMs = contractStat.mtimeMs;
  return parseQuestionAgentContractDocument(parsed);
}

export function getQuestionAgentContract(): QuestionAgentContractDocument {
  const contractSourcePath = findContractPath();
  const contractMtimeMs = fs.statSync(contractSourcePath).mtimeMs;
  const shouldReload = !cachedContract
    || cachedContractSourcePath !== contractSourcePath
    || cachedContractMtimeMs !== contractMtimeMs;

  if (shouldReload) {
    cachedContract = loadQuestionAgentContract();
  }
  if (!cachedContract) {
    throw new Error("题目生成智能体合同加载失败");
  }
  return cachedContract;
}

export function getQuestionAgentContractSourcePath(): string {
  if (!cachedContractSourcePath) {
    getQuestionAgentContract();
  }
  return cachedContractSourcePath;
}
