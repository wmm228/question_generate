import { createHash } from "crypto";

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
import type { QuestionPortraitMessage } from "../types/question-portrait";
import {
  createQuestionPortraitHistorySnapshot,
  createQuestionPortraitStateSnapshot,
  type GeneratedQuestionLibraryItem,
  type GeneratedQuestionSearchFilters,
  isLatestPendingQuestionPortraitTurn,
  normalizeQuestionPortraitMessages,
  prepareQuestionPortraitMessagesForAppend,
  sanitizeQuestionPortraitDocument,
  type QuestionPortraitListItem,
  type QuestionPortraitStore,
} from "./question-portrait-store";
import {
  normalizeQuestionFeedbackRecord,
  type QuestionFeedbackRecord,
  type QuestionFeedbackStore,
} from "./question-feedback-store";
import type { SessionsDB, TutorAuthStore, UsersDB } from "./tutor-auth-store";
import { createAsyncKeyedLock } from "./async-lock";

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
  const result = isRecord(value.result) ? value.result : undefined;
  return {
    requestId: readString(value.requestId).trim() || requestId,
    startedAt,
    updatedAt,
    finished: readBoolean(value.finished),
    error: error || undefined,
    ...(result ? { result } : {}),
    stages,
    logs,
  };
}

function readPortraitHistoryMessages(
  document: QuestionPortraitDocument,
  historyJson: unknown,
): QuestionPortraitMessage[] {
  if (isRecord(historyJson) && Array.isArray(historyJson.messages)) {
    return normalizeQuestionPortraitMessages(historyJson.messages);
  }
  return normalizeQuestionPortraitMessages(document.messages);
}

function mergePortraitDocumentWithHistory(
  documentJson: unknown,
  historyJson: unknown,
): QuestionPortraitDocument | null {
  if (!isRecord(documentJson)) {
    return null;
  }
  const document = documentJson as unknown as QuestionPortraitDocument;
  return sanitizeQuestionPortraitDocument({
    ...document,
    messages: readPortraitHistoryMessages(document, historyJson),
  });
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
  questionFeedbackStore: QuestionFeedbackStore;
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
  const messagesTable = `${schema}.tutor_question_messages`;
  const generatedQuestionsTable = `${schema}.tutor_generated_questions`;
  const questionAssetsTable = `${schema}.tutor_question_assets`;
  const aiRunsTable = `${schema}.tutor_ai_runs`;
  const feedbackTable = `${schema}.tutor_question_feedback`;
  const runStatusLock = createAsyncKeyedLock();
  const runPortraitLock = createAsyncKeyedLock();

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
      archived_at TIMESTAMPTZ NULL,
      document_json JSONB NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS history_json JSONB NULL`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_portraits_owner_uid_idx ON ${portraitsTable} (owner_uid)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_portraits_owner_archived_updated_idx ON ${portraitsTable} (owner_uid, archived_at, updated_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_portraits_updated_at_idx ON ${portraitsTable} (updated_at DESC)`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS subject TEXT NULL`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS knowledge_point TEXT NULL`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS difficulty TEXT NULL`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS question_type TEXT NULL`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS content_mode TEXT NULL`);
  await pool.query(`ALTER TABLE ${portraitsTable} ADD COLUMN IF NOT EXISTS algorithm TEXT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_portraits_owner_taxonomy_idx ON ${portraitsTable} (owner_uid, subject, knowledge_point, question_type)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${messagesTable} (
      message_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      portrait_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      payload_json JSONB NULL,
      turn_id TEXT NULL,
      request_id TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      archived_at TIMESTAMPTZ NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_messages_owner_portrait_created_idx ON ${messagesTable} (owner_uid, portrait_id, created_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_messages_owner_request_idx ON ${messagesTable} (owner_uid, request_id) WHERE request_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_messages_owner_kind_created_idx ON ${messagesTable} (owner_uid, kind, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${generatedQuestionsTable} (
      question_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      portrait_id TEXT NOT NULL,
      message_id TEXT NULL,
      request_id TEXT NULL,
      subject TEXT NOT NULL DEFAULT '',
      knowledge_point TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT '',
      question_type TEXT NOT NULL DEFAULT '',
      content_mode TEXT NOT NULL DEFAULT '',
      algorithm TEXT NOT NULL DEFAULT '',
      image_mode TEXT NOT NULL DEFAULT '',
      image_targets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      question_text TEXT NOT NULL DEFAULT '',
      ground_truth TEXT NOT NULL DEFAULT '',
      result_json JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      archived_at TIMESTAMPTZ NULL
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tutor_generated_questions_owner_request_idx ON ${generatedQuestionsTable} (owner_uid, request_id) WHERE request_id IS NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tutor_generated_questions_owner_message_idx ON ${generatedQuestionsTable} (owner_uid, message_id) WHERE message_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_generated_questions_owner_taxonomy_idx ON ${generatedQuestionsTable} (owner_uid, subject, knowledge_point, question_type, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_generated_questions_owner_archived_created_idx ON ${generatedQuestionsTable} (owner_uid, archived_at, created_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${questionAssetsTable} (
      asset_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      portrait_id TEXT NOT NULL,
      question_id TEXT NULL,
      message_id TEXT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      mime_type TEXT NULL,
      storage_path TEXT NOT NULL,
      metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      archived_at TIMESTAMPTZ NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_assets_owner_portrait_idx ON ${questionAssetsTable} (owner_uid, portrait_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_assets_owner_question_idx ON ${questionAssetsTable} (owner_uid, question_id) WHERE question_id IS NOT NULL`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${aiRunsTable} (
      ai_run_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      portrait_id TEXT NULL,
      request_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error TEXT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ NULL,
      snapshot_json JSONB NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_ai_runs_owner_request_idx ON ${aiRunsTable} (owner_uid, request_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_ai_runs_owner_portrait_started_idx ON ${aiRunsTable} (owner_uid, portrait_id, started_at DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${feedbackTable} (
      feedback_id TEXT PRIMARY KEY,
      owner_uid TEXT NOT NULL,
      portrait_id TEXT NULL,
      question_id TEXT NULL,
      request_id TEXT NOT NULL,
      score INTEGER NOT NULL CHECK (score >= 1 AND score <= 5),
      question_json JSONB NULL,
      context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`ALTER TABLE ${feedbackTable} ADD COLUMN IF NOT EXISTS question_id TEXT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS tutor_question_feedback_owner_request_idx ON ${feedbackTable} (owner_uid, request_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_feedback_owner_created_at_idx ON ${feedbackTable} (owner_uid, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tutor_question_feedback_owner_question_idx ON ${feedbackTable} (owner_uid, question_id) WHERE question_id IS NOT NULL`);

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

  async function ensureStatusSnapshotUnlocked(requestId: string): Promise<AiGenerateStatusSnapshot> {
    await cleanupExpiredStatuses();
    const existing = await loadStatusSnapshot(requestId);
    if (existing) {
      return existing;
    }
    const created = createInitialSnapshot(requestId);
    await saveStatusSnapshot(created);
    return created;
  }

  const aiGenerateStatusStore: AiGenerateStatusStore = {
    async ensure(requestId: string): Promise<AiGenerateStatusSnapshot> {
      return runStatusLock(requestId, () => ensureStatusSnapshotUnlocked(requestId));
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
      return runStatusLock(requestId, async () => {
        const snapshot = await ensureStatusSnapshotUnlocked(requestId);
        const updatedAt = nowIso();
        snapshot.updatedAt = updatedAt;
        snapshot.stages = snapshot.stages.map((stage) => (stage.key === key
          ? { ...stage, state, detail, updatedAt }
          : stage));
        await saveStatusSnapshot(snapshot);
        return snapshot;
      });
    },
    async appendLog(requestId: string, message: string): Promise<AiGenerateStatusSnapshot> {
      return runStatusLock(requestId, async () => {
        const snapshot = await ensureStatusSnapshotUnlocked(requestId);
        snapshot.updatedAt = nowIso();
        snapshot.logs.push(message);
        if (snapshot.logs.length > 30) {
          snapshot.logs = snapshot.logs.slice(snapshot.logs.length - 30);
        }
        await saveStatusSnapshot(snapshot);
        return snapshot;
      });
    },
    async finish(
      requestId: string,
      error?: string,
      result?: Record<string, unknown>,
    ): Promise<AiGenerateStatusSnapshot> {
      return runStatusLock(requestId, async () => {
        const snapshot = await ensureStatusSnapshotUnlocked(requestId);
        snapshot.updatedAt = nowIso();
        snapshot.finished = true;
        if (error) {
          snapshot.error = error;
        }
        if (result) {
          snapshot.result = result;
        }
        await saveStatusSnapshot(snapshot);
        return snapshot;
      });
    },
    async applyProgressEvent(requestId: string, event: AiGenerateProgressEvent): Promise<AiGenerateStatusSnapshot> {
      return runStatusLock(requestId, async () => {
        const snapshot = await ensureStatusSnapshotUnlocked(requestId);
        const updatedAt = nowIso();
        snapshot.updatedAt = updatedAt;
        snapshot.stages = snapshot.stages.map((stage) => (stage.key === event.stage
          ? { ...stage, state: event.state, detail: event.detail, updatedAt }
          : stage));
        if (event.log) {
          snapshot.logs.push(event.log);
          if (snapshot.logs.length > 30) {
            snapshot.logs = snapshot.logs.slice(snapshot.logs.length - 30);
          }
        }
        await saveStatusSnapshot(snapshot);
        return snapshot;
      });
    },
  };

  function stableJsonStringify(value: unknown): string {
    if (value === null) {
      return "null";
    }
    const valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      return JSON.stringify(value) || "";
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
    }
    if (isRecord(value)) {
      return `{${Object.keys(value).sort().map((key) => (
        `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`
      )).join(",")}}`;
    }
    if (typeof value === "bigint") {
      return `bigint:${value.toString()}`;
    }
    return valueType;
  }

  function createStableId(prefix: string, parts: unknown[]): string {
    const hash = createHash("sha256");
    for (const part of parts) {
      hash.update(stableJsonStringify(part));
      hash.update("\0");
    }
    return `${prefix}_${hash.digest("hex").slice(0, 40)}`;
  }

  function normalizeDbTimestamp(value: unknown, fallback: string): string {
    const raw = readString(value).trim();
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
    const fallbackParsed = Date.parse(fallback);
    if (!Number.isNaN(fallbackParsed)) {
      return new Date(fallbackParsed).toISOString();
    }
    return nowIso();
  }

  function readRecordString(record: Record<string, unknown> | null, key: string): string {
    return record ? readString(record[key]).trim() : "";
  }

  function readOptionalRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
  }

  function readFirstString(...values: unknown[]): string {
    return values.map((value) => readString(value).trim()).find(Boolean) || "";
  }

  function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => readString(item).trim())
      .filter(Boolean);
  }

  function readMessagePayloadRecord(message: QuestionPortraitMessage): Record<string, unknown> | null {
    return readOptionalRecord(message.payload);
  }

  function readMessageKind(message: QuestionPortraitMessage): string {
    return readString(message.kind).trim() || "text";
  }

  function readMessageTurnId(message: QuestionPortraitMessage): string {
    const payload = readMessagePayloadRecord(message);
    return readFirstString(
      readRecordString(payload, "turn_id"),
      readRecordString(payload, "requires_latest_pending_turn_id"),
      readRecordString(payload, "error_for_turn_id"),
    );
  }

  function createMessageId(ownerUid: string, portraitId: string, message: QuestionPortraitMessage): string {
    return createStableId("qmsg", [
      ownerUid,
      portraitId,
      message.created_at,
      message.role,
      readMessageKind(message),
      readString(message.request_id),
      message.content,
    ]);
  }

  function isGeneratedQuestionPayload(value: unknown): value is Record<string, unknown> {
    return isRecord(value)
      && typeof value.question === "string"
      && Array.isArray(value.options)
      && Array.isArray(value.solution_steps)
      && typeof value.ground_truth === "string";
  }

  function readGeneratedQuestionMeta(
    document: QuestionPortraitDocument,
    payload: Record<string, unknown>,
  ): {
    subject: string;
    knowledgePoint: string;
    difficulty: string;
    questionType: string;
    contentMode: string;
    algorithm: string;
    imageMode: string;
    imageTargets: string[];
  } {
    const meta = readOptionalRecord(payload.meta);
    const request = readOptionalRecord(payload.request);
    const imageRequirement = readOptionalRecord(document.spec.image_requirement);
    const contract = readOptionalRecord(document.spec.generation_contract);
    const payloadImageTargets = readStringArray(meta?.image_targets).length > 0
      ? readStringArray(meta?.image_targets)
      : readStringArray(request?.image_targets);
    const specImageTargets = readStringArray(imageRequirement?.targets);
    const draftImageTargets = Array.isArray(document.draft.image_targets)
      ? document.draft.image_targets.map((item) => readString(item).trim()).filter(Boolean)
      : [];

    return {
      subject: readFirstString(
        readRecordString(meta, "subject"),
        readRecordString(request, "subject"),
        document.spec.subject,
        document.draft.subject,
      ),
      knowledgePoint: readFirstString(
        readRecordString(meta, "knowledge_point"),
        readRecordString(request, "knowledge_point"),
        document.spec.knowledge_point,
        document.draft.knowledge_point,
      ),
      difficulty: readFirstString(
        readRecordString(meta, "difficulty"),
        readRecordString(request, "difficulty"),
        String(document.spec.difficulty_level || ""),
        document.draft.difficulty,
      ),
      questionType: readFirstString(
        readRecordString(meta, "question_type"),
        readRecordString(request, "question_type"),
        document.spec.question_type,
        document.draft.question_type,
      ),
      contentMode: readFirstString(
        readRecordString(meta, "content_mode"),
        readRecordString(request, "content_mode"),
        document.spec.content_mode,
        document.draft.content_mode,
      ),
      algorithm: readFirstString(
        readRecordString(meta, "algorithm"),
        readRecordString(request, "algorithm"),
        readRecordString(contract, "algorithm"),
        document.spec.algorithm,
        document.draft.algorithm,
      ),
      imageMode: readFirstString(
        readRecordString(meta, "image_mode"),
        readRecordString(request, "image_mode"),
        readRecordString(imageRequirement, "mode"),
        document.draft.image_mode,
      ),
      imageTargets: payloadImageTargets.length > 0
        ? payloadImageTargets
        : specImageTargets.length > 0
          ? specImageTargets
          : draftImageTargets,
    };
  }

  function readPortraitTaxonomy(document: QuestionPortraitDocument): {
    subject: string;
    knowledgePoint: string;
    difficulty: string;
    questionType: string;
    contentMode: string;
    algorithm: string;
  } {
    return {
      subject: readFirstString(document.spec.subject, document.draft.subject),
      knowledgePoint: readFirstString(document.spec.knowledge_point, document.draft.knowledge_point),
      difficulty: readFirstString(String(document.spec.difficulty_level || ""), document.draft.difficulty),
      questionType: readFirstString(document.spec.question_type, document.draft.question_type),
      contentMode: readFirstString(document.spec.content_mode, document.draft.content_mode),
      algorithm: readFirstString(document.spec.algorithm, document.draft.algorithm),
    };
  }

  function normalizeAssetPath(value: unknown): string {
    const pathValue = readString(value).trim();
    if (!pathValue || /^data:/i.test(pathValue)) {
      return "";
    }
    return pathValue;
  }

  interface QuestionAssetRow {
    assetId: string;
    kind: string;
    label: string;
    storagePath: string;
    metadata: Record<string, unknown>;
  }

  function collectGeneratedQuestionAssets(
    ownerUid: string,
    portraitId: string,
    questionId: string,
    messageId: string,
    payload: Record<string, unknown>,
  ): QuestionAssetRow[] {
    const rows: QuestionAssetRow[] = [];
    const seen = new Set<string>();

    function addAsset(kind: string, label: string, value: unknown, metadata: Record<string, unknown> = {}): void {
      const storagePath = normalizeAssetPath(value);
      if (!storagePath) {
        return;
      }
      const key = `${kind}\0${label}\0${storagePath}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      rows.push({
        assetId: createStableId("qasset", [ownerUid, portraitId, questionId, kind, label, storagePath]),
        kind,
        label,
        storagePath,
        metadata,
      });
    }

    addAsset("stem", "stem_image", payload.stem_image, { source: "result.stem_image" });
    addAsset("solution", "explanation_image", payload.explanation_image, { source: "result.explanation_image" });

    const optionImages = readOptionalRecord(payload.option_images);
    if (optionImages) {
      for (const key of Object.keys(optionImages).sort()) {
        addAsset("option", `option_${key}`, optionImages[key], { source: "result.option_images", option_key: key });
      }
    }

    const content = readOptionalRecord(payload.content);
    const stem = readOptionalRecord(content?.stem);
    const stemImage = readOptionalRecord(stem?.image);
    addAsset("stem", "stem_image", stemImage?.url, { source: "result.content.stem.image" });

    const options = Array.isArray(content?.options) ? content.options : [];
    for (const option of options) {
      const optionRecord = readOptionalRecord(option);
      const optionImage = readOptionalRecord(optionRecord?.image);
      const optionKey = readRecordString(optionRecord, "key");
      addAsset("option", optionKey ? `option_${optionKey}` : "option", optionImage?.url, {
        source: "result.content.options.image",
        ...(optionKey ? { option_key: optionKey } : {}),
      });
    }

    const solution = readOptionalRecord(content?.solution);
    const solutionImage = readOptionalRecord(solution?.image);
    addAsset("solution", "solution_image", solutionImage?.url, { source: "result.content.solution.image" });

    void messageId;
    return rows;
  }

  async function upsertQuestionAssets(
    client: PoolClient,
    ownerUid: string,
    portraitId: string,
    questionId: string,
    messageId: string,
    createdAt: string,
    assets: QuestionAssetRow[],
  ): Promise<string[]> {
    const activeAssetIds: string[] = [];
    for (const asset of assets) {
      activeAssetIds.push(asset.assetId);
      await client.query(
        `
          INSERT INTO ${questionAssetsTable} (
            asset_id,
            owner_uid,
            portrait_id,
            question_id,
            message_id,
            kind,
            label,
            mime_type,
            storage_path,
            metadata_json,
            created_at,
            archived_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, NULL)
          ON CONFLICT (asset_id) DO UPDATE
          SET owner_uid = EXCLUDED.owner_uid,
              portrait_id = EXCLUDED.portrait_id,
              question_id = EXCLUDED.question_id,
              message_id = EXCLUDED.message_id,
              kind = EXCLUDED.kind,
              label = EXCLUDED.label,
              mime_type = EXCLUDED.mime_type,
              storage_path = EXCLUDED.storage_path,
              metadata_json = EXCLUDED.metadata_json,
              created_at = EXCLUDED.created_at,
              archived_at = NULL
        `,
        [
          asset.assetId,
          ownerUid,
          portraitId,
          questionId,
          messageId,
          asset.kind,
          asset.label,
          null,
          asset.storagePath,
          JSON.stringify(asset.metadata),
          createdAt,
        ],
      );
    }
    return activeAssetIds;
  }

  async function upsertStructuredPortraitRows(
    client: PoolClient,
    document: QuestionPortraitDocument,
  ): Promise<void> {
    const nextDocument = sanitizeQuestionPortraitDocument(document);
    const messages = normalizeQuestionPortraitMessages(nextDocument.messages);
    const ownerUid = nextDocument.owner_uid;
    const portraitId = nextDocument.portrait_id;
    const documentUpdatedAt = normalizeDbTimestamp(nextDocument.updated_at, nowIso());
    const activeMessageIds: string[] = [];
    const activeQuestionIds: string[] = [];
    const activeAssetIds: string[] = [];

    for (const message of messages) {
      const messageId = createMessageId(ownerUid, portraitId, message);
      const kind = readMessageKind(message);
      const createdAt = normalizeDbTimestamp(message.created_at, documentUpdatedAt);
      const payloadJson = Object.prototype.hasOwnProperty.call(message, "payload")
        ? JSON.stringify(message.payload)
        : null;
      activeMessageIds.push(messageId);
      await client.query(
        `
          INSERT INTO ${messagesTable} (
            message_id,
            owner_uid,
            portrait_id,
            role,
            kind,
            content,
            payload_json,
            turn_id,
            request_id,
            created_at,
            archived_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::timestamptz, NULL)
          ON CONFLICT (message_id) DO UPDATE
          SET owner_uid = EXCLUDED.owner_uid,
              portrait_id = EXCLUDED.portrait_id,
              role = EXCLUDED.role,
              kind = EXCLUDED.kind,
              content = EXCLUDED.content,
              payload_json = EXCLUDED.payload_json,
              turn_id = EXCLUDED.turn_id,
              request_id = EXCLUDED.request_id,
              created_at = EXCLUDED.created_at,
              archived_at = NULL
        `,
        [
          messageId,
          ownerUid,
          portraitId,
          message.role,
          kind,
          message.content,
          payloadJson,
          readMessageTurnId(message) || null,
          readString(message.request_id).trim() || null,
          createdAt,
        ],
      );

      if (kind !== "generated_question" || !isGeneratedQuestionPayload(message.payload)) {
        continue;
      }

      const requestId = readString(message.request_id).trim();
      const questionId = requestId
        ? createStableId("qgen", [ownerUid, requestId])
        : createStableId("qgen", [ownerUid, portraitId, messageId]);
      const meta = readGeneratedQuestionMeta(nextDocument, message.payload);
      activeQuestionIds.push(questionId);
      await client.query(
        `
          INSERT INTO ${generatedQuestionsTable} (
            question_id,
            owner_uid,
            portrait_id,
            message_id,
            request_id,
            subject,
            knowledge_point,
            difficulty,
            question_type,
            content_mode,
            algorithm,
            image_mode,
            image_targets_json,
            question_text,
            ground_truth,
            result_json,
            created_at,
            updated_at,
            archived_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13::jsonb, $14, $15, $16::jsonb,
            $17::timestamptz, $18::timestamptz, NULL
          )
          ON CONFLICT (question_id) DO UPDATE
          SET owner_uid = EXCLUDED.owner_uid,
              portrait_id = EXCLUDED.portrait_id,
              message_id = EXCLUDED.message_id,
              request_id = EXCLUDED.request_id,
              subject = EXCLUDED.subject,
              knowledge_point = EXCLUDED.knowledge_point,
              difficulty = EXCLUDED.difficulty,
              question_type = EXCLUDED.question_type,
              content_mode = EXCLUDED.content_mode,
              algorithm = EXCLUDED.algorithm,
              image_mode = EXCLUDED.image_mode,
              image_targets_json = EXCLUDED.image_targets_json,
              question_text = EXCLUDED.question_text,
              ground_truth = EXCLUDED.ground_truth,
              result_json = EXCLUDED.result_json,
              updated_at = EXCLUDED.updated_at,
              archived_at = NULL
        `,
        [
          questionId,
          ownerUid,
          portraitId,
          messageId,
          requestId || null,
          meta.subject,
          meta.knowledgePoint,
          meta.difficulty,
          meta.questionType,
          meta.contentMode,
          meta.algorithm,
          meta.imageMode,
          JSON.stringify(meta.imageTargets),
          readString(message.payload.question),
          readString(message.payload.ground_truth),
          JSON.stringify(message.payload),
          createdAt,
          documentUpdatedAt,
        ],
      );

      const assets = collectGeneratedQuestionAssets(ownerUid, portraitId, questionId, messageId, message.payload);
      activeAssetIds.push(...await upsertQuestionAssets(
        client,
        ownerUid,
        portraitId,
        questionId,
        messageId,
        createdAt,
        assets,
      ));
    }

    if (activeMessageIds.length > 0) {
      await client.query(
        `
          UPDATE ${messagesTable}
          SET archived_at = $3::timestamptz
          WHERE owner_uid = $1
            AND portrait_id = $2
            AND archived_at IS NULL
            AND NOT (message_id = ANY($4::text[]))
        `,
        [ownerUid, portraitId, documentUpdatedAt, activeMessageIds],
      );
    } else {
      await client.query(
        `
          UPDATE ${messagesTable}
          SET archived_at = $3::timestamptz
          WHERE owner_uid = $1 AND portrait_id = $2 AND archived_at IS NULL
        `,
        [ownerUid, portraitId, documentUpdatedAt],
      );
    }

    if (activeQuestionIds.length > 0) {
      await client.query(
        `
          UPDATE ${generatedQuestionsTable}
          SET archived_at = $3::timestamptz
          WHERE owner_uid = $1
            AND portrait_id = $2
            AND archived_at IS NULL
            AND NOT (question_id = ANY($4::text[]))
        `,
        [ownerUid, portraitId, documentUpdatedAt, activeQuestionIds],
      );
    } else {
      await client.query(
        `
          UPDATE ${generatedQuestionsTable}
          SET archived_at = $3::timestamptz
          WHERE owner_uid = $1 AND portrait_id = $2 AND archived_at IS NULL
        `,
        [ownerUid, portraitId, documentUpdatedAt],
      );
    }

    if (activeAssetIds.length > 0) {
      await client.query(
        `
          UPDATE ${questionAssetsTable}
          SET archived_at = $3::timestamptz
          WHERE owner_uid = $1
            AND portrait_id = $2
            AND archived_at IS NULL
            AND NOT (asset_id = ANY($4::text[]))
        `,
        [ownerUid, portraitId, documentUpdatedAt, activeAssetIds],
      );
    } else {
      await client.query(
        `
          UPDATE ${questionAssetsTable}
          SET archived_at = $3::timestamptz
          WHERE owner_uid = $1 AND portrait_id = $2 AND archived_at IS NULL
        `,
        [ownerUid, portraitId, documentUpdatedAt],
      );
    }
  }

  async function backfillStructuredPortraitRows(): Promise<void> {
    const result = await pool.query<{
      document_json: unknown;
      history_json: unknown;
    }>(
      `
        SELECT document_json, history_json
        FROM ${portraitsTable}
        WHERE archived_at IS NULL
      `,
    );
    if (result.rowCount === 0) {
      return;
    }
    await runInTransaction(pool, async (client) => {
      for (const row of result.rows) {
        const document = mergePortraitDocumentWithHistory(row.document_json, row.history_json);
        if (document) {
          const taxonomy = readPortraitTaxonomy(document);
          await client.query(
            `
              UPDATE ${portraitsTable}
              SET subject = $3,
                  knowledge_point = $4,
                  difficulty = $5,
                  question_type = $6,
                  content_mode = $7,
                  algorithm = $8
              WHERE portrait_id = $1 AND owner_uid = $2
            `,
            [
              document.portrait_id,
              document.owner_uid,
              taxonomy.subject,
              taxonomy.knowledgePoint,
              taxonomy.difficulty,
              taxonomy.questionType,
              taxonomy.contentMode,
              taxonomy.algorithm,
            ],
          );
          await upsertStructuredPortraitRows(client, document);
        }
      }
    });
  }

  await backfillStructuredPortraitRows();

  const questionPortraitStore: QuestionPortraitStore = {
    async load(ownerUid: string, portraitId: string): Promise<QuestionPortraitDocument | null> {
      const result = await pool.query<{ document_json: unknown; history_json: unknown }>(
        `
          SELECT document_json, history_json
          FROM ${portraitsTable}
          WHERE portrait_id = $1 AND owner_uid = $2 AND archived_at IS NULL
        `,
        [portraitId, ownerUid],
      );
      if (result.rowCount !== 1) {
        return null;
      }
      return mergePortraitDocumentWithHistory(result.rows[0].document_json, result.rows[0].history_json);
    },
    async save(document: QuestionPortraitDocument): Promise<QuestionPortraitDocument> {
      return runPortraitLock(document.portrait_id, async () => {
        const nextDocument = sanitizeQuestionPortraitDocument(document);
        const taxonomy = readPortraitTaxonomy(nextDocument);
        const stateSnapshot = createQuestionPortraitStateSnapshot(nextDocument);
        const historySnapshot = createQuestionPortraitHistorySnapshot(nextDocument);
        await runInTransaction(pool, async (client) => {
          await client.query(
            `
              INSERT INTO ${portraitsTable} (
                portrait_id,
                owner_uid,
                title,
                status,
                pending_field,
                summary,
                subject,
                knowledge_point,
                difficulty,
                question_type,
                content_mode,
                algorithm,
                created_at,
                updated_at,
                document_json,
                history_json
              )
              VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12,
                $13::timestamptz, $14::timestamptz, $15::jsonb, $16::jsonb
              )
              ON CONFLICT (portrait_id) DO UPDATE
              SET owner_uid = EXCLUDED.owner_uid,
                  title = EXCLUDED.title,
                  status = EXCLUDED.status,
                  pending_field = EXCLUDED.pending_field,
                  summary = EXCLUDED.summary,
                  subject = EXCLUDED.subject,
                  knowledge_point = EXCLUDED.knowledge_point,
                  difficulty = EXCLUDED.difficulty,
                  question_type = EXCLUDED.question_type,
                  content_mode = EXCLUDED.content_mode,
                  algorithm = EXCLUDED.algorithm,
                  created_at = EXCLUDED.created_at,
                  updated_at = EXCLUDED.updated_at,
                  document_json = EXCLUDED.document_json,
                  history_json = EXCLUDED.history_json
            `,
            [
              nextDocument.portrait_id,
              nextDocument.owner_uid,
              nextDocument.title,
              nextDocument.status,
              nextDocument.pending_field,
              nextDocument.summary,
              taxonomy.subject,
              taxonomy.knowledgePoint,
              taxonomy.difficulty,
              taxonomy.questionType,
              taxonomy.contentMode,
              taxonomy.algorithm,
              nextDocument.created_at,
              nextDocument.updated_at,
              JSON.stringify(stateSnapshot),
              JSON.stringify(historySnapshot),
            ],
          );
          await upsertStructuredPortraitRows(client, nextDocument);
        });
        return nextDocument;
      });
    },
    async saveIfLatestPendingTurn(
      ownerUid: string,
      portraitId: string,
      turnId: string,
      document: QuestionPortraitDocument,
    ): Promise<QuestionPortraitDocument | null> {
      return runPortraitLock(portraitId, async () => {
        if (document.owner_uid !== ownerUid || document.portrait_id !== portraitId) {
          return null;
        }
        const current = await this.load(ownerUid, portraitId);
        if (!current || !isLatestPendingQuestionPortraitTurn(normalizeQuestionPortraitMessages(current.messages), turnId)) {
          return null;
        }
        const nextDocument = sanitizeQuestionPortraitDocument(document);
        const taxonomy = readPortraitTaxonomy(nextDocument);
        const stateSnapshot = createQuestionPortraitStateSnapshot(nextDocument);
        const historySnapshot = createQuestionPortraitHistorySnapshot(nextDocument);
        await runInTransaction(pool, async (client) => {
          await client.query(
            `
              UPDATE ${portraitsTable}
              SET title = $1,
                  status = $2,
                  pending_field = $3,
                  summary = $4,
                  subject = $5,
                  knowledge_point = $6,
                  difficulty = $7,
                  question_type = $8,
                  content_mode = $9,
                  algorithm = $10,
                  updated_at = $11::timestamptz,
                  document_json = $12::jsonb,
                  history_json = $13::jsonb
              WHERE portrait_id = $14 AND owner_uid = $15 AND archived_at IS NULL
            `,
            [
              nextDocument.title,
              nextDocument.status,
              nextDocument.pending_field,
              nextDocument.summary,
              taxonomy.subject,
              taxonomy.knowledgePoint,
              taxonomy.difficulty,
              taxonomy.questionType,
              taxonomy.contentMode,
              taxonomy.algorithm,
              nextDocument.updated_at,
              JSON.stringify(stateSnapshot),
              JSON.stringify(historySnapshot),
              portraitId,
              ownerUid,
            ],
          );
          await upsertStructuredPortraitRows(client, nextDocument);
        });
        return nextDocument;
      });
    },
    async appendMessage(
      ownerUid: string,
      portraitId: string,
      message: QuestionPortraitMessage,
    ): Promise<QuestionPortraitDocument | null> {
      return runPortraitLock(portraitId, async () => {
        const document = await this.load(ownerUid, portraitId);
        if (!document) {
          return null;
        }
        const normalized = normalizeQuestionPortraitMessages([message])[0];
        if (!normalized) {
          return document;
        }
        const existingMessages = normalizeQuestionPortraitMessages(document.messages);
        const preparedMessages = prepareQuestionPortraitMessagesForAppend(existingMessages, normalized);
        if (!preparedMessages) {
          return document;
        }
        const messages = [...preparedMessages, normalized];
        const nextDocument = sanitizeQuestionPortraitDocument({
          ...document,
          messages,
        });
        const historySnapshot = createQuestionPortraitHistorySnapshot(nextDocument);
        const stateSnapshot = createQuestionPortraitStateSnapshot(nextDocument);
        await runInTransaction(pool, async (client) => {
          await client.query(
            `
              UPDATE ${portraitsTable}
              SET document_json = $1::jsonb,
                  history_json = $2::jsonb
              WHERE portrait_id = $3 AND owner_uid = $4 AND archived_at IS NULL
            `,
            [JSON.stringify(stateSnapshot), JSON.stringify(historySnapshot), portraitId, ownerUid],
          );
          await upsertStructuredPortraitRows(client, nextDocument);
        });
        return nextDocument;
      });
    },
    async archive(ownerUid: string, portraitId: string): Promise<boolean> {
      return runPortraitLock(portraitId, async () => {
        const archivedAt = nowIso();
        const result = await runInTransaction(pool, async (client) => {
          const updateResult = await client.query(
            `
              UPDATE ${portraitsTable}
              SET archived_at = $3::timestamptz,
                  document_json = jsonb_set(document_json, '{archived_at}', to_jsonb($3::text), true)
              WHERE portrait_id = $1 AND owner_uid = $2 AND archived_at IS NULL
            `,
            [portraitId, ownerUid, archivedAt],
          );
          if ((updateResult.rowCount || 0) > 0) {
            await client.query(
              `
                UPDATE ${messagesTable}
                SET archived_at = $3::timestamptz
                WHERE portrait_id = $1 AND owner_uid = $2 AND archived_at IS NULL
              `,
              [portraitId, ownerUid, archivedAt],
            );
            await client.query(
              `
                UPDATE ${generatedQuestionsTable}
                SET archived_at = $3::timestamptz
                WHERE portrait_id = $1 AND owner_uid = $2 AND archived_at IS NULL
              `,
              [portraitId, ownerUid, archivedAt],
            );
            await client.query(
              `
                UPDATE ${questionAssetsTable}
                SET archived_at = $3::timestamptz
                WHERE portrait_id = $1 AND owner_uid = $2 AND archived_at IS NULL
              `,
              [portraitId, ownerUid, archivedAt],
            );
          }
          return updateResult;
        });
        return (result.rowCount || 0) > 0;
      });
    },
    async list(ownerUid: string): Promise<QuestionPortraitListItem[]> {
      const result = await pool.query<{
        portrait_id: string;
        title: string;
        status: string;
        pending_field: string;
        summary: string;
        updated_at: string;
        created_at: string;
        history_updated_at: string | null;
        message_count: number | string | null;
      }>(
        `
          SELECT
            portrait_id,
            title,
            status,
            pending_field,
            summary,
            document_json->>'updated_at' AS updated_at,
            document_json->>'created_at' AS created_at,
            COALESCE(history_json->>'updated_at', document_json->>'updated_at') AS history_updated_at,
            CASE
              WHEN jsonb_typeof(history_json->'messages') = 'array'
                THEN jsonb_array_length(history_json->'messages')
              WHEN jsonb_typeof(document_json->'messages') = 'array'
                THEN jsonb_array_length(document_json->'messages')
              ELSE 0
            END AS message_count
          FROM ${portraitsTable}
          WHERE owner_uid = $1 AND archived_at IS NULL
          ORDER BY COALESCE(history_json->>'updated_at', document_json->>'updated_at') DESC
        `,
        [ownerUid],
      );
      return result.rows.map((row) => ({
        ...row,
        history_updated_at: row.history_updated_at || row.updated_at,
        message_count: Number(row.message_count) || 0,
      }));
    },
    async searchGeneratedQuestions(
      ownerUid: string,
      filters: GeneratedQuestionSearchFilters,
    ): Promise<GeneratedQuestionLibraryItem[]> {
      const where = ["owner_uid = $1", "archived_at IS NULL"];
      const params: Array<string | number> = [ownerUid];
      const addExactFilter = (column: string, value: unknown): void => {
        const normalized = readString(value).trim();
        if (!normalized) {
          return;
        }
        params.push(normalized);
        where.push(`${column} = $${params.length}`);
      };
      const addLikeFilter = (column: string, value: unknown): void => {
        const normalized = readString(value).trim();
        if (!normalized) {
          return;
        }
        params.push(`%${normalized}%`);
        where.push(`${column} ILIKE $${params.length}`);
      };
      addLikeFilter("subject", filters.subject);
      const knowledgePoint = readString(filters.knowledge_point).trim();
      if (knowledgePoint) {
        params.push(`%${knowledgePoint}%`);
        where.push(`(knowledge_point ILIKE $${params.length} OR question_text ILIKE $${params.length})`);
      }
      addExactFilter("difficulty", filters.difficulty);
      addExactFilter("question_type", filters.question_type);
      addExactFilter("content_mode", filters.content_mode);
      addExactFilter("algorithm", filters.algorithm);
      const limit = Math.min(100, Math.max(1, Number(filters.limit) || 50));
      params.push(limit);

      const result = await pool.query<{
        question_id: string;
        portrait_id: string;
        request_id: string | null;
        subject: string;
        knowledge_point: string;
        difficulty: string;
        question_type: string;
        content_mode: string;
        algorithm: string;
        created_at: string;
        updated_at: string;
        result: unknown;
      }>(
        `
          SELECT
            question_id,
            portrait_id,
            request_id,
            subject,
            knowledge_point,
            difficulty,
            question_type,
            content_mode,
            algorithm,
            created_at::text,
            updated_at::text,
            result_json AS result
          FROM ${generatedQuestionsTable}
          WHERE ${where.join(" AND ")}
          ORDER BY created_at DESC
          LIMIT $${params.length}
        `,
        params,
      );

      return result.rows.map((row) => ({
        question_id: row.question_id,
        portrait_id: row.portrait_id,
        request_id: row.request_id || "",
        subject: row.subject,
        knowledge_point: row.knowledge_point,
        difficulty: row.difficulty,
        question_type: row.question_type,
        content_mode: row.content_mode,
        algorithm: row.algorithm,
        created_at: row.created_at,
        updated_at: row.updated_at,
        result: isRecord(row.result) ? row.result : {},
      }));
    },
  };

  const questionFeedbackStore: QuestionFeedbackStore = {
    async save(input): Promise<QuestionFeedbackRecord> {
      const normalized = normalizeQuestionFeedbackRecord(input);
      const result = await pool.query<QuestionFeedbackRecord>(
        `
          INSERT INTO ${feedbackTable} (
            feedback_id,
            owner_uid,
            portrait_id,
            request_id,
            score,
            question_json,
            context_json,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::timestamptz, $9::timestamptz)
          ON CONFLICT (owner_uid, request_id) DO UPDATE
          SET portrait_id = EXCLUDED.portrait_id,
              score = EXCLUDED.score,
              question_json = EXCLUDED.question_json,
              context_json = EXCLUDED.context_json,
              updated_at = EXCLUDED.updated_at
          RETURNING
            feedback_id,
            owner_uid,
            portrait_id,
            request_id,
            score,
            question_json,
            context_json,
            created_at::text,
            updated_at::text
        `,
        [
          normalized.feedback_id,
          normalized.owner_uid,
          normalized.portrait_id,
          normalized.request_id,
          normalized.score,
          normalized.question_json === null ? null : JSON.stringify(normalized.question_json),
          JSON.stringify(normalized.context_json),
          normalized.created_at,
          normalized.updated_at,
        ],
      );
      return result.rows[0];
    },
  };

  return {
    authStore,
    aiGenerateStatusStore,
    questionPortraitStore,
    questionFeedbackStore,
    async close(): Promise<void> {
      await pool.end();
    },
  };
}
