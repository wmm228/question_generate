# EDUQG Schemas

This reference defines the stable data contract used by the standalone skill runtime.

## Request: edu-question-spec.v1

```json
{
  "version": "edu-question-spec.v1",
  "request_id": "optional-client-id",
  "locale": "zh-CN",
  "grade_band": "初中",
  "subject": "数学",
  "knowledge_points": ["勾股定理"],
  "curriculum_goal": "考查直角三角形边长关系",
  "question_type": "single_choice",
  "difficulty": 3,
  "count": 1,
  "content_mode": "diagram_required",
  "diagram": {
    "required": true,
    "position": "stem",
    "must_be_answer_relevant": true,
    "style": "clean_svg"
  },
  "strategy": "direct",
  "teacher_profile": {
    "style": "清晰、分步、适合课堂小测",
    "constraints": ["选项不要过长"]
  },
  "student_profile": {
    "level": "中等",
    "common_errors": ["混淆直角边和斜边"]
  },
  "source_material": "",
  "extra_requirements": "解析要分步骤"
}
```

Required fields:

- `subject`
- `knowledge_points`
- `question_type`
- `difficulty`

Recommended fields:

- `grade_band`
- `count`
- `content_mode`
- `strategy`
- `teacher_profile`
- `student_profile`

## Enumerations

`question_type`:

- `single_choice`
- `multiple_choice`
- `true_false`
- `fill_blank`
- `short_answer`

`difficulty`:

- Integer `1` to `6`.
- `1` is basic recognition.
- `3` is ordinary classroom practice.
- `6` is advanced synthesis or competition-like reasoning.

`content_mode`:

- `text`
- `diagram_optional`
- `diagram_required`

`diagram.position`:

- `stem`
- `options`
- `explanation`

`strategy`:

- `direct`
- `cot`
- `react`
- `dear`
- `eqpr`
- `evoq`

## Response: eduqg-generation-result.v1

```json
{
  "version": "eduqg-generation-result.v1",
  "status": "completed",
  "request_id": "optional-client-id",
  "spec": {},
  "items": [
    {
      "question_id": "q-1",
      "type": "single_choice",
      "stem": "题干文本",
      "options": [
        { "label": "A", "text": "选项 A" },
        { "label": "B", "text": "选项 B" },
        { "label": "C", "text": "选项 C" },
        { "label": "D", "text": "选项 D" }
      ],
      "answer": "B",
      "analysis": "分步解析",
      "diagrams": [
        {
          "id": "fig-1",
          "position": "stem",
          "description": "直角三角形 ABC，AC=6，BC=8，角 C 为直角",
          "svg": ""
        }
      ],
      "metadata": {
        "subject": "数学",
        "knowledge_points": ["勾股定理"],
        "difficulty": 3,
        "strategy": "direct"
      },
      "evaluation": {
        "score": 90,
        "status": "pass",
        "issues": []
      }
    }
  ],
  "evaluation_summary": {
    "score": 90,
    "status": "pass",
    "needs_human_review": false
  },
  "events": [
    { "stage": "request", "message": "request accepted" },
    { "stage": "generate", "message": "items generated" },
    { "stage": "evaluate", "message": "quality checked" },
    { "stage": "done", "message": "completed" }
  ]
}
```

`status` values:

- `needs_clarification`
- `completed`
- `failed`

`evaluation.status` values:

- `pass`
- `revise`
- `reject`

## Clarification Response

Return this shape when a required field is absent:

```json
{
  "version": "eduqg-generation-result.v1",
  "status": "needs_clarification",
  "missing_fields": ["question_type"],
  "questions": ["请补充题型，例如 single_choice、true_false 或 short_answer。"]
}
```

## Stream Events

When a host platform supports SSE or WebSocket progress events, emit these stages:

- `request`: request accepted and normalized
- `plan`: generation plan created
- `generate`: candidate items generated
- `evaluate`: quality evaluation running
- `revise`: candidate revised after evaluation
- `render`: optional diagram or final display rendering
- `done`: final result ready
- `error`: unrecoverable failure
