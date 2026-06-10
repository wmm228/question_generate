---
name: eduqg-question-generator
description: Standalone runtime for the migrated EDUQG question-generation agent. Use to run the original EDUQG agent tool chain for teacher requirement normalization, spec validation, visual question generation, EvoQ text generation, image rendering, student simulation, text/visual evaluation, profile read/write, mock generation, OpenAI-compatible live generation, and HTTP integration.
---

# EDUQG Question Generator

Use this standalone runtime to turn teacher-facing question-generation requirements into `edu-question-spec.v1`, run the migrated EDUQG agent tools, evaluate question quality, and return a stable JSON result that can be displayed by a website such as EduNex.

The product shape is the migrated question-generation agent plus a deterministic tool boundary: this folder includes the agent instructions, schemas, examples, CLI runtime, HTTP runtime, mock generator, profile store, and OpenAI-compatible live generator.

## Direct Run

Run from `D:\tutor-tutor\skill-version`:

```bash
npm run check
npm run smoke
npm run serve -- --mock --port 8789
```

Run from this skill folder:

```bash
node scripts/entrypoint.mjs --input examples/request.json --mock
node scripts/entrypoint.mjs --serve --mock --port 8789
```

Use `examples/request.json` for a Chinese classroom request sample. The file uses JSON unicode escapes so it is stable across Windows code pages.

## Workflow

1. Normalize the request into `edu-question-spec.v1`.
   - Required fields: `subject`, `knowledge_points`, `question_type`, `difficulty`.
   - Default `count` to `1`, `content_mode` to `text`, and `strategy` to `direct` when absent.
   - If a required field is missing, ask one concise clarification or return `needs_clarification` in tool mode.

2. Confirm the generation contract before creating final questions.
   - Preserve teacher-controlled fields; do not silently change subject, knowledge point, question type, difficulty, or diagram requirement.
   - Read [references/spec.md](references/spec.md) when exact request/response fields are needed.

3. Select the generation strategy.
   - `direct`: fast generation for ordinary text questions.
   - `cot`: emphasize step-by-step reasoning.
   - `react` or `dear`: use when the task needs checking, decomposition, or revision.
   - `eqpr` or `evoq`: use when quality and difficulty control matter more than speed.

4. Generate structured items only.
   - Each item must include stem, answer, explanation, metadata, and evaluation.
   - Choice questions must have unique, plausible options and a single unambiguous answer unless the type is `multiple_choice`.
   - Diagram questions must include a diagram description or SVG only when the diagram contributes to solving or explaining the item.

5. Evaluate and revise.
   - Use [references/quality-rubric.md](references/quality-rubric.md).
   - Revise once or twice when the result is fixable.
   - Reject and regenerate when answer correctness, knowledge-point alignment, or diagram consistency fails.

6. Return the final result.
   - Use `eduqg-generation-result.v1`.
   - Include `status`, `spec`, `items`, `evaluation_summary`, and optional `events`.
   - Keep the response machine-readable when used as a tool.

## CLI Tool

```bash
node scripts/entrypoint.mjs --input examples/request.json --emit-prompt
node scripts/entrypoint.mjs --input examples/request.json --mock
node scripts/entrypoint.mjs --tool generate_visual_question --input examples/request.json --mock
node scripts/entrypoint.mjs --tool run_evoq_text_question --input examples/request.json --mock
node scripts/entrypoint.mjs --tool list_agent_prompt_templates
node scripts/entrypoint.mjs --input examples/request.json --emit-prompt --agent visual-question-generator
node scripts/entrypoint.mjs --input examples/request.json --output out/result.json
```

## HTTP Tool

```bash
node scripts/entrypoint.mjs --serve --mock --port 8789
```

Then call:

```http
POST /api/eduqg/generate
Content-Type: application/json
```

Original migrated agent tool endpoints:

```http
POST /api/eduqg/validate
POST /api/eduqg/generate-visual
POST /api/eduqg/run-evoq
POST /api/eduqg/render-image
POST /api/eduqg/simulate-student-response
POST /api/eduqg/evaluate-text
POST /api/eduqg/evaluate-visual
POST /api/eduqg/read-profile
POST /api/eduqg/write-profile
POST /api/eduqg/tools/{toolName}
GET /api/eduqg/prompts
GET /api/eduqg/prompts/{agentName}
```

Read [references/edunex-integration.md](references/edunex-integration.md) before wiring the adapter into a real site.

## Environment

For live generation, configure an OpenAI-compatible chat-completions endpoint:

```bash
set EDUQG_API_KEY=...
set EDUQG_API_URL=https://api.openai.com/v1/chat/completions
set EDUQG_MODEL=gpt-4o-mini
```

Do not hard-code provider keys in the skill, the website, or checked-in config.

## Output Rules

- Prefer Chinese output by default for Chinese classroom contexts.
- Keep formulas and symbols renderable in Markdown or LaTeX when possible.
- Separate facts, assumptions, generated content, and evaluation results.
- Never use decorative images for required diagram questions; diagrams must carry task-relevant information.
- Do not expose hidden chain-of-thought. Provide concise solution steps in `analysis`.

## References

- [references/spec.md](references/spec.md): exact request, response, item, and event schemas.
- [references/quality-rubric.md](references/quality-rubric.md): scoring dimensions and pass/fail rules.
- [references/edunex-integration.md](references/edunex-integration.md): website/tool integration contract.
- [schemas/edu-question-spec.schema.json](schemas/edu-question-spec.schema.json): request JSON schema.
- [schemas/eduqg-generation-result.schema.json](schemas/eduqg-generation-result.schema.json): response JSON schema.
