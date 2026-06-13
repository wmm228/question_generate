# Tutor 出题智能体运行时

本运行时用于 Tutor 的智能出题流程。出题合同以本文档中的机器可读 JSON 块为唯一准则；TypeScript 服务和 OAH 智能体提示词必须与这里保持一致，避免在其他位置重复维护业务规则。

## 机器可读合同

```json
{
  "spec_version": "edu-question-spec.v1",
  "runtime_id": "tutor-question-generation",
  "main_agent": "question-orchestrator",
  "subagents": [
    "question-generator",
    "question-evaluator",
    "student-simulator"
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
      "required_capabilities": [],
      "requires_student_simulation": false
    },
    "cot": {
      "strategy": "cot",
      "required_capabilities": [],
      "requires_student_simulation": false
    },
    "react": {
      "strategy": "react",
      "required_capabilities": [],
      "requires_student_simulation": false
    },
    "dear": {
      "strategy": "dear",
      "required_capabilities": [],
      "requires_student_simulation": false
    },
    "eqpr": {
      "strategy": "eqpr",
      "required_capabilities": [],
      "requires_student_simulation": false
    },
    "evoq": {
      "strategy": "evoq",
      "required_capabilities": [
        "evoq_generation",
        "evoq_student_simulation"
      ],
      "requires_student_simulation": true
    }
  },
  "content_mode_routes": {
    "text": {
      "generator_agent": "question-generator",
      "evaluator_agent": "question-evaluator",
      "generation_capabilities": [
        "text_generation"
      ],
      "evaluation_capabilities": [
        "text_evaluation"
      ]
    },
    "image": {
      "generator_agent": "question-generator",
      "evaluator_agent": "question-evaluator",
      "generation_capabilities": [
        "visual_generation"
      ],
      "evaluation_capabilities": [
        "visual_evaluation"
      ]
    }
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
    "algorithm=evoq 时，student-simulator 必须使用 student_profile、题目 metadata 或任务 payload 中的 EvoQ Rasch/1PL IRT theta 和 difficulty_b 参数，并返回 EvoQ IRT 虚拟学生模型组。"
  ],
  "decision_rules": [
    "当教师请求不完整或需要继续澄清偏好时，由 question-orchestrator 继续对话并更新画像/spec。",
    "question-orchestrator 负责将教师意图转换为 edu-question-spec.v1，并识别缺失字段。",
    "question-orchestrator 负责判断当前轮是否已经授权立即生成题目。",
    "当出题规格完整且已确认时，使用 question-generator 生成题目。",
    "生成后使用 question-evaluator 评估；当 schema 必填字段或图片相关性检查失败时，阻止最终展示。",
    "algorithm=evoq 时必须使用 student-simulator 做 EvoQ IRT 学生模拟。"
  ],
  "validation_rules": [
    "纯文本题不能包含配图目标。",
    "图文题必须至少包含一个配图目标，并要求图片内容与作答相关。",
    "单选题必须生成 4 个选项，并且只有一个标准答案选项键。",
    "AI 输出展示前必须完成解析和 schema 校验。",
    "algorithm=evoq 时，必须使用 EvoQ Rasch/1PL IRT 字段：ability_theta/theta、difficulty_b/b、probability_correct = sigmoid(theta - difficulty_b)，并返回虚拟学生模型响应 evoq_irt_ensemble。"
  ],
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

本运行时按 OAH 原生结构工作：真实 OAH agent 定义在 `.openharness/agents/*.md`。Tutor agent 不 import 或调用外部 skill/tool。

- 主智能体：`question-orchestrator` 负责教师对话、字段抽取、画像/spec ready gating 和路由。
- OAH 子智能体：`question-generator`、`question-evaluator`、`student-simulator`。
- 算法策略：`direct`、`cot`、`react`、`dear`、`eqpr`、`evoq` 是核心生成路线，由 `routing_model` 和 `algorithm_routes` 描述。
- 路由顺序固定为：先按 `content_mode` 进入文本或图文生成/评估，再按 `algorithm` 选择生成策略。
- `algorithm=evoq` 必须使用 `student-simulator`，学生模拟是 EvoQ 出题路径的一部分。
- 画像持久化由 Tutor 后端 `portrait_id` 和 portrait store 落地，不通过 skill tool 读写。

当前减重目标是 agent 独立和 OAH 角色收口：1 个主智能体 + 3 个子智能体。不删除六算法、画像 ready gating 或 EvoQ 学生模拟。
教师控制字段必须来自教师请求、业务请求或业务默认值，不能由画像推断覆盖：学科、知识点、难度、题型、内容模式、算法和配图要求。
记忆模型：

- `session_memory` 是当前对话的长期压缩状态。
- 最近消息是当前轮理解的短期上下文。
- 教师画像和学生画像是稳定画像信号，不属于对话记忆。

调用本运行时的服务负责最终 API 校验、渲染、持久化和请求日志。
