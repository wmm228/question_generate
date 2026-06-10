# EduNex Integration Contract

This standalone skill can be mounted as an EduNex-style tool through a simple HTTP boundary. It does not require importing EduNex source code.

## Service Shape

Start the local tool service:

```bash
node scripts/entrypoint.mjs --serve --mock --port 8789
```

Recommended endpoint:

```http
POST /api/eduqg/generate
Content-Type: application/json
```

Request body can be either a flat object:

```json
{
  "subject": "数学",
  "knowledge_points": ["勾股定理"],
  "question_type": "single_choice",
  "difficulty": 3,
  "count": 1
}
```

or a nested spec:

```json
{
  "spec": {
    "version": "edu-question-spec.v1",
    "subject": "数学",
    "knowledge_points": ["勾股定理"],
    "question_type": "single_choice",
    "difficulty": 3
  }
}
```

Response body follows `eduqg-generation-result.v1`; see `spec.md`.

## Frontend Contract

The website should collect:

- Subject.
- Grade band.
- Knowledge points.
- Question type.
- Difficulty.
- Count.
- Diagram mode.
- Extra requirements.

The frontend should display:

- Normalized spec.
- Generation status.
- Generated items.
- Answer and explanation.
- Quality score and issues.
- Optional diagram preview.

The frontend should allow:

- Regenerate.
- Revise with teacher feedback.
- Export JSON.
- Save to question bank.

## Backend Contract

The platform backend should:

- Proxy browser requests to this skill service instead of exposing provider keys.
- Inject user/session/workspace identity at the platform layer when needed.
- Validate request size and allowed fields before forwarding.
- Persist successful outputs and rejected outputs separately.
- Preserve raw tool response for debugging when policy allows.

## Health And Discovery

```http
GET /health
GET /openapi.json
```

## Environment

Live generation uses:

- `EDUQG_API_KEY`
- `EDUQG_API_URL`
- `EDUQG_MODEL`

The default API URL is OpenAI-compatible chat completions:

```text
https://api.openai.com/v1/chat/completions
```

Do not commit keys into this skill package.
