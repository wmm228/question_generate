---
name: eduqg-question-generator
description: EDUQG 出题智能体的独立运行时。用于把教师出题需求归一化为 edu-question-spec.v1，并调用迁移后的出题工具链完成规格校验、图文题生成、EvoQ GA 文本题生成、图片渲染、学生模拟、文本/图文评估、画像读写、离线模拟生成、OpenAI 兼容实时生成和 HTTP 集成。
---

# EDUQG 出题工具

这个独立运行时用于把教师侧出题需求转换成 `edu-question-spec.v1`，调用迁移后的 EDUQG Agent 工具链，评估题目质量，并返回可被 EduNex 等网站直接展示的稳定 JSON 结果。

当前交付形态是“迁移后的出题 Agent + 确定性工具边界”：本目录包含 Agent 指令、schema、示例、CLI 运行时、HTTP 运行时、离线模拟生成器、画像存储和 OpenAI 兼容实时生成接口。

## 直接运行

在 `D:\tutor-tutor\skill-version` 下运行：

```bash
npm run check
npm run smoke
npm run serve -- --mock --port 8789
```

也可以在当前 skill 目录下运行：

```bash
node scripts/entrypoint.mjs --input examples/request.json --mock
node scripts/entrypoint.mjs --serve --mock --port 8789
```

`examples/request.json` 是中文课堂请求示例。文件内部使用 JSON unicode 转义，避免 Windows 代码页导致中文损坏。

## 工作流程

1. 将请求归一化为 `edu-question-spec.v1`。
   - 必填字段：`subject`、`knowledge_points`、`question_type`、`difficulty`。
   - 缺省时将 `count` 设为 `1`，`content_mode` 设为 `text`，`strategy` 设为 `direct`。
   - 如果必填字段缺失，在对话模式下提出一个简洁澄清问题，在工具模式下返回 `needs_clarification`。

2. 生成最终题目前确认出题合同。
   - 保留教师控制字段，不得悄悄改变学科、知识点、题型、难度或配图要求。
   - 需要精确字段定义时阅读 [references/spec.md](references/spec.md)。

3. 选择生成策略。
   - `direct`：普通文本题的快速生成。
   - `cot`：强调分步推理。
   - `react` 或 `dear`：用于需要检查、拆解或修订的任务。
   - `eqpr` 或 `evoq`：用于更重视质量和难度控制的任务。
   - `evoq` 接受 `evoq_config`、`evoq` 或 `ga` 配置，例如 `pop_size`、`generations`、`elite_ratio`、`lambda_ratio`、`selection_strategy` 和 `tournament_k`。

4. 只生成结构化题目。
   - 每道题必须包含题干、答案、解析、metadata 和 evaluation。
   - 选择题必须有唯一、可信的选项；除 `multiple_choice` 外，标准答案必须无歧义。
   - 图文题只有在图片参与作答或解释时才生成图片描述或 SVG。

5. 评估并修订。
   - 使用 [references/quality-rubric.md](references/quality-rubric.md)。
   - 如果结果可以局部修复，修订一到两轮。
   - 如果答案正确性、知识点匹配或图文一致性失败，拒绝并重新生成。

6. 返回最终结果。
   - 使用 `eduqg-generation-result.v1`。
   - 包含 `status`、`spec`、`items`、`evaluation_summary`，可选包含 `events`。
   - 作为工具调用时保持机器可读。

## CLI 工具

```bash
node scripts/entrypoint.mjs --input examples/request.json --emit-prompt
node scripts/entrypoint.mjs --input examples/request.json --mock
node scripts/entrypoint.mjs --tool generate_visual_question --input examples/request.json --mock
node scripts/entrypoint.mjs --tool run_evoq_text_question --input examples/request.json --mock
node scripts/entrypoint.mjs --tool list_agent_prompt_templates
node scripts/entrypoint.mjs --input examples/request.json --emit-prompt --agent visual-question-generator
node scripts/entrypoint.mjs --input examples/request.json --output out/result.json
```

## HTTP 工具

```bash
node scripts/entrypoint.mjs --serve --mock --port 8789
```

启动后调用：

```http
POST /api/eduqg/generate
Content-Type: application/json
```

迁移后的原 Agent 工具端点：

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

把适配器接入真实网站前，先阅读 [references/edunex-integration.md](references/edunex-integration.md)。

## 环境变量

实时生成需要配置 NVIDIA OpenAI 兼容的 chat-completions 接口：

```bash
set EDUQG_API_KEY=...
set EDUQG_API_URL=https://integrate.api.nvidia.com/v1/chat/completions
set EDUQG_MODEL=qwen/qwen3.5-397b-a17b
```

EvoQ IRT 虚拟学生模型列表在 `config/evoq-irt-student-models.json` 中配置。当前保留原 EvoQ 的 12 个 theta 数值和 prompt 类型，并把原 12 个学生模型替换为已在 Docker/OAH live smoke 中返回文本的 NVIDIA OAH modelRef：DeepSeek V4 Flash、Qwen3.5 397B、Qwen3 Next 80B 和 Ministral 14B。配置中的 `original_model` 记录原模型名，不再读取 Kimi、GLM、ERNIE、Spark、OpenAI 等旧接口或 key。

默认模式是离线 theta 模拟，保证本地测试不依赖 OAH 服务。设置 `EDUQG_IRT_ENSEMBLE_MODE=live` 后，学生模型会通过 OAH session/message/run API 调用当前配置的 `platform/*` modelRef。

EvoQ 默认参数也可以通过环境变量覆盖，例如 `EDUQG_EVOQ_POP_SIZE`、`EDUQG_EVOQ_GENERATIONS`、`EDUQG_EVOQ_ELITE_RATIO`、`EDUQG_EVOQ_LAMBDA_RATIO`、`EDUQG_EVOQ_SELECTION_STRATEGY` 和 `EDUQG_EVOQ_TOURNAMENT_K`。

不要在 skill、网站或提交到仓库的配置中硬编码供应商密钥。

## 输出规则

- 中文课堂语境下默认输出中文。
- 公式和符号尽量保持 Markdown 或 LaTeX 可渲染。
- 区分事实、假设、生成内容和评估结果。
- 需要配图的题目不能使用装饰图；图片必须包含与作答相关的信息。
- 不暴露隐藏推理链。`analysis` 字段只写面向学生的简明解析。

## 参考文件

- [references/spec.md](references/spec.md)：请求、响应、题目和事件 schema。
- [references/quality-rubric.md](references/quality-rubric.md)：评分维度和通过/修订/拒绝规则。
- [references/edunex-integration.md](references/edunex-integration.md)：网站/工具集成合同。
- [schemas/edu-question-spec.schema.json](schemas/edu-question-spec.schema.json)：请求 JSON schema。
- [schemas/eduqg-generation-result.schema.json](schemas/eduqg-generation-result.schema.json)：响应 JSON schema。
