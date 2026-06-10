---
name: eduqg-question-generator
description: OAH reusable skill package for the migrated EDUQG question-generation agent. Use inside the tutor-question-generation runtime when an OAH agent needs the original EDUQG tools for spec validation, visual generation, EvoQ text generation, image rendering, question evaluation, student simulation, profile read/write, or eduqg-generation-result.v1 output.
---

# EDUQG Question Generator

Use this skill inside the OAH `tutor-question-generation` runtime.

## Runtime

Read `source/runtimes/tutor-question-generation/AGENTS.md` for the main agent, subagent, tool routing, and final response contract.

## Tool Service

The standalone implementation is in `eduqg-question-generator/`.

Start it locally:

```bash
node eduqg-question-generator/scripts/entrypoint.mjs --serve --mock --port 8789
```

Call:

```http
POST http://127.0.0.1:8789/api/eduqg/tools/{toolName}
Content-Type: application/json
```

Original migrated agent tools:

- `validate_question_spec`
- `generate_visual_question`
- `run_evoq_text_question`
- `render_question_image`
- `simulate_student_response`
- `evaluate_text_question`
- `evaluate_visual_question`
- `read_profile`
- `write_profile`

Prompt templates are available for `question-orchestrator` plus all 8 subagents. Inspect them with:

```http
GET http://127.0.0.1:8789/api/eduqg/prompts
GET http://127.0.0.1:8789/api/eduqg/prompts/visual-question-generator
```

## Agent Rules

- Do not silently change teacher-controlled fields.
- Ask for missing `subject`, `knowledge_point` or `knowledge_points`, `question_type`, or `difficulty`.
- Route image questions through `generate_visual_question` and `render_question_image`.
- Route EvoQ text questions through `run_evoq_text_question`.
- Evaluate generated items with `evaluate_text_question` or `evaluate_visual_question`.
- Treat returned `needs_human_review` as a signal to show review notes or route to an evaluator.
- Do not expose hidden chain-of-thought; return student-facing `analysis`.
