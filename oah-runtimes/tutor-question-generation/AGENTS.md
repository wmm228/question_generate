# Tutor Question Generation Runtime

This workspace is dedicated to AI question generation for Tutor.

The single source of truth for the question-generation contract is the machine-readable JSON block in this file.
TypeScript services and OAH agent prompts must align to this file instead of maintaining duplicated business rules elsewhere.

## Machine-Readable Contract
```json
{
  "spec_version": "edu-question-spec.v1",
  "main_agent": "question-orchestrator",
  "subagents": [
    "spec-normalizer",
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
  "runtime_candidates": [
    "question-tutor",
    "tutor-question-generation",
    "eduqg-integrated"
  ],
  "human_controlled_fields": [
    "subject",
    "knowledge_point",
    "difficulty",
    "question_type",
    "content_mode",
    "algorithm",
    "image_requirement"
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
    "AI may suggest missing fields, but may not silently change teacher-selected subject, difficulty, algorithm, or image requirement.",
    "Generated output must be schema-validated before it is shown to the user.",
    "Image questions must contain answer-relevant visual information, not decorative images.",
    "Teacher profile and student profile are context signals; they do not override explicit request fields."
  ],
  "decision_rules": [
    "Use the dialogue orchestrator when the teacher request is incomplete or preferences need to be elicited.",
    "Use a subagent when the task requires domain judgment, multi-step iteration, or evaluation against educational criteria.",
    "Use a tool when the operation has deterministic input/output, such as schema validation, EvoQ execution, Manim rendering, or profile persistence.",
    "Treat text and visual generation as separate generator agents because they have different schemas, validators, and failure modes.",
    "Run evaluator agents after generation; block final display when required schema fields or image relevance checks fail."
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
    "required_fields": [
      "question",
      "solution_steps",
      "ground_truth"
    ],
    "image_additional_fields": [
      "image_position",
      "image_code"
    ],
    "multiple_choice_option_count": 4,
    "multiple_choice_ground_truth_format": "A | B | C | D",
    "true_false_ground_truth_values": [
      "正确",
      "错误"
    ]
  }
}
```

The runtime uses a main-orchestrator / subagent architecture:
- `question-orchestrator` talks with the teacher, confirms the teacher-controlled spec, and routes work.
- `spec-normalizer` turns teacher intent into `edu-question-spec.v1` and identifies missing fields.
- `text-question-generator` generates text-only questions.
- `visual-question-generator` generates image-grounded questions and Manim code.
- `text-question-evaluator` evaluates text-only questions.
- `visual-question-evaluator` evaluates image questions, image relevance, and Manim render safety.
- `student-simulator` and `profile-evolution` provide optional personalization/profile signals.

Human-controlled fields must come from the teacher/business request, not from AI: subject, knowledge point, difficulty, question type, content mode, algorithm, and image requirement.

The service calling this runtime is responsible for final API validation, rendering, persistence, and request logging.
