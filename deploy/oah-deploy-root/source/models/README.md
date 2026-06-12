# 模型配置

Docker 部署时，OAH 通过 `docker-compose.yml` 挂载本目录到 `/data/models`。

当前部署只保留可用的 NVIDIA 模型：

- `platform/deepseek-ai_deepseek-v4-flash`
- `platform/qwen_qwen3.5-397b-a17b`
- `platform/qwen_qwen3-next-80b-a3b-instruct`
- `platform/mistralai_ministral-14b-instruct-2512`

不要在说明文档中写真实 key。生产部署的 URL/key 应放在受控的模型 YAML 或环境变量中。
