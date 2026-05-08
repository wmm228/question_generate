# AI Generators TS

This directory contains the TypeScript-side question generation implementation used by Tutor.

Current role:

- Provide the TS algorithm assets and multimodal helpers used by the Tutor AI question-generation pipeline
- Support `direct`, `cot`, `react`, `dear`, `eqpr`, and `evoq`
- Feed the OAH-backed runtime used by `/api/ai-question/generate`

This project is now TS-only on the Tutor side.

The active Tutor integration points are:

- [runtime.ts](/D:/tutor-tutor/tutor/src/services/ai-generate-runtime/runtime.ts)
- [strategies.ts](/D:/tutor-tutor/tutor/src/services/ai-generate-runtime/strategies.ts)
- [question-agent.ts](/D:/tutor-tutor/tutor/src/routes/question-agent.ts)

The authoritative business contract for question generation is not in this folder.
It lives in:

- [AGENTS.md](/D:/tutor-tutor/tutor/oah-runtimes/tutor-question-generation/AGENTS.md)
