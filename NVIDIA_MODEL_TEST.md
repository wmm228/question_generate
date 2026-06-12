# NVIDIA 模型直连测试

这条测试只用于验证 NVIDIA 托管模型接口，不连接 OAH。

## 当前带过来的模型配置

```env
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL_NAME=qwen/qwen3.5-397b-a17b
```

这个模型对应原来 OAH 配置里的：

```env
platform/qwen_qwen3.5-397b-a17b
```

直连 NVIDIA API 时使用上面的 `qwen/qwen3.5-397b-a17b`。

## 配置密钥

复制样例文件：

```powershell
Copy-Item .env.nvidia.example .env.nvidia.local
```

然后编辑 `.env.nvidia.local`：

```env
NVIDIA_API_KEY=你的 NVIDIA API key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL_NAME=qwen/qwen3.5-397b-a17b
NVIDIA_MAX_THINKING_TOKENS=
```

## 运行测试

```powershell
npm run smoke:nvidia
```

也可以自定义 prompt：

```powershell
npm run smoke:nvidia -- "用一句中文介绍你自己"
```

## 预期输出

成功时会打印：

- `base_url`
- `model`
- `latency_ms`
- `answer`

如果没有配置 `NVIDIA_API_KEY`，脚本会直接退出并提示补齐密钥。
