# Tutor 出题智能体运行时

本运行时用于 Tutor 的智能出题流程。出题合同以本文档中的机器可读 JSON 块为唯一准则；TypeScript 服务、OAH 智能体提示词和 skill-version 封装都必须与这里保持一致，避免在其他位置重复维护业务规则。

## 机器可读合同

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
  "routing_model": {
    "order": [
      "content_mode",
      "algorithm"
    ],
    "content_modes": [
      "text",
      "image"
    ],
    "algorithms": [
      "direct",
      "cot",
      "react",
      "dear",
      "eqpr",
      "evoq"
    ],
    "oah_agent_surface": "functional_agents"
  },
  "algorithm_routes": {
    "direct": {
      "strategy": "direct",
      "required_tools": [],
      "requires_student_simulation": false
    },
    "cot": {
      "strategy": "cot",
      "required_tools": [],
      "requires_student_simulation": false
    },
    "react": {
      "strategy": "react",
      "required_tools": [],
      "requires_student_simulation": false
    },
    "dear": {
      "strategy": "dear",
      "required_tools": [],
      "requires_student_simulation": false
    },
    "eqpr": {
      "strategy": "eqpr",
      "required_tools": [],
      "requires_student_simulation": false
    },
    "evoq": {
      "strategy": "evoq",
      "required_tools": [
        "run_evoq_text_question",
        "simulate_student_response"
      ],
      "requires_student_simulation": true
    }
  },
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
    "base_url": "http://eduqg-tool:8789",
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
    "evoq_config",
    "irt_simulation_parameters",
    "suggested_profile_updates"
  ],
  "explicit_confirmation_requirements": [
    {
      "field": "subject",
      "when": "always",
      "message": "生成前教师必须明确确认学科。"
    },
    {
      "field": "knowledge_point",
      "when": "always",
      "message": "生成前教师必须明确确认知识点。"
    },
    {
      "field": "difficulty",
      "when": "always",
      "message": "生成前教师必须明确确认难度。"
    },
    {
      "field": "question_type",
      "when": "always",
      "message": "生成前教师必须明确确认题型。"
    },
    {
      "field": "content_mode",
      "when": "always",
      "message": "生成前教师必须明确确认内容模式。"
    },
    {
      "field": "algorithm",
      "when": "always",
      "message": "生成前教师必须明确确认生成算法。"
    },
    {
      "field": "image_requirement",
      "when": "image_only",
      "message": "图文题生成前教师必须明确确认配图位置或配图目标。"
    }
  ],
  "human_controlled_rules": [
    "题型、内容模式、难度、配图目标和生成算法必须在生成前明确。",
    "AI 可以建议补充缺失字段，但不能悄悄改动教师已选择的学科、难度、算法、题型、内容模式或配图要求。",
    "生成结果展示给用户前必须完成 schema 校验。",
    "图文题必须包含参与作答的有效视觉信息，不能只生成装饰性图片。",
    "教师画像和学生画像只是上下文信号，不能覆盖教师明确提出的请求字段。",
    "evoq_config 只控制 EvoQ 的 GA 执行参数，不能改变教师已确认的学科、知识点、难度、题型、内容模式或算法。",
    "学生模拟必须把 student_profile、题目 metadata 或工具 payload 中的 EvoQ Rasch/1PL IRT theta 和 difficulty_b 参数传入 simulate_student_response，并返回 EvoQ IRT 虚拟学生模型组。"
  ],
  "decision_rules": [
    "当教师请求不完整或需要继续澄清偏好时，使用 question-orchestrator。",
    "使用 spec-normalizer 将教师意图转换为 edu-question-spec.v1，并识别缺失字段。",
    "使用 intent-recognizer 判断当前轮是否已经授权立即生成题目。",
    "当出题规格完整且已确认时，使用 generator 类智能体生成题目。",
    "生成后使用 evaluator 类智能体评估；当 schema 必填字段或图片相关性检查失败时，阻止最终展示。",
    "对输入输出稳定的操作使用确定性工具，例如规格校验、EvoQ 执行、图片渲染或画像读写。"
  ],
  "validation_rules": [
    "纯文本题不能包含配图目标。",
    "图文题必须至少包含一个配图目标，并要求图片内容与作答相关。",
    "单选题必须生成 4 个选项，并且只有一个标准答案选项键。",
    "AI 输出展示前必须完成解析和 schema 校验。",
    "algorithm=evoq 时，必须使用 EvoQ Rasch/1PL IRT 字段：ability_theta/theta、difficulty_b/b、probability_correct = sigmoid(theta - difficulty_b)，并返回配置中的虚拟学生模型响应 evoq_irt_ensemble。"
  ],
  "tool_routing": {
    "shared": [
      "validate_question_spec"
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
        "run_evoq_text_question",
        "simulate_student_response"
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

## 架构说明

本运行时按 OAH 原生结构工作：真实 OAH agent 定义在 `.openharness/agents/*.md`，算法不是额外伪造的 OAH agent 文件，而是生成阶段的策略路由。

- 主智能体：`question-orchestrator` 负责教师对话、字段抽取、画像/spec ready gating 和路由。
- OAH 功能子智能体：`spec-normalizer`、`intent-recognizer`、文本/图文生成器、文本/图文评估器、`student-simulator`、`profile-evolution` 保留为运行时分工。
- 算法策略：`direct`、`cot`、`react`、`dear`、`eqpr`、`evoq` 是核心生成路线，由 `routing_model` 和 `algorithm_routes` 描述，不再写成不存在的算法 OAH agent 名。
- 路由顺序固定为：先按 `content_mode` 进入文本或图文生成/评估，再按 `algorithm` 选择生成策略。
- `algorithm=evoq` 必须调用 `simulate_student_response`，学生模拟是 EvoQ 出题路径的一部分。
- 画像持久化仍由 Tutor 产品流的 `portrait_id` 和 portrait store 落地；独立 OAH/skill 服务保留 `read_profile`/`write_profile` 作为工具接口。

8 个 `subagents` 和 9 个工具名是 OAH 运行能力清单，不代表前端或产品层需要暴露 8 个入口，也不代表每次出题都会全部调用。当前减重目标是收口合同和文档口径，不删除六算法、画像 ready gating、EvoQ 学生模拟或现有工具服务。
教师控制字段必须来自教师请求、业务请求或业务默认值，不能由画像推断覆盖：学科、知识点、难度、题型、内容模式、算法和配图要求。
记忆模型：

- `session_memory` 是当前对话的长期压缩状态。
- 最近消息是当前轮理解的短期上下文。
- 教师画像和学生画像是稳定画像信号，不属于对话记忆。

调用本运行时的服务负责最终 API 校验、渲染、持久化和请求日志。
