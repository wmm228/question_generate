# EDUQG OAH Source

This directory mirrors the OAH deploy-root layout for the EDUQG skill-version project.

## Mapping

| Local directory | OAH prefix | Purpose |
| --- | --- | --- |
| `runtimes/` | `runtime/` | Workspace runtime templates and `AGENTS.md` contracts |
| `skills/` | `skill/` | Reusable skill packages |
| `tools/` | `tool/` | Tool service definitions |

The runnable implementation lives in `../eduqg-question-generator`.

## Local Run

```bash
cd D:\tutor-tutor\skill-version
node eduqg-question-generator\scripts\entrypoint.mjs --serve --mock --port 8789
```

The OAH tool definition in `tools/eduqg-question-generator/settings.yaml` expects the service at `http://127.0.0.1:8789`.
