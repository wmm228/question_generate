---
name: eduqg-question-generator
description: EDUQG 出题 Skill。用于把教师出题需求归一化为 edu-question-spec.v1，并生成可校验的结构化课堂题目；支持文本题、答案相关图文/SVG 题、EvoQ GA 候选优化、质量评估、离线 mock、本地 HTTP 服务和 OAH 工具调用。
---

# EDUQG 出题 Skill

本目录是标准 Skill 根目录。外层 `skill-version` 是工程容器，用于测试、OAH 镜像源和打包；`source/skills/eduqg-question-generator/SKILL.md` 只是 OAH 部署索引副本，不是完整可运行 skill。

## 默认用法

在外层工程目录运行验证和干净导出：

```bash
npm run check
npm run smoke
npm run check:oah
npm run export:skill
```

在当前 skill 目录直接运行：

```bash
node scripts/entrypoint.mjs --input examples/request.json --mock
node scripts/entrypoint.mjs --text "生成一道初中数学勾股定理难度3选择题，需要配图" --mock
node scripts/entrypoint.mjs --serve --mock --port 8789
```

正式交付时优先使用 `npm run export:skill` 生成的 `dist/eduqg-question-generator`。不要把 `.npm-cache/`、`out/`、日志或本地运行产物放进交付包。

## 核心流程

Tutor 对话画像主流程必须按顺序执行：从教师对话抽取字段，更新 `portrait/profile`，归一化为 `edu-question-spec.v1`；如果画像或 spec 不是 `ready`，继续追问缺失项；只有画像完整且教师明确要求生成时，才调用出题算法。生成后把题目和后续画像更新写回画像记录。

1. 将教师需求归一化为 `edu-question-spec.v1`。
   - 必填字段：`subject`、`knowledge_points`、`question_type`、`difficulty`。
   - 缺省时将 `count` 设为 `1`，`content_mode` 设为 `text`，`strategy` 设为 `direct`。
   - 字段定义见 [references/spec.md](references/spec.md)。
2. 保留教师控制字段，不要根据画像或推断悄悄改动学科、知识点、题型、难度、内容模式、算法或配图要求。
3. 生成题目。
   - `direct`、`cot`、`react`、`dear`、`eqpr`、`evoq` 六种算法都是核心能力，必须按教师选择完整支持。
   - 每种算法对应一个生成策略：`direct`、`cot`、`react`、`dear`、`eqpr`、`evoq`，不要写成不存在的 OAH agent 文件。
   - 图文题只在图片参与作答或解释时生成 `image_position`、`image_svg`、`render_notes` 和 `diagrams`。
   - `evoq` 必须运行 GA 候选优化和 EvoQ IRT 虚拟学生模拟；学生模拟不是可选后处理，而是 EvoQ 出题路径的一部分。`dear`、`eqpr` 等算法也必须保留各自的多步生成/评估策略。
4. 评估并必要时修订。
   - 文本题关注答案唯一性、解析、难度和知识点匹配。
   - 图文题额外检查图像是否与作答相关、SVG 是否可渲染。
   - 评分规则见 [references/quality-rubric.md](references/quality-rubric.md)。
5. 返回 `eduqg-generation-result.v1`，保持机器可读 JSON。

## 智能体收口

对外按 `1 个主智能体 + 文本/图文路由 + 6 个算法策略 + 服务能力` 理解：

- 主智能体：负责对话抽字段、更新画像、spec ready gating 和路由。
- 六算法策略：`direct`、`cot`、`react`、`dear`、`eqpr`、`evoq` 都是核心生成路线，不能合并掉业务行为。
- OAH 功能子智能体：生成、评估、EvoQ 学生模拟、画像持久化由 `.openharness/agents/*.md` 中的功能角色和工具服务承担，不需要作为产品层 8 个独立入口暴露。
- OAH 里的 8 个 `subagents` 和 9 个工具名是运行能力清单；收口阶段只合并暴露面和文档口径，不删除能力、不改业务逻辑。

## 工具边界

基础出题不需要理解所有 OAH 工具服务接口。推荐主入口是：

```http
POST /api/eduqg/generate
```

OAH 工具服务保留 9 个工具名，是为了让 Tutor 前端、回归脚本和 Docker/OAH 部署继续使用同一套接口。六种算法是核心路径；`simulate_student_response` 是 EvoQ 的必需能力；`read_profile`/`write_profile` 属于画像持久化接口。Tutor 正式画像工作流使用 `portrait_id` 和 portrait store 持久化生成记录；独立 skill/OAH 工具服务使用这两个接口读写画像提示。

`settings.yaml` 中看起来有 22 个 schema refs，是因为 11 个 HTTP 工具端点分别声明了 input 和 output；唯一 schema 文件只有 2 个：

- [schemas/edu-question-spec.schema.json](schemas/edu-question-spec.schema.json)
- [schemas/eduqg-generation-result.schema.json](schemas/eduqg-generation-result.schema.json)

集成细节见 [references/edunex-integration.md](references/edunex-integration.md)。

## 环境变量

实时生成使用 NVIDIA OpenAI 兼容 chat-completions 接口：

```bash
set EDUQG_API_KEY=...
set EDUQG_API_URL=https://integrate.api.nvidia.com/v1/chat/completions
set EDUQG_MODEL=qwen/qwen3.5-397b-a17b
```

默认 mock 模式不依赖外部模型。学生模拟的 live 模式只有在 `EDUQG_IRT_ENSEMBLE_MODE=live` 时才会通过 OAH session/message/run 调用 `platform/*` modelRef。

不要在 skill、网站或仓库配置中硬编码供应商密钥。

## 输出规则

- 中文课堂语境默认输出中文。
- 题干、答案、解析、metadata 和 evaluation 必须齐全。
- 选择题必须有唯一且可信的标准答案。
- 需要配图的题目不能使用装饰图；图像必须包含与作答或解释相关的信息。
- 不暴露隐藏推理链；`analysis` 只写面向学生的简明解析。
