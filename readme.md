# Tutor AI 出题服务

这个服务当前只聚焦一件事：基于 OAH 运行时完成 Tutor 的 AI 出题。

约束边界：

- 只改 Tutor 代码，不改 OAH 平台代码。
- 前后端分离，前后端都使用 TypeScript。
- 试题规范不写死在业务代码里，单一事实来源在 OAH runtime contract。

## 目录重点

```text
tutor/
├─ src/
│  ├─ routes/                         # API 路由
│  ├─ services/                       # OAH 接入、出题运行时、规范解析
│  ├─ prompts/question-agents/        # 算法 prompt 与阶段 prompt
│  └─ frontend/                       # Tutor 首页与 question-agent-workbench
├─ oah-runtimes/
│  └─ tutor-question-generation/
│     └─ AGENTS.md                    # 试题 contract 的单一事实来源
├─ dist/                              # 构建产物
├─ package.json
└─ .env.local-oah.example
```

## 关键规范文件

主智能体试题规范不写死在某个 TS 常量里。

权威文件在：

- [AGENTS.md](/D:/tutor-tutor/tutor/oah-runtimes/tutor-question-generation/AGENTS.md)
- [LOCAL_OAH_TUTOR_GUIDE.md](/D:/tutor-tutor/tutor/LOCAL_OAH_TUTOR_GUIDE.md)

Tutor 后端通过下面这个服务读取该文件里的 machine-readable JSON contract：

- [question-agent-contract.ts](/D:/tutor-tutor/tutor/src/services/question-agent-contract.ts)

由这个 contract 派生出：

- spec 归一化与校验：
  [question-agent-spec.ts](/D:/tutor-tutor/tutor/src/services/question-agent-spec.ts)
- OAH 子智能体/工具路由：
  [runtime.ts](/D:/tutor-tutor/tutor/src/services/ai-generate-runtime/runtime.ts)
- 试题生成 API：
  [question-agent.ts](/D:/tutor-tutor/tutor/src/routes/question-agent.ts)

## 当前支持的出题算法

当前 Tutor 的 TS 主链已经接入这些算法入口：

- `direct`
- `cot`
- `react`
- `dear`
- `eqpr`
- `evoq`

算法 prompt 在：

- [src/prompts/question-agents/algorithms](/D:/tutor-tutor/tutor/src/prompts/question-agents/algorithms)

文本题和图片题共用同一套 spec 驱动主链，但 schema 不同，生成/评估 agent 也不同。

## 本地启动 Tutor

安装依赖：

```bash
cd D:\tutor-tutor\tutor
npm install
```

开发模式：

```bash
npm run dev
```

连接本地 OAH 的开发模式：

```bash
npm run dev:local-oah
```

构建并启动：

```bash
npm run build
npm start
```

连接本地 OAH 的构建启动：

```bash
npm run build
npm run start:local-oah
```

默认端口：

- Tutor: `http://127.0.0.1:7896`

前端页面：

- Tutor 首页：`/`
- 出题工作台：`/question-agent-workbench`

健康检查：

- `GET /api/ping`

## 本地启动 OAH

OAH 仓库不在这里改代码，只作为外部平台启动。

OAH 本地仓库：

- `D:\tutor-tutor\OpenAgentHarness-master`

### 启动前要求

根据 OAH 仓库当前脚本与 `package.json`，本地启动至少需要：

- Node.js `24+`
- `pnpm`
- Docker Desktop

我在这台机器上实际检查到的状态：

- 当前 Node: `v22.16.0`
- `pnpm` 不在 PATH
- `docker` 不在 PATH

并且我实际执行了：

```bash
cd D:\tutor-tutor\OpenAgentHarness-master
set OAH_DEPLOY_ROOT=D:\tutor-tutor\oah-deploy-root
node .\scripts\local-stack.mjs up
```

真实阻塞点是：

- OAH deploy root 已成功从模板生成
- 启动在 `spawnSync docker ENOENT` 处失败
- 也就是说这台机器当前首先缺的是 Docker

### 标准启动方式

1. 准备 OAH deploy root

```powershell
$env:OAH_DEPLOY_ROOT = "D:\tutor-tutor\oah-deploy-root"
```

2. 在 deploy root 下放模型配置

目录：

- `D:\tutor-tutor\oah-deploy-root\source\models`

3. 启动 OAH 本地栈

```bash
cd D:\tutor-tutor\OpenAgentHarness-master
pnpm local:up
```

4. 如需看 OAH Web Console

```bash
pnpm dev:web
```

OAH README 标注的本地地址：

- OAH API: `http://127.0.0.1:8787`
- OAH Web Console: `http://localhost:5174`

### 关闭 OAH

```bash
cd D:\tutor-tutor\OpenAgentHarness-master
pnpm local:down
```

## Tutor 如何连接本地 OAH

Tutor 已经提供本地 OAH 启动 profile：

- [server-local-oah.ts](/D:/tutor-tutor/tutor/src/server-local-oah.ts)
- [tutor-launch-profile.ts](/D:/tutor-tutor/tutor/src/services/tutor-launch-profile.ts)

执行 `npm run dev:local-oah` 或 `npm run start:local-oah` 时，会强制使用这些 Tutor 侧默认值：

- `OAH_BASE_URL=http://127.0.0.1:8787`
- `OAH_AGENT_NAME=question-orchestrator`
- `OAH_WORKSPACE_RUNTIME=tutor-question-generation`
- `OAH_WORKSPACE_NAME=tutor-question-generation`
- `OAH_WORKSPACE_OWNER_ID=tutor`
- `OAH_WORKSPACE_AUTO_CREATE=true`
- `TUTOR_STORAGE_BACKEND=memory`

示例环境文件：

- [.env.local-oah.example](/D:/tutor-tutor/tutor/.env.local-oah.example)

注意：

- Tutor 默认只连 `OAH_BASE_URL`
- 不再隐式猜测 `127.0.0.1:5173`
- 只有显式设置 `OAH_ALLOW_5173_FALLBACK=true` 才会启用旧 fallback

## 用 Tutor 出题

### 方式 1：网页工作台

启动 Tutor 后，打开：

- `http://127.0.0.1:7896/question-agent-workbench`

这个页面会直接调用以下接口：

- `GET /api/ai-question/client-config`
- `GET /api/ai-question/contract`
- `GET /api/ai-question/oah-status`
- `POST /api/ai-question/spec/normalize`
- `POST /api/ai-question/generate`
- `GET /api/ai-question/status/:requestId`

### 方式 2：直接调 API

先注册：

```powershell
$register = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:7896/api/register" `
  -ContentType "application/json" `
  -Body '{"uid":"demo_teacher","password":"Pass123456!"}'

$token = $register.token
```

检查 OAH 状态：

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "http://127.0.0.1:7896/api/ai-question/oah-status" `
  -Headers @{ "x-session-token" = $token }
```

发起一道文本选择题：

```powershell
$requestId = "manual-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:7896/api/ai-question/generate" `
  -Headers @{
    "x-session-token" = $token
    "x-request-uuid" = $requestId
  } `
  -ContentType "application/json" `
  -Body '{
    "knowledge_point": "linear function graph interpretation",
    "difficulty": "2",
    "algorithm": "direct",
    "question_type": "multiple_choice",
    "content_mode": "text",
    "image_placement": "",
    "image_targets": [],
    "image_mode": "none"
  }'
```

查询进度：

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri ("http://127.0.0.1:7896/api/ai-question/status/" + $requestId) `
  -Headers @{ "x-session-token" = $token }
```

## smoke test

Tutor 侧已经提供一条端到端 smoke 命令：

```bash
cd D:\tutor-tutor\tutor
npm run smoke:oah-question
```

这条命令会自动：

- 注册一个测试用户
- 调 `/api/ai-question/oah-status`
- 调 `/api/ai-question/generate`
- 调 `/api/ai-question/status/:requestId`

## 当前联调状态

我已经完成的部分：

- Tutor 本地服务已可启动
- Tutor `local_oah` profile 已生效
- Tutor AI 出题接口已能稳定返回本地 OAH 不可达错误
- 远端 OAH 联调之前已通过真实生成

当前未完成的部分：

- 这台机器还没有可用的本地 OAH，因为缺 Docker
- 同时 OAH 仓库要求 Node `24+`，当前机器只有 `v22.16.0`
- `pnpm` 也还没进入 PATH

所以现在的真实状态不是 Tutor 没打通，而是本机还不满足 OAH 本地启动条件。
