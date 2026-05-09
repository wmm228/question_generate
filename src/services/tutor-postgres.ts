import { Pool, type PoolClient, type PoolConfig } from "pg";

import type { AiGenerateProgressEvent } from "./ai-generate";
import type {
  AiGenerateStageSnapshot,
  AiGenerateStageState,
  AiGenerateStatusSnapshot,
  AiGenerateStatusStore,
} from "./ai-generate-status";
import type { TutorPostgresConfig } from "./server-paths";
import type { QuestionPortraitDocument } from "../types/question-portrait";
import type { QuestionPortraitListItem, QuestionPortraitStore } from "./question-portrait-store";
import type { SessionsDB, TutorAuthStore, UsersDB } from "./tutor-auth-store";

const DEFAULT_AI_GENERATE_STATUS_TTL_MS = 30 * 60 * 1000;
const STAGE_STATE_SET = new Set<AiGenerateStageState>(["pending", "active", "done", "error"]);

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid PostgreSQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function buildPoolConfig(config: TutorPostgresConfig): PoolConfig {
  const ssl = config.ssl ? { rejectUnauthorized: false } : undefined;
  if (config.connectionString) {
    return {
      connectionString: config.connectionString,
      ssl,
    };
  }
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function createInitialSnapshot(requestId: string): AiGenerateStatusSnapshot {
  const createdAt = nowIso();
  return {
    requestId,
    startedAt: createdAt,
    updatedAt: createdAt,
    finished: false,
    stages: [
      {
        key: "request",
        label: "请求已接收",
        detail: "服务器已接收本次生成请求。",
        state: "done",
        updatedAt: createdAt,
      },
      {
        key: "generate",
        label: "生成草稿",
        detail: "等待生成智能体产出草稿。",
        state: "active",
        updatedAt: createdAt,
      },
      {
        key: "evaluate",
        label: "评估草稿",
        detail: "等待结构与质量评估。",
        state: "pending",
        updatedAt: createdAt,
      },
      {
        key: "render",
        label: "组装响应",
        detail: "等待最终响应组装。",
        state: "pending",
        updatedAt: createdAt,
      },
    ],
    logs: ["请求已进入 AI 出题流程。"],
  };
}

function normalizeStageSnapshot(value: unknown): AiGenerateStageSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = readString(value.key).trim();
  const label = readString(value.label).trim();
  const detail = readString(value.detail);
  const state = readString(value.state) as AiGenerateStageState;
  const updatedAt = readString(value.updatedAt);
  if (!key || !label || !updatedAt || !STAGE_STATE_SET.has(state)) {
    return null;
  }
  return {
    key,
    label,
    detail,
    state,
    updatedAt,
  };
}

function normalizeStatusSnapshot(requestId: string, value: unknown): AiGenerateStatusSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.stages) || !Array.isArray(value.logs)) {
    return null;
  }
  const stages = value.stages
    .map((stage) => normalizeStageSnapshot(stage))
    .filter((stage): stage is AiGenerateStageSnapshot => stage !== null);
  const logs = value.logs.filter((entry): entry is string => typeof entry === "string");
  const startedAt = readString(value.startedAt);
  const updatedAt = readString(value.updatedAt);
  if (!startedAt || !updatedAt || stages.length === 0) {
    return null;
  }
  const error = readString(value.error).trim();
  return {
    requestId: readString(value.requestId).trim() || requestId,
    startedAt,
    updatedAt,
    finished: readBoolean(value.finished),
    error: error || undefined,
    stages,
    logs,
  };
}

async function runInTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface TutorPostgresRuntime {
  authStore: TutorAuthStore;
  aiGenerateStatusStore: AiGenerateStatusStore;
  questionPortraitStore: QuestionPortraitStore;
  close(): Promise<void>;
}

export async function createTutorPostgresRuntime(
  config: TutorPostgresConfig,
): Promise<TutorPostgresRuntime> {
  const pool = new Pool(buildPoolConfig(config));
  const schema = quoteIdentifier(config.schema);
  const usersTable = `${schema}.tutor_users`;
  const sessionsTable = `${schema}.tutor_sessions`;
  const statusTable = `${schema}.tutor_ai_generate_status`;
  const portraitsTable = `${schema}.tutor_question_portraits`;

  await pool.query("SELECT 1");
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${usersTable} (
      uid TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${sessionsTable} (
      token TEXT PRIMARY KEY,
      uid TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_sessions_expires_at_idx ON ${sessionsTable} (expires_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${statusTable} (
      request_id TEXT PRIMARY KEY,
      snapshot_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_ai_generate_status_updated_at_idx ON ${statusTable} (updated_at)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${portraitsTable} (
      portrait_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      pending_field TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      document_json JSONB NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_portraits_owner_uid_idx ON ${portraitsTable} (owner_uid)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_portraits_updated_at_idx ON ${portraitsTable} (updated_at DESC)`);

  const authStore: TutorAuthStore = {
    async loadUsers(): Promise<UsersDB> {
      const result = await pool.query<{
        uid: string;
        password_hash: string;
        created_at: string;
      }>(`SELECT uid, password_hash, created_at FROM ${usersTable}`);
      return Object.fromEntries(result.rows.map((row) => [row.uid, {
        uid: row.uid,
        password_hash: row.password_hash,
        created_at: row.created_at,
      }]));
    },
    async saveUsers(users: UsersDB): Promise<void> {
      const entries = Object.entries(users);
      await runInTransaction(pool, async (client) => {
        if (entries.length === 0) {
          await client.query(`DELETE FROM ${usersTable}`);
          return;
        }
        await client.query(
          `DELETE FROM ${usersTable} WHERE NOT (uid = ANY($1::text[]))`,
          [entries.map(([uid]) => uid)],
        );
        for (const [uid, user] of entries) {
          await client.query(
            `
              INSERT INTO ${usersTable} (uid, password_hash, created_at)
              VALUES ($1, $2, $3)
              ON CONFLICT (uid) DO UPDATE
              SET password_hash = EXCLUDED.password_hash,
                  created_at = EXCLUDED.created_at
            `,
            [uid, user.password_hash, user.created_at],
          );
        }
      });
    },
    async loadSessions(): Promise<Record<string, unknown>> {
      const result = await pool.query<{
        token: string;
        uid: string;
        created_at: string;
        expires_at: string;
        last_seen_at: string | null;
      }>(`SELECT token, uid, created_at, expires_at, last_seen_at FROM ${sessionsTable}`);
      return Object.fromEntries(result.rows.map((row) => [row.token, {
        uid: row.uid,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        ...(row.last_seen_at ? { lastSeenAt: row.last_seen_at } : {}),
      }]));
    },
    async saveSessions(sessions: SessionsDB): Promise<void> {
      const entries = Object.entries(sessions);
      await runInTransaction(pool, async (client) => {
        if (entries.length === 0) {
          await client.query(`DELETE FROM ${sessionsTable}`);
          return;
        }
        await client.query(
          `DELETE FROM ${sessionsTable} WHERE NOT (token = ANY($1::text[]))`,
          [entries.map(([token]) => token)],
        );
        for (const [token, session] of entries) {
          await client.query(
            `
              INSERT INTO ${sessionsTable} (token, uid, created_at, expires_at, last_seen_at)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (token) DO UPDATE
              SET uid = EXCLUDED.uid,
                  created_at = EXCLUDED.created_at,
                  expires_at = EXCLUDED.expires_at,
                  last_seen_at = EXCLUDED.last_seen_at
            `,
            [
              token,
              session.uid,
              session.createdAt,
              session.expiresAt,
              session.lastSeenAt ?? null,
            ],
          );
        }
      });
    },
  };

  const ttlMs = DEFAULT_AI_GENERATE_STATUS_TTL_MS;

  async function cleanupExpiredStatuses(): Promise<void> {
    const cutoffIso = new Date(Date.now() - ttlMs).toISOString();
    await pool.query(`DELETE FROM ${statusTable} WHERE updated_at < $1::timestamptz`, [cutoffIso]);
  }

  async function loadStatusSnapshot(requestId: string): Promise<AiGenerateStatusSnapshot | null> {
    const result = await pool.query<{ snapshot_json: unknown }>(
      `SELECT snapshot_json FROM ${statusTable} WHERE request_id = $1`,
      [requestId],
    );
    if (result.rowCount !== 1) {
      return null;
    }
    return normalizeStatusSnapshot(requestId, result.rows[0].snapshot_json);
  }

  async function saveStatusSnapshot(snapshot: AiGenerateStatusSnapshot): Promise<void> {
    await pool.query(
      `
        INSERT INTO ${statusTable} (request_id, snapshot_json, updated_at)
        VALUES ($1, $2::jsonb, $3::timestamptz)
        ON CONFLICT (request_id) DO UPDATE
        SET snapshot_json = EXCLUDED.snapshot_json,
            updated_at = EXCLUDED.updated_at
      `,
      [snapshot.requestId, JSON.stringify(snapshot), snapshot.updatedAt],
    );
  }

  const aiGenerateStatusStore: AiGenerateStatusStore = {
    async ensure(requestId: string): Promise<AiGenerateStatusSnapshot> {
      await cleanupExpiredStatuses();
      const existing = await loadStatusSnapshot(requestId);
      if (existing) {
        return existing;
      }
      const created = createInitialSnapshot(requestId);
      await saveStatusSnapshot(created);
      return created;
    },
    async get(requestId: string): Promise<AiGenerateStatusSnapshot | null> {
      await cleanupExpiredStatuses();
      return loadStatusSnapshot(requestId);
    },
    async updateStage(
      requestId: string,
      key: string,
      state: AiGenerateStageState,
      detail: string,
    ): Promise<AiGenerateStatusSnapshot> {
      const snapshot = await aiGenerateStatusStore.ensure(requestId);
      const updatedAt = nowIso();
      snapshot.updatedAt = updatedAt;
      snapshot.stages = snapshot.stages.map((stage) => (stage.key === key
        ? { ...stage, state, detail, updatedAt }
        : stage));
      await saveStatusSnapshot(snapshot);
      return snapshot;
    },
    async appendLog(requestId: string, message: string): Promise<AiGenerateStatusSnapshot> {
      const snapshot = await aiGenerateStatusStore.ensure(requestId);
      snapshot.updatedAt = nowIso();
      snapshot.logs.push(message);
      if (snapshot.logs.length > 30) {
        snapshot.logs = snapshot.logs.slice(snapshot.logs.length - 30);
      }
      await saveStatusSnapshot(snapshot);
      return snapshot;
    },
    async finish(requestId: string, error?: string): Promise<AiGenerateStatusSnapshot> {
      const snapshot = await aiGenerateStatusStore.ensure(requestId);
      snapshot.updatedAt = nowIso();
      snapshot.finished = true;
      if (error) {
        snapshot.error = error;
      }
      await saveStatusSnapshot(snapshot);
      return snapshot;
    },
    async applyProgressEvent(requestId: string, event: AiGenerateProgressEvent): Promise<AiGenerateStatusSnapshot> {
      const snapshot = await aiGenerateStatusStore.updateStage(requestId, event.stage, event.state, event.detail);
      if (event.log) {
        await aiGenerateStatusStore.appendLog(requestId, event.log);
      }
      return snapshot;
    },
  };

  const questionPortraitStore: QuestionPortraitStore = {
    async load(ownerUid: string, portraitId: string): Promise<QuestionPortraitDocument | null> {
      const result = await pool.query<{ document_json: unknown }>(
        `
          SELECT document_json
          FROM ${portraitsTable}
          WHERE portrait_id = $1 AND owner_uid = $2
        `,
        [portraitId, ownerUid],
      );
      if (result.rowCount !== 1 || !isRecord(result.rows[0].document_json)) {
        return null;
      }
      return result.rows[0].document_json as unknown as QuestionPortraitDocument;
    },
    async save(document: QuestionPortraitDocument): Promise<QuestionPortraitDocument> {
      await pool.query(
        `
          INSERT INTO ${portraitsTable} (
            portrait_id,
            owner_uid,
            title,
            status,
            pending_field,
            summary,
            created_at,
            updated_at,
            document_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::jsonb)
          ON CONFLICT (portrait_id) DO UPDATE
          SET owner_uid = EXCLUDED.owner_uid,
              title = EXCLUDED.title,
              status = EXCLUDED.status,
              pending_field = EXCLUDED.pending_field,
              summary = EXCLUDED.summary,
              created_at = EXCLUDED.created_at,
              updated_at = EXCLUDED.updated_at,
              document_json = EXCLUDED.document_json
        `,
        [
          document.portrait_id,
          document.owner_uid,
          document.title,
          document.status,
          document.pending_field,
          document.summary,
          document.created_at,
          document.updated_at,
          JSON.stringify(document),
        ],
      );
      return document;
    },
    async list(ownerUid: string): Promise<QuestionPortraitListItem[]> {
      const result = await pool.query<QuestionPortraitListItem>(
        `
          SELECT
            portrait_id,
            title,
            status,
            pending_field,
            summary,
            document_json->>'updated_at' AS updated_at,
            document_json->>'created_at' AS created_at
          FROM ${portraitsTable}
          WHERE owner_uid = $1
          ORDER BY updated_at DESC
        `,
        [ownerUid],
      );
      return result.rows;
    },
  };

  return {
    authStore,
    aiGenerateStatusStore,
    questionPortraitStore,
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
