# Tutor Server Requirements

这份文档只针对当前 `tutor` 项目，目的是回答两个问题：

1. 跑 `Tutor` 本身需要什么环境
2. 租腾讯云服务器时该怎么选配置

## 1. 先说结论

当前 `Tutor` 项目本身是一个普通的 Node.js + Express 服务。

- 不强制依赖 Docker
- 不强制依赖 MySQL / PostgreSQL / Redis
- 默认可以直接用文件落盘保存状态
- 真正的外部依赖是 `OAH` API

也就是说，如果你已经有一台可用的 OAH 服务，那么这台腾讯云服务器只需要部署 `Tutor` 即可，不需要顺手再装一整套 Docker。

## 2. 推荐服务器方案

### 方案 A: 只部署 Tutor

适用场景：

- `Tutor` 部署在腾讯云
- `OAH` 已经在别的机器上运行
- 当前 `.env` 通过 `OAH_BASE_URL` 访问远程 OAH

推荐配置：

- CPU: `2 核`
- 内存: `2 GB` 起步，`4 GB` 更稳
- 系统盘: `20 GB` 起步，建议 `40 GB`
- 带宽: `3 Mbps` 起步
- 系统: `Debian 12` 或 `Ubuntu 22.04 / 24.04 LTS`

这套配置对当前 `Tutor` 足够了。

### 方案 B: Tutor + OAH 部署在同一台服务器

适用场景：

- 这台服务器既跑 `Tutor`，也跑本地 `OAH`
- 你希望所有服务都在同一台机器内网互通

推荐配置：

- CPU: `4 核`
- 内存: `8 GB` 起步
- 系统盘: `40 GB` 以上
- 系统: `Debian 12-Docker26` 或 `Ubuntu22.04-Docker26`

这种方案才需要优先选带 Docker 的镜像。

## 3. Tutor 运行时依赖

### 必需软件

- `Node.js 22 LTS`
- `npm 10+`
- `git`

可选但推荐：

- `pm2`，用于常驻运行
- `nginx`，用于反向代理和 HTTPS

### 不需要的软件

- `Docker`，仅部署 Tutor 时不需要
- `pnpm`
- `Python`
- `MySQL`
- `PostgreSQL`
- `Redis`

## 4. Tutor 项目内实际依赖

从当前代码看：

- 服务入口是 `src/server.ts`
- 运行方式是 `npm run dev` / `npm run build` / `npm run start`
- Web 服务监听 `0.0.0.0`
- 默认端口是 `7896`
- 默认状态存储后端是 `filesystem`

本地持久化主要写入：

- `resources/runtime-state/`
- `resources/runtime-state/auth/users.json`
- `resources/runtime-state/auth/sessions.json`

因此服务器磁盘不需要很大，但必须允许 Node 进程对项目目录有写权限。

## 5. 必需环境变量

如果你是“只部署 Tutor，连接远程 OAH”，最少需要这些变量：

```env
OAH_BASE_URL=http://YOUR_OAH_HOST:8787
OAH_AGENT_NAME=question-orchestrator
OAH_WORKSPACE_RUNTIME=tutor-question-generation
OAH_WORKSPACE_NAME=tutor-question-generation
OAH_WORKSPACE_OWNER_ID=tutor
OAH_WORKSPACE_AUTO_CREATE=true
OAH_RUN_POLL_INTERVAL_MS=1000
```

推荐再补上：

```env
OAH_MODEL_NAME=platform/kimi-k25
TUTOR_PORT=7896
TUTOR_STORAGE_BACKEND=filesystem
SESSION_TTL_MS=2592000000
```

说明：

- `OAH_BASE_URL`：必填，指向 OAH API
- `OAH_WORKSPACE_RUNTIME`：和 OAH 里已有 workspace/runtime 保持一致
- `OAH_MODEL_NAME`：可选，不写时会使用 OAH workspace 默认模型
- `TUTOR_PORT`：可选，默认 `7896`
- `TUTOR_STORAGE_BACKEND`：可选，默认会走 `filesystem`

如果你要走本地联调模式，也可以参考：

- `.env.local-oah.example`

## 6. 网络要求

### 入站端口

至少开放其一：

- `7896`，如果你直接暴露 Tutor
- `80/443`，如果你前面挂 `nginx`

### 出站访问

当前 Tutor 至少需要能访问：

- `OAH_BASE_URL`

如果你后续启用媒体相关能力，还可能需要访问：

- `OAH_OCR_API_URL`
- `OAH_ASR_URL`
- `OAH_TTS_URL`

## 7. 部署命令

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 启动

```bash
npm run start
```

开发模式：

```bash
npm run dev
```

## 8. 推荐上线方式

推荐用 Linux 服务器，部署流程如下：

1. 安装 `Node.js 22 LTS`
2. 拉取项目代码
3. 在项目根目录写 `.env`
4. 执行 `npm install`
5. 执行 `npm run build`
6. 用 `pm2` 或 `systemd` 启动 `npm run start`
7. 用 `nginx` 反代到 `127.0.0.1:7896`

## 9. 适合你的租机建议

如果你现在只是把当前 `Tutor` 放到腾讯云，建议直接这样选：

- 镜像：`Debian 12`
- 配置：`2 核 4 GB`
- 系统盘：`40 GB`
- 不必专门选 Docker 镜像

如果后面你确认要把 `OAH` 也迁到同一台服务器，再改成：

- 镜像：`Debian12-Docker26`
- 配置：`4 核 8 GB`

