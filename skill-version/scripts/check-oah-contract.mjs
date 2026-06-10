#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const agentsPath = path.join(root, 'source', 'runtimes', 'tutor-question-generation', 'AGENTS.md');
const toolSettingsPath = path.join(root, 'source', 'tools', 'eduqg-question-generator', 'settings.yaml');
const skillPath = path.join(root, 'source', 'skills', 'eduqg-question-generator', 'SKILL.md');
const runtimePath = path.join(root, 'eduqg-question-generator', 'scripts', 'eduqg-core.mjs');

const originalAgentTools = [
  'validate_question_spec',
  'generate_visual_question',
  'run_evoq_text_question',
  'render_question_image',
  'simulate_student_response',
  'evaluate_text_question',
  'evaluate_visual_question',
  'read_profile',
  'write_profile',
];

function assertFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`);
}

assertFile(agentsPath);
assertFile(toolSettingsPath);
assertFile(skillPath);
assertFile(runtimePath);

const agents = fs.readFileSync(agentsPath, 'utf8');
const match = agents.match(/```json\s*([\s\S]*?)```/);
if (!match) throw new Error('AGENTS.md does not contain a machine-readable JSON block.');

const contract = JSON.parse(match[1]);
const requiredTopLevel = [
  'spec_version',
  'runtime_id',
  'main_agent',
  'subagents',
  'tools',
  'tool_service',
  'human_controlled_fields',
  'tool_routing',
  'final_response_contract',
];

for (const key of requiredTopLevel) {
  if (!(key in contract)) throw new Error(`Contract missing key: ${key}`);
}

if (contract.spec_version !== 'edu-question-spec.v1') {
  throw new Error(`Unexpected spec_version: ${contract.spec_version}`);
}

if (contract.main_agent !== 'question-orchestrator') {
  throw new Error(`Unexpected main_agent: ${contract.main_agent}`);
}

for (const tool of originalAgentTools) {
  if (!contract.tools.includes(tool)) throw new Error(`Contract missing tool: ${tool}`);
}

const settings = fs.readFileSync(toolSettingsPath, 'utf8');
for (const needle of ['http://127.0.0.1:8789', ...originalAgentTools]) {
  if (!settings.includes(needle)) throw new Error(`settings.yaml missing: ${needle}`);
}

const runtime = fs.readFileSync(runtimePath, 'utf8');
for (const tool of originalAgentTools) {
  if (!runtime.includes(`case '${tool}'`)) throw new Error(`Runtime dispatcher missing tool: ${tool}`);
}

if (!runtime.includes('export const AGENT_PROMPT_TEMPLATES')) {
  throw new Error('Runtime missing AGENT_PROMPT_TEMPLATES export.');
}

for (const agent of [contract.main_agent, ...contract.subagents]) {
  if (!runtime.includes(`'${agent}':`)) throw new Error(`Runtime missing prompt template for agent: ${agent}`);
}

const toolDir = path.dirname(toolSettingsPath);
const schemaRefs = [...settings.matchAll(/(?:input_schema|output_schema):\s*(.+)/g)]
  .map((match) => match[1].trim().replace(/^['"]|['"]$/g, ''));

if (schemaRefs.length === 0) throw new Error('settings.yaml does not declare input_schema/output_schema refs.');

for (const schemaRef of schemaRefs) {
  const resolved = path.resolve(toolDir, schemaRef);
  assertFile(resolved);
  JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

console.log(JSON.stringify({
  ok: true,
  runtime_id: contract.runtime_id,
  main_agent: contract.main_agent,
  subagents: contract.subagents.length,
  tools: contract.tools.length,
  original_agent_tools: originalAgentTools.length,
  prompt_templates: contract.subagents.length + 1,
  schema_refs: schemaRefs.length,
}, null, 2));
