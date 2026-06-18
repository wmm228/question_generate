# 题目生成 Agent 技术报告

## 1. 报告摘要

本报告说明 EDUQG 题目生成 Agent 的技术架构、核心模块、数据契约、Agent runtime、Tutor 服务接入、OAH 调用链路、导出能力、部署要求和风险注意事项。

当前系统以 `Tutor` 为 Web 服务入口，以 `OAH` 为 Agent runtime，以 `question-orchestrator` 为主 Agent，实现从教师出题需求到结构化题目结果的完整链路。

## 2. 技术目标

系统技术目标包括：

1. 将教师出题需求转化为统一题目规范。
2. 通过 OAH Agent 完成生成和评价调度。
3. 支持文本题和图片题两类内容模式。
4. 支持 Direct、CoT、ReAct、DEAR、EQPR、EvoQ 等出题策略。
5. 支持教师画像、学生画像和会话记忆。
6. 支持题目历史、反馈和导出。
7. 支持可迁移部署和 OAH runtime 配置。

## 3. 总体架构

```text
Browser
  -> Tutor Frontend
  -> Tutor Express API
  -> Question Agent Services
  -> OAH API
  -> tutor-question-generation runtime
  -> question-orchestrator
  -> generator/evaluator subagents
  -> model/tools
```

各层职责：

| 层级 | 职责 |
| --- | --- |
| 前端工作台 | 用户输入、状态展示、历史、导出、反馈 |
| Express API | 鉴权、请求校验、路由、文件导出 |
| Question Agent Services | 规范化、画像、OAH 配置、runtime 状态 |
| OAH runtime | Agent 执行、模型调用、工具调度 |
| 存储层 | 用户、会话、画像、题目历史、反馈 |

## 4. 代码结构

核心路径：

| 路径 | 说明 |
| --- | --- |
| `src/routes/question-agent.ts` | 题目生成工作台 API、画像、导出、反馈 |
| `src/routes/ai-generate.ts` | 题目生成 API 和 OAH 状态接口 |
| `src/services/question-agent-contract.ts` | 读取和校验 Agent 合约 |
| `src/services/question-agent-spec.ts` | 题目规范标准化、计划生成 |
| `src/services/question-portrait.ts` | 画像对话、意图识别、对话状态 |
| `src/services/question-portrait-store.ts` | 画像和历史存储 |
| `src/services/oah-client.ts` | OAH API 客户端 |
| `src/services/oah-config.ts` | OAH 环境变量配置 |
| `oah-runtimes/tutor-question-generation/AGENTS.md` | OAH runtime 合约 |
| `deploy/oah-deploy-root/` | OAH 部署根目录模板 |
| `vendor/open-agent-harness/` | 随仓库交付的 OAH 服务源码，用于完整同机 Docker 部署 |
| `skill-version/` | 独立 skill 版本和工具边界 |

## 5. Agent 合约

系统的核心合约定义在：

```text
oah-runtimes/tutor-question-generation/AGENTS.md
```

该文件中的机器可读 JSON 是题目生成 runtime 的单一事实来源。TypeScript 服务和 OAH Agent 提示词都应与该合约对齐。

关键合约字段：

| 字段 | 当前值或含义 |
| --- | --- |
| `spec_version` | `edu-question-spec.v1` |
| `main_agent` | `question-orchestrator` |
| `subagents` | 8 个子 Agent：规范化、意图识别、文本生成、图片生成、文本评价、图片评价、学生模拟、画像演化 |
| `tools` | 9 个工具：规范校验、图片题生成、EvoQ 文本题、图片渲染、学生模拟、文本评价、图片评价、画像读、画像写 |
| `tool_service` | `eduqg-question-generation-agent` HTTP 工具服务端点 |
| `human_controlled_fields` | 教师控制字段 |
| `agent_controlled_fields` | Agent 可生成字段 |
| `tool_routing` | 按内容模式和算法路由工具 |
| `final_response_contract` | 最终题目输出要求 |

## 6. Agent 角色

| 角色 | 技术职责 |
| --- | --- |
| `question-orchestrator` | 对话、意图识别、规范确认、调度 |
| `spec-normalizer` | 将教师输入规范化为 `edu-question-spec.v1` |
| `intent-recognizer` | 独立判定当前轮是否授权立即生成 |
| `text-question-generator` | 文本题生成 |
| `visual-question-generator` | 图片题生成和视觉依赖描述 |
| `text-question-evaluator` | 文本题质量评价 |
| `visual-question-evaluator` | 图片题质量、图文一致和渲染安全评价 |
| `student-simulator` | 学生作答行为和常见错误模拟 |
| `profile-evolution` | 教师画像和学生画像更新建议 |

## 7. 题目规范化流程

规范化入口在：

```text
src/services/question-agent-spec.ts
```

主要流程：

1. 接收自然语言或结构化字段。
2. 调用 `normalizeAiGenPayload` 标准化字段。
3. 检查教师控制字段是否明确。
4. 生成 `QuestionGenerationSpec`。
5. 根据内容模式选择生成 Agent 和评价 Agent。
6. 根据算法选择额外工具。
7. 生成执行计划 `QuestionAgentPlan`。

关键规则：

1. `subject`、`knowledge_point`、`difficulty`、`question_type`、`content_mode` 必须明确。
2. 图片题必须明确图片目标或图片位置。
3. 文本题不能包含图片目标。
4. 图片题默认图片必须参与作答。
5. 画像不能覆盖教师明确字段。

## 8. 支持的输入输出

### 8.1 输入字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `subject` | string | 学科 |
| `knowledge_point` | string | 知识点 |
| `difficulty` | string | 难度 |
| `algorithm` | enum | 出题算法 |
| `question_type` | enum | 题型 |
| `content_mode` | enum | 文本题或图片题 |
| `image_targets` | array | 图片目标 |
| `image_mode` | enum | 无图、可选配图、必须配图 |

### 8.2 支持枚举

题型：

```text
multiple_choice, true_false, short_answer
```

内容模式：

```text
text, image
```

图片目标：

```text
stem, options, solution
```

算法：

```text
direct, cot, react, dear, eqpr, evoq
```

### 8.3 输出字段

| 字段 | 说明 |
| --- | --- |
| `question` | 题干 |
| `options` | 选项 |
| `solution_steps` | 解析步骤 |
| `ground_truth` | 标准答案 |
| `content` | 结构化内容 |
| `assets` | 图片资源 |
| `visual_pipeline` | 图片生成状态 |
| `meta` | 请求元信息 |

## 9. OAH 接入

Tutor 通过环境变量访问 OAH：

```env
OAH_BASE_URL=http://YOUR_OAH_HOST:8787
OAH_AGENT_NAME=question-orchestrator
OAH_INTENT_AGENT_NAME=intent-recognizer
OAH_WORKSPACE_RUNTIME=tutor-question-generation
OAH_WORKSPACE_NAME=tutor-question-generation
OAH_WORKSPACE_OWNER_ID=tutor
OAH_WORKSPACE_AUTO_CREATE=true
OAH_MODEL_NAME=platform/your-model
```

OAH 状态接口用于诊断：

1. OAH API 是否可访问。
2. workspace 是否可解析。
3. agent 是否存在。
4. 可用模型列表。
5. 当前模型配置是否有效。

## 10. API 路由

主要路由包括：

| 路由 | 方法 | 用途 |
| --- | --- | --- |
| `/api/question-agent/client-config` | GET | 前端配置 |
| `/api/question-agent/agent-design` | GET | Agent 架构设计 |
| `/api/question-agent/contract` | GET | 当前合约 |
| `/api/question-agent/oah-status` | GET | OAH 状态诊断 |
| `/api/question-agent/spec/normalize` | POST | 规范化出题请求 |
| `/api/question-agent/portrait/start` | POST | 创建画像会话 |
| `/api/question-agent/portrait/:id/reply` | POST | 继续画像对话 |
| `/api/question-agent/portrait/:id/question-export` | GET | 导出题目 |
| `/api/question-agent/feedback` | POST | 保存反馈 |
| `/api/ai-question/generate` | POST | 生成题目 |
| `/api/ai-question/oah-status` | GET | 生成链路状态 |

## 11. 存储设计

当前默认使用文件系统存储，主要保存：

1. 用户。
2. 登录会话。
3. 出题画像。
4. 历史消息。
5. 生成题目。
6. 用户反馈。

默认本地状态目录：

```text
resources/runtime-state/
```

也支持通过环境变量切换存储后端。部署时需要保证 Node 进程对状态目录有写权限。

## 12. 导出实现

当前系统支持题目结果导出：

| 格式 | 说明 |
| --- | --- |
| `docx` | 真正的 Office Open XML 文档 |
| `pdf` | 简单 PDF 预览或分发 |
| `xls` | HTML 表格形式的 Excel 兼容导出 |

图片导出逻辑：

1. 收集题目结果中的图片字段。
2. 支持 `data:image/...;base64`。
3. 支持本地生成图片路径。
4. 导出 `docx` 时将图片写入 `word/media/`。
5. 在 `word/_rels/document.xml.rels` 中建立图片关系。
6. 在 `word/document.xml` 中通过 `r:embed` 引用图片。

注意：旧式 `.doc` HTML 导出不稳定，尤其是图片使用 `data:image` 时，可能被 Word、微信或在线预览工具忽略。

## 13. 部署要求

### 13.1 Tutor 单独部署

适用场景：OAH 已经在远程机器上运行。

推荐环境：

1. Node.js 22 LTS。
2. npm 10+。
3. Linux 服务器。
4. 2 核 4GB 起步。
5. 系统盘 40GB。

部署命令：

```bash
npm install
npm run build
npm run start
```

### 13.2 Tutor + OAH 同机部署

适用场景：需要把 Web 服务和 OAH 都放在一台机器。

推荐环境：

1. 4 核 8GB 起步。
2. Docker 可用。
3. OAH deploy-root 已同步 runtime、models、tools。

当前仓库已经内置 OAH 服务源码，路径为：

```text
vendor/open-agent-harness/
```

`docker-compose.yml` 中的 OAH 构建上下文已经指向该目录：

```yaml
services:
  oah:
    build:
      context: ./vendor/open-agent-harness
      dockerfile: Dockerfile.dev
```

因此另一台电脑只需要 clone 当前仓库，配置 `.env.docker.local`，即可启动完整栈：

```bash
docker compose up -d --build
```

## 14. OAH deploy-root

相关目录：

```text
deploy/oah-deploy-root/
```

作用：

1. 保存 OAH source layout。
2. 提供 runtime、models、skills、tools、workspaces 目录。
3. 提供 MinIO 同步脚本。
4. 支持将题目生成 runtime 发布到 OAH 环境。

同步脚本要求显式设置 MinIO 密钥：

```bash
export MINIO_ROOT_PASSWORD=<your-minio-secret-key>
python3 ./scripts/sync_to_minio.py --delete
```

## 15. 测试与验证

已使用过的验证命令：

```bash
npm run check:oah
npm run smoke
npx tsc -p tsconfig.ai-generators.json --noEmit
npx tsc -p tsconfig.frontend.json --noEmit
npm run test:ai-generate
npm run test:ai-generate:algorithms
```

建议上线前增加：

1. 真实 OAH 模型生成测试。
2. 图片题导出 `.docx` 打开检查。
3. 多用户并发生成测试。
4. 文件存储权限测试。
5. 长对话画像压缩测试。

## 16. 并发、队列和限流

当前系统的主要并发控制依赖：

1. Node.js/Express 请求处理。
2. OAH runtime 的 worker 执行能力。
3. OAH run 超时和轮询配置。
4. 前端和后端的请求状态管理。

需要注意：

1. 当前没有看到专门的全局并发队列模块。
2. 当前没有看到独立的业务限流中间件。
3. 多人同时使用时，实际吞吐主要受 OAH worker 数量、模型接口吞吐和服务器资源影响。
4. 如果要面向多人生产使用，建议增加队列、限流和任务状态中心。

建议方案：

| 能力 | 建议 |
| --- | --- |
| 并发队列 | 按用户和全局维度排队 |
| 限流 | 登录用户级 QPS / 每日次数限制 |
| 超时 | 生成任务设置硬超时 |
| 重试 | 模型临时失败可有限重试 |
| 观测 | 记录 request_id、portrait_id、OAH run_id |

## 17. 风险与注意事项

### 17.1 模型输出不稳定

大模型可能生成格式不完整、答案不唯一或解析不严谨的题目。需要依赖 schema 校验和评价 Agent。

### 17.2 图片题质量风险

图片题最容易出现图文不一致、图片不参与解题、标注错误等问题。图片题必须加强评价。

### 17.3 导出兼容性风险

`.doc` HTML 导出不可靠，尤其是带 base64 图片时。生产场景应使用真正 `.docx`。

### 17.4 部署配置风险

OAH 模型名、workspace runtime、agent 名称必须一致，否则会出现 runtime 找不到、agent 不存在或模型不可用。

### 17.5 数据安全

不要把模型 API key、MinIO 密钥、用户会话文件提交到 Git。生产部署应通过环境变量和密钥管理系统注入。

## 18. 后续优化建议

1. 增加正式任务队列和限流。
2. 增加题目质量评分明细。
3. 增加批量题库生成。
4. 增加真实图片渲染失败回退策略。
5. 增加导出文档模板。
6. 增加教师审核流。
7. 增加更多学科的专用评价规则。
8. 增加自动化端到端测试。

## 19. 技术结论

当前题目生成 Agent 已经具备完整服务形态：

1. Tutor Web 入口。
2. OAH Agent runtime 合约。
3. 主 Agent 和子 Agent 职责拆分。
4. 结构化题目生成规范。
5. 文本题和图片题生成链路。
6. 题目评价和导出能力。
7. 部署说明和 OAH deploy-root。

后续如果面向更多用户正式上线，重点应补强队列、限流、监控、批量任务和导出模板能力。
