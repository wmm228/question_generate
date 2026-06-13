# OAH runtime 上传说明

本目录下的 `tutor-question-generation/` 是要上传到 OAH 的 runtime 模板。

关键结构来自 OAH 源码 `packages/config/src/runtimes.ts` 和 `packages/config/src/workspace.ts`：

```text
tutor-question-generation/
  AGENTS.md
  .openharness/
    settings.yaml
    prompts.yaml
    agents/
      question-orchestrator.md
      question-generator.md
      question-evaluator.md
      student-simulator.md
```

上传时 zip 里必须直接包含 `AGENTS.md` 和 `.openharness/`，不要多包一层 `tutor-question-generation/` 父目录。

目标 runtime 名称：`tutor-question-generation`

OAH API 上传接口：

```text
POST /api/v1/runtimes/upload?name=tutor-question-generation&overwrite=true
Content-Type: application/octet-stream
Body: runtime zip bytes
```

远程服务示例：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://10.11.20.89:8787/api/v1/runtimes/upload?name=tutor-question-generation&overwrite=true" `
  -ContentType "application/octet-stream" `
  -InFile "D:\tutor-tutor\tutor\oah-runtimes\tutor-question-generation.zip"
```

如果你是直接上传到部署目录，则放到 OAH deploy root 的：

```text
<oah-deploy-root>/source/runtimes/tutor-question-generation/
```

启动/同步后 OAH 会把它映射到对象存储 runtime 前缀：

```text
runtime/tutor-question-generation/
```

验证：

```powershell
curl http://10.11.20.89:8787/api/v1/runtimes
```

然后创建 workspace 时使用：

```json
{
  "name": "tutor-question-workspace",
  "runtime": "tutor-question-generation",
  "ownerId": "tutor",
  "serviceName": "tutor"
}
```
