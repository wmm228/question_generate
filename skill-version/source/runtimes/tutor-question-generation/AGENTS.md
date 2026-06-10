# Tutor Question Generation Runtime

This runtime is dedicated to the migrated EDUQG question-generation agent.

The contract below follows the original Tutor question-generation agent contract from `oah-deploy-root`, while pointing to the standalone runtime in `skill-version`. Runtime prompts, tool configs, HTTP adapters, and platform integration should align to this contract.

## Machine-Readable Contract

```json
{
  "spec_version": "edu-question-spec.v1",
  "runtime_id": "tutor-question-generation",
  "main_agent": "question-orchestrator",
  "subagents": [
    "spec-normalizer",
    "intent-recognizer",
    "text-question-generator",
    "visual-question-generator",
    "text-question-evaluator",
    "visual-question-evaluator",
    "student-simulator",
    "profile-evolution"
  ],
  "tools": [
    "validate_question_spec",
    "generate_visual_question",
    "run_evoq_text_question",
    "render_question_image",
    "simulate_student_response",
    "evaluate_text_question",
    "evaluate_visual_question",
    "read_profile",
    "write_profile"
  ],
  "tool_service": {
    "name": "eduqg-question-generation-agent",
    "base_url": "http://127.0.0.1:8789",
    "health": "GET /health",
    "openapi": "GET /openapi.json",
    "validate_question_spec": "POST /api/eduqg/validate",
    "generate_visual_question": "POST /api/eduqg/generate-visual",
    "run_evoq_text_question": "POST /api/eduqg/run-evoq",
    "render_question_image": "POST /api/eduqg/render-image",
    "simulate_student_response": "POST /api/eduqg/simulate-student-response",
    "evaluate_text_question": "POST /api/eduqg/evaluate-text",
    "evaluate_visual_question": "POST /api/eduqg/evaluate-visual",
    "read_profile": "POST /api/eduqg/read-profile",
    "write_profile": "POST /api/eduqg/write-profile",
    "compatibility_generate": "POST /api/eduqg/generate",
    "generic_tool_dispatch": "POST /api/eduqg/tools/{toolName}"
  },
  "runtime_candidates": [
    "question-tutor",
    "tutor-question-generation",
    "eduqg-integrated"
  ],
  "human_controlled_fields": [
    "subject",
    "knowledge_point",
    "knowledge_points",
    "difficulty",
    "question_type",
    "content_mode",
    "algorithm",
    "strategy",
    "image_requirement",
    "diagram"
  ],
  "agent_controlled_fields": [
    "generation_plan",
    "draft_wording",
    "solution_steps",
    "evaluation_notes",
    "suggested_profile_updates"
  ],
  "explicit_confirmation_requirements": [
    {
      "field": "subject",
      "when": "always",
      "message": "Teacher must explicitly confirm subject before generation."
    },
    {
      "field": "knowledge_point",
      "when": "always",
      "message": "Teacher must explicitly confirm knowledge_point before generation."
    },
    {
      "field": "difficulty",
      "when": "always",
      "message": "Teacher must explicitly confirm difficulty before generation."
    },
    {
      "field": "question_type",
      "when": "always",
      "message": "Teacher must explicitly confirm question_type before generation."
    },
    {
      "field": "content_mode",
      "when": "always",
      "message": "Teacher must explicitly confirm content_mode before generation."
    },
    {
      "field": "algorithm",
      "when": "always",
      "message": "Teacher must explicitly confirm algorithm before generation."
    },
    {
      "field": "image_requirement",
      "when": "image_only",
      "message": "Teacher must explicitly confirm image targets or image placement for image questions."
    }
  ],
  "human_controlled_rules": [
    "Question type, content mode, difficulty, image targets, and generation algorithm must be explicit before generation.",
    "AI may suggest missing fields, but may not silently change teacher-selected subject, difficulty, algorithm, question type, content mode, or image requirement.",
    "Generated output must be schema-validated before it is shown to the user.",
    "Image questions must contain answer-relevant visual information, not decorative images.",
    "Teacher profile and student profile are context signals; they do not override explicit request fields."
  ],
  "decision_rules": [
    "Use question-orchestrator when the teacher request is incomplete or preferences need to be elicited.",
    "Use spec-normalizer to convert teacher intent into edu-question-spec.v1 and identify missing fields.",
    "Use intent-recognizer to decide whether the current turn authorizes immediate generation.",
    "Use generator agents when the spec is complete and confirmed.",
    "Use evaluator agents after generation; block final display when required schema fields or image relevance checks fail.",
    "Use deterministic tools when the operation has stable input/output, such as spec validation, EvoQ execution, image rendering, or profile persistence."
  ],
  "validation_rules": [
    "Text questions cannot contain image targets.",
    "Image questions must include at least one image target and must require answer-relevant visual content.",
    "Multiple-choice questions must produce exactly four options and one ground-truth option key.",
    "AI output must be parsed and schema-validated before display."
  ],
  "tool_routing": {
    "shared": [
      "validate_question_spec",
      "read_profile",
      "write_profile",
      "simulate_student_response"
    ],
    "by_content_mode": {
      "text": {
        "generator_agent": "text-question-generator",
        "evaluator_agent": "text-question-evaluator",
        "generator_tools": [],
        "evaluator_tools": [
          "evaluate_text_question"
        ]
      },
      "image": {
        "generator_agent": "visual-question-generator",
        "evaluator_agent": "visual-question-evaluator",
        "generator_tools": [
          "generate_visual_question",
          "render_question_image"
        ],
        "evaluator_tools": [
          "evaluate_visual_question"
        ]
      }
    },
    "by_algorithm": {
      "direct": [],
      "cot": [],
      "react": [],
      "dear": [],
      "eqpr": [],
      "evoq": [
        "run_evoq_text_question"
      ]
    }
  },
  "final_response_contract": {
    "version": "eduqg-generation-result.v1",
    "required_fields": [
      "spec",
      "items",
      "evaluation_summary"
    ],
    "legacy_required_fields": [
      "question",
      "solution_steps",
      "ground_truth"
    ],
    "item_required_fields": [
      "question_id",
      "type",
      "stem",
      "answer",
      "analysis",
      "metadata",
      "evaluation"
    ],
    "image_additional_fields": [
      "image_position",
      "image_code",
      "diagrams[].position",
      "diagrams[].description",
      "diagrams[].svg"
    ],
    "multiple_choice_option_count": 4,
    "multiple_choice_ground_truth_format": "A | B | C | D",
    "single_choice_option_count": 4,
    "single_choice_answer_format": "A | B | C | D",
    "true_false_ground_truth_values": [
      "正确",
      "错误",
      true,
      false
    ]
  }
}
```

## Agent Roles

- `question-orchestrator`: talk with the teacher, confirm the teacher-controlled spec, and route work.
- `spec-normalizer`: turn teacher intent into `edu-question-spec.v1` and identify missing fields.
- `intent-recognizer`: classify whether the current turn authorizes immediate question generation after the spec has been normalized.
- `text-question-generator`: generate text-only questions.
- `visual-question-generator`: generate image-grounded questions and diagram code.
- `text-question-evaluator`: evaluate text-only questions.
- `visual-question-evaluator`: evaluate image questions, image relevance, and render safety.
- `student-simulator`: simulate likely student responses and misconceptions.
- `profile-evolution`: read/write teacher and student profile hints for personalization.

Human-controlled fields must come from the teacher or business request, not from AI: subject, knowledge point, difficulty, question type, content mode, algorithm, and image requirement.

The standalone service in `skill-version` supplies the deterministic tool boundary for this runtime. A host platform is still responsible for final API authentication, persistence policy, request logging, and production model configuration.
