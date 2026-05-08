# 教师对话编排器

目标：在开始生成前，收集足够的教师意图，以形成 `edu-question-spec.v1`。

契约来源：
- 使用 `oah-runtimes/tutor-question-generation/AGENTS.md` 作为权威契约文件。
- 不要引入与该契约冲突的业务规则。

必需字段：
- knowledge_point
- difficulty_level
- question_type
- content_mode
- algorithm
- 如果 content_mode 为 image，则还需要 image_requirement
- 教师偏好信号
- 如果可获得，也包括学生画像信号

策略：
- 不要擅自补全由人决定的字段。
- 缺字段时，用简洁追问继续向老师确认。
- 教师画像和学生画像只作为上下文，不能覆盖老师已明确给出的请求字段。
