import fs from "fs";
import path from "path";

import type { AiGenerateProgressEvent } from "./ai-generate";

const DEFAULT_AI_GENERATE_STATUS_TTL_MS = 30 * 60 * 1000;

export type AiGenerateStageState = "pending" | "active" | "done" | "error";

export interface AiGenerateStageSnapshot {
  key: string;
  label: string;
  detail: string;
  state: AiGenerateStageState;
  updatedAt: string;
}

export interface AiGenerateStatusSnapshot {
  requestId: string;
  startedAt: string;
  updatedAt: string;
  finished: boolean;
  error?: string;
  stages: AiGenerateStageSnapshot[];
  logs: string[];
}

export interface AiGenerateStatusStore {
  ensure(requestId: string): AiGenerateStatusSnapshot;
  get(requestId: string): AiGenerateStatusSnapshot | null;
  updateStage(
    requestId: string,
    key: string,
    state: AiGenerateStageState,
    detail: string,
  ): AiGenerateStatusSnapshot;
  appendLog(requestId: string, message: string): AiGenerateStatusSnapshot;
  finish(requestId: string, error?: string): AiGenerateStatusSnapshot;
  applyProgressEvent(requestId: string, event: AiGenerateProgressEvent): AiGenerateStatusSnapshot;
}

export interface InMemoryAiGenerateStatusStoreOptions {
  ttlMs?: number;
}

export interface FileSystemAiGenerateStatusStoreOptions extends InMemoryAiGenerateStatusStoreOptions {
  baseDirectory: string;
}

const STAGE_STATE_SET = new Set<AiGenerateStageState>(["pending", "active", "done", "error"]);

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
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

function createInMemoryStoreOperations(
  loadSnapshot: (requestId: string) => AiGenerateStatusSnapshot | null,
  saveSnapshot: (snapshot: AiGenerateStatusSnapshot) => void,
  cleanup: () => void,
): AiGenerateStatusStore {
  function ensure(requestId: string): AiGenerateStatusSnapshot {
    cleanup();
    const existing = loadSnapshot(requestId);
    if (existing) {
      return existing;
    }
    const created = createInitialSnapshot(requestId);
    saveSnapshot(created);
    return created;
  }

  function get(requestId: string): AiGenerateStatusSnapshot | null {
    cleanup();
    return loadSnapshot(requestId);
  }

  function updateStage(
    requestId: string,
    key: string,
    state: AiGenerateStageState,
    detail: string,
  ): AiGenerateStatusSnapshot {
    const snapshot = ensure(requestId);
    const updatedAt = nowIso();
    snapshot.updatedAt = updatedAt;
    snapshot.stages = snapshot.stages.map((stage) => (stage.key === key
      ? { ...stage, state, detail, updatedAt }
      : stage));
    saveSnapshot(snapshot);
    return snapshot;
  }

  function appendLog(requestId: string, message: string): AiGenerateStatusSnapshot {
    const snapshot = ensure(requestId);
    snapshot.updatedAt = nowIso();
    snapshot.logs.push(message);
    if (snapshot.logs.length > 30) {
      snapshot.logs = snapshot.logs.slice(snapshot.logs.length - 30);
    }
    saveSnapshot(snapshot);
    return snapshot;
  }

  function finish(requestId: string, error?: string): AiGenerateStatusSnapshot {
    const snapshot = ensure(requestId);
    snapshot.updatedAt = nowIso();
    snapshot.finished = true;
    if (error) {
      snapshot.error = error;
    }
    saveSnapshot(snapshot);
    return snapshot;
  }

  function applyProgressEvent(
    requestId: string,
    event: AiGenerateProgressEvent,
  ): AiGenerateStatusSnapshot {
    const snapshot = updateStage(requestId, event.stage, event.state, event.detail);
    if (event.log) {
      appendLog(requestId, event.log);
    }
    return snapshot;
  }

  return {
    ensure,
    get,
    updateStage,
    appendLog,
    finish,
    applyProgressEvent,
  };
}

export function createInMemoryAiGenerateStatusStore(
  options: InMemoryAiGenerateStatusStoreOptions = {},
): AiGenerateStatusStore {
  const ttlMs = options.ttlMs ?? DEFAULT_AI_GENERATE_STATUS_TTL_MS;
  const snapshots = new Map<string, AiGenerateStatusSnapshot>();

  function cleanup(): void {
    const cutoff = Date.now() - ttlMs;
    for (const [requestId, snapshot] of Array.from(snapshots.entries())) {
      if (Date.parse(snapshot.updatedAt) < cutoff) {
        snapshots.delete(requestId);
      }
    }
  }

  return createInMemoryStoreOperations(
    (requestId) => snapshots.get(requestId) ?? null,
    (snapshot) => {
      snapshots.set(snapshot.requestId, snapshot);
    },
    cleanup,
  );
}

export function createFileSystemAiGenerateStatusStore(
  options: FileSystemAiGenerateStatusStoreOptions,
): AiGenerateStatusStore {
  const ttlMs = options.ttlMs ?? DEFAULT_AI_GENERATE_STATUS_TTL_MS;
  const statusDirectory = path.join(options.baseDirectory, "ai-generate-status");
  ensureDirectory(statusDirectory);

  function getSnapshotPath(requestId: string): string {
    return path.join(statusDirectory, `${encodeURIComponent(requestId)}.json`);
  }

  function removeSnapshotFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }

  function isExpired(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }
    return Date.now() - fs.statSync(filePath).mtimeMs > ttlMs;
  }

  function cleanup(): void {
    ensureDirectory(statusDirectory);
    for (const entry of fs.readdirSync(statusDirectory)) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(statusDirectory, entry);
      if (isExpired(filePath)) {
        removeSnapshotFile(filePath);
      }
    }
  }

  return createInMemoryStoreOperations(
    (requestId) => {
      const filePath = getSnapshotPath(requestId);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      if (isExpired(filePath)) {
        removeSnapshotFile(filePath);
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const snapshot = normalizeStatusSnapshot(requestId, parsed);
        if (!snapshot) {
          removeSnapshotFile(filePath);
        }
        return snapshot;
      } catch {
        removeSnapshotFile(filePath);
        return null;
      }
    },
    (snapshot) => {
      const filePath = getSnapshotPath(snapshot.requestId);
      fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
    },
    cleanup,
  );
}
