#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentPromptMessages, dispatchEduqgTool, generateEduqgResult, listAgentPromptTemplates } from './eduqg-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillDir = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    if (args[key] === undefined) args[key] = next;
    else if (Array.isArray(args[key])) args[key].push(next);
    else args[key] = [args[key], next];
    index += 1;
  }
  return args;
}

function getString(args, name) {
  const value = args[name];
  if (Array.isArray(value)) return value.at(-1);
  return typeof value === 'string' ? value : undefined;
}

function getArray(args, name) {
  const value = args[name];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  return [];
}

function hasFlag(args, name) {
  return args[name] === true;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/entrypoint.mjs --input examples/request.json --mock --output out/result.json',
    '  node scripts/entrypoint.mjs --subject 数学 --knowledge-point 勾股定理 --question-type single_choice --difficulty 3 --mock',
    '  node scripts/entrypoint.mjs --text "生成一道初中数学勾股定理难度3选择题，需要配图" --mock',
    '  node scripts/entrypoint.mjs --serve --mock --port 8789',
    '  node scripts/entrypoint.mjs --tool generate_visual_question --input examples/request.json --mock',
    '',
    'Options:',
    '  --input PATH              JSON request path',
    '  --output PATH             write result JSON to path',
    '  --text TEXT               natural-language request',
    '  --subject TEXT',
    '  --grade-band TEXT',
    '  --knowledge-point TEXT    repeatable',
    '  --question-type TYPE      single_choice | multiple_choice | true_false | fill_blank | short_answer',
    '  --difficulty N            1-6',
    '  --count N',
    '  --content-mode MODE       text | diagram_optional | diagram_required',
    '  --strategy STRATEGY       direct | cot | react | dear | eqpr | evoq',
    '  --emit-prompt             output model prompt messages instead of generating',
    '  --agent NAME              emit prompt for a specific EDUQG agent role',
    '  --tool NAME               run an EDUQG agent tool by name',
    '  --mock                    run offline deterministic generator',
    '  --serve                   start HTTP API',
    '  --host HOST               default 127.0.0.1',
    '  --port PORT               default 8789',
  ].join('\n');
}

async function readJson(filePath) {
  const raw = await fs.readFile(path.resolve(process.cwd(), filePath), 'utf-8');
  return JSON.parse(raw);
}

function payloadFromArgs(args) {
  const payload = {};
  const text = getString(args, 'text');
  if (text) payload.text = text;
  const subject = getString(args, 'subject');
  if (subject) payload.subject = subject;
  const gradeBand = getString(args, 'grade-band') || getString(args, 'grade');
  if (gradeBand) payload.grade_band = gradeBand;
  const knowledgePoints = getArray(args, 'knowledge-point');
  if (knowledgePoints.length) payload.knowledge_points = knowledgePoints;
  const questionType = getString(args, 'question-type');
  if (questionType) payload.question_type = questionType;
  const difficulty = getString(args, 'difficulty');
  if (difficulty) payload.difficulty = difficulty;
  const count = getString(args, 'count');
  if (count) payload.count = Number(count);
  const contentMode = getString(args, 'content-mode');
  if (contentMode) payload.content_mode = contentMode;
  const strategy = getString(args, 'strategy');
  if (strategy) payload.strategy = strategy;
  const requirements = getString(args, 'requirements') || getString(args, 'extra-requirements');
  if (requirements) payload.extra_requirements = requirements;
  return payload;
}

async function loadPayload(args) {
  const input = getString(args, 'input');
  const cliPayload = payloadFromArgs(args);
  if (!input) return cliPayload;
  const filePayload = await readJson(input);
  return { ...filePayload, ...cliPayload };
}

async function writeResult(result, outputPath) {
  const text = `${JSON.stringify(result, null, 2)}\n`;
  if (!outputPath) {
    process.stdout.write(text);
    return;
  }
  const resolved = path.resolve(process.cwd(), outputPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, text, 'utf-8');
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath: resolved, status: result.status, itemCount: result.items?.length || 0 }, null, 2)}\n`);
}

async function readRequestJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(response, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-length': body.length,
  });
  response.end(body);
}

function openApiDocument(host, port) {
  const postTool = (description) => ({
    post: {
      description,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { 200: { description: 'JSON tool result' } },
    },
  });
  return {
    openapi: '3.1.0',
    info: { title: 'EDUQG Question Generation Agent', version: '1.0.0' },
    servers: [{ url: `http://${host}:${port}` }],
    paths: {
      '/health': { get: { responses: { 200: { description: 'OK' } } } },
      '/api/eduqg/generate': {
        post: {
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { 200: { description: 'eduqg-generation-result.v1' } },
        },
      },
      '/api/eduqg/validate': postTool('Validate edu-question-spec.v1 and return clarification when required fields are missing.'),
      '/api/eduqg/generate-visual': postTool('Generate an image-grounded question through visual-question-generator route.'),
      '/api/eduqg/run-evoq': postTool('Run EvoQ text-question generation route.'),
      '/api/eduqg/render-image': postTool('Render or return SVG diagrams for a generated question.'),
      '/api/eduqg/simulate-student-response': postTool('Simulate a likely student response.'),
      '/api/eduqg/evaluate-text': postTool('Evaluate a text question.'),
      '/api/eduqg/evaluate-visual': postTool('Evaluate a visual question and diagram consistency.'),
      '/api/eduqg/read-profile': postTool('Read teacher or student profile hints.'),
      '/api/eduqg/write-profile': postTool('Write teacher or student profile hints.'),
      '/api/eduqg/tools/{toolName}': postTool('Run an EDUQG agent tool by original OAH tool name.'),
      '/api/eduqg/prompts': { get: { responses: { 200: { description: 'All EDUQG agent prompt templates' } } } },
      '/api/eduqg/prompts/{agentName}': { get: { responses: { 200: { description: 'Prompt messages for one EDUQG agent' } } } },
    },
  };
}

const toolRoutes = new Map([
  ['/api/eduqg/validate', 'validate_question_spec'],
  ['/api/eduqg/generate', 'generate_eduqg_question'],
  ['/api/eduqg/generate-visual', 'generate_visual_question'],
  ['/api/eduqg/run-evoq', 'run_evoq_text_question'],
  ['/api/eduqg/render-image', 'render_question_image'],
  ['/api/eduqg/simulate-student-response', 'simulate_student_response'],
  ['/api/eduqg/evaluate-text', 'evaluate_text_question'],
  ['/api/eduqg/evaluate-visual', 'evaluate_visual_question'],
  ['/api/eduqg/read-profile', 'read_profile'],
  ['/api/eduqg/write-profile', 'write_profile'],
]);

function toolNameFromRequestUrl(url) {
  const pathname = new URL(url, 'http://127.0.0.1').pathname;
  if (toolRoutes.has(pathname)) return toolRoutes.get(pathname);
  const match = pathname.match(/^\/api\/eduqg\/tools\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function startServer(args) {
  const host = getString(args, 'host') || '127.0.0.1';
  const port = Number(getString(args, 'port') || 8789);
  const mock = hasFlag(args, 'mock');
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method === 'GET' && request.url === '/health') {
        sendJson(response, 200, { ok: true, skill: 'eduqg-question-generator', mode: mock ? 'mock' : 'live', skillDir });
        return;
      }
      if (request.method === 'GET' && request.url === '/openapi.json') {
        sendJson(response, 200, openApiDocument(host, port));
        return;
      }
      if (request.method === 'GET' && request.url === '/api/eduqg/prompts') {
        sendJson(response, 200, listAgentPromptTemplates());
        return;
      }
      if (request.method === 'GET' && request.url?.startsWith('/api/eduqg/prompts/')) {
        const agentName = decodeURIComponent(new URL(request.url, `http://${host}:${port}`).pathname.split('/').at(-1));
        sendJson(response, 200, {
          version: 'eduqg-agent-prompt.v1',
          status: 'completed',
          agent: agentName,
          prompt_messages: buildAgentPromptMessages(agentName, {}),
        });
        return;
      }
      const toolName = request.method === 'POST' ? toolNameFromRequestUrl(request.url) : '';
      if (toolName) {
        const payload = await readRequestJson(request);
        const result = await dispatchEduqgTool(toolName, payload, { mock });
        sendJson(response, result.status === 'failed' ? 500 : 200, result);
        return;
      }
      sendJson(response, 404, { error: 'not found' });
    } catch (error) {
      sendJson(response, 500, {
        version: 'eduqg-generation-result.v1',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  process.stdout.write(`EDUQG skill server listening on http://${host}:${port}\n`);
  process.stdout.write('POST /api/eduqg/generate\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (hasFlag(args, 'help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (hasFlag(args, 'serve')) {
    await startServer(args);
    return;
  }
  const payload = await loadPayload(args);
  const toolName = getString(args, 'tool');
  const agentName = getString(args, 'agent');
  const options = {
    mock: hasFlag(args, 'mock'),
    emitPrompt: hasFlag(args, 'emit-prompt'),
    agentName,
  };
  const result = toolName
    ? await dispatchEduqgTool(toolName, payload, options)
    : await generateEduqgResult(payload, options);
  await writeResult(result, getString(args, 'output'));
}

main().catch((error) => {
  const result = {
    version: 'eduqg-generation-result.v1',
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
});
