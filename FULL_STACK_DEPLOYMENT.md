# Full Stack Deployment

This repository includes both the Tutor service and the Open Agent Harness source needed by `docker-compose.yml`.

## Requirements

- Docker / Docker Compose
- Network access from the server to the configured model provider

## First Deploy

1. Clone this repository.
2. Copy `.env.docker.local.example` to `.env.docker.local`.
3. Fill `POSTGRES_PASSWORD` and any auth/model secrets required by your deployment.
4. Start the stack:

```bash
docker compose up -d --build
```

Tutor listens on `TUTOR_PORT`, defaulting to `7896`.

## Included Services

- `tutor`: Node.js / Express Tutor application.
- `oah`: Open Agent Harness built from `vendor/open-agent-harness`.
- `postgres`: PostgreSQL 16 state store.
- `cloudflared`: Optional Cloudflare tunnel profile.

OAH runtime, agent, and model configuration live under `deploy/oah-deploy-root/source`.
