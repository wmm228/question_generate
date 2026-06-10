# Tutor 本地 OAH 联调指南

这份文档只描述一条链路：

- 本地启动 OAH
- 本地启动 Tutor
- 用 Tutor 的 AI 出题接口联调 OAH

不涉及聊天、批改、错题本、OCR、ASR、TTS、讲义生成。

## 1. 当前架构边界

- OAH 是公司内部统一架构，只作为外部运行时使用
- Tutor 适配 OAH，不修改 OAH 平台代码
- Tutor 的试题 contract 单一事实来源在：
  [AGENTS.md](/D:/tutor-tutor/tutor/oah-runtimes/tutor-question-generation/AGENTS.md)

## 2. OAH 仓库位置

- `D:\tutor-tutor\OpenAgentHarness-master`

## 3. 本机当前实际阻塞

我已经在这台机器上实际执行过 OAH 本地启动脚本：

```powershell
$env:OAH_DEPLOY_ROOT = "D:\tutor-tutor\oah-deploy-root"
D:\js\node.exe .\scripts\local-stack.mjs up
```

当前机器上的真实阻塞是：

- `docker` 不在 PATH
- `pnpm` 不在 PATH
- OAH 仓库要求 `Node >= 24`
- 当前 Node 是 `v22.16.0`

也就是说，现在不是 Tutor 没打通，而是本机还不满足 OAH 本地启动条件。

## 4. 启动 OAH 前需要准备

至少补齐：

1. Node.js 24+
2. pnpm
3. Docker Desktop

## 5. 本地启动 OAH

### 5.1 设置 deploy root

```powershell
$env:OAH_DEPLOY_ROOT = "D:\tutor-tutor\oah-deploy-root"
```

### 5.2 准备模型配置

把模型 YAML 放到：

- `D:\tutor-tutor\oah-deploy-root\source\models`

### 5.3 启动本地栈

```powershell
cd D:\tutor-tutor\OpenAgentHarness-master
pnpm local:up
```

### 5.4 OAH 默认地址

- API: `http://127.0.0.1:8787`
- Web Console: `http://localhost:5174`

### 5.5 关闭 OAH

```powershell
cd D:\tutor-tutor\OpenAgentHarness-master
pnpm local:down
```

## 6. 本地启动 Tutor

Tutor 仓库位置：

- `D:\tutor-tutor\tutor`

### 6.1 安装依赖

```powershell
cd D:\tutor-tutor\tutor
npm install
```

### 6.2 连接本地 OAH 启动

```powershell
npm run dev:local-oah
```

或者：

```powershell
npm run build
npm run start:local-oah
```

Tutor 默认地址：

- `http://127.0.0.1:7896`

## 7. local_oah profile 会强制哪些配置

Tutor 启动 `local_oah` profile 时，会强制使用：

- `OAH_BASE_URL=http://127.0.0.1:8787`
- `OAH_AGENT_NAME=question-orchestrator`
- `OAH_INTENT_AGENT_NAME=intent-recognizer`
- `OAH_INTENT_MODEL_NAME=`（留空则沿用 `OAH_MODEL_NAME`）
- `OAH_WORKSPACE_RUNTIME=tutor-question-generation`
- `OAH_WORKSPACE_NAME=tutor-question-generation`
- `OAH_WORKSPACE_OWNER_ID=tutor`
- `OAH_WORKSPACE_AUTO_CREATE=true`
- `TUTOR_STORAGE_BACKEND=memory`

示例文件：

- [.env.local-oah.example](/D:/tutor-tutor/tutor/.env.local-oah.example)

## 8. 用 Tutor 出题

### 8.1 网页工作台

打开：

- `http://127.0.0.1:7896/question-agent-workbench`

### 8.2 API 流程

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

查询状态：

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri ("http://127.0.0.1:7896/api/ai-question/status/" + $requestId) `
  -Headers @{ "x-session-token" = $token }
```

## 9. smoke test

Tutor 已带一条 smoke 命令：

```powershell
cd D:\tutor-tutor\tutor
npm run smoke:oah-question
```

它会自动：

1. 注册测试用户
2. 检查 `/api/ai-question/oah-status`
3. 调 `/api/ai-question/generate`
4. 调 `/api/ai-question/status/:requestId`

## 10. 当前联调结论

当前 Tutor 侧已经通了。

现在唯一剩余问题是：

- 本地 OAH 还没有真正启动起来

只要本机补齐 `Docker + pnpm + Node 24+`，就可以继续做真实本地 OAH 端到端联调。
