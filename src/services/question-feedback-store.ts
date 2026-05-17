import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { createAsyncKeyedLock } from "./async-lock";

export interface QuestionFeedbackRecord {
  feedback_id: string;
  owner_uid: string;
  portrait_id: string | null;
  request_id: string;
  score: number;
  question_json: unknown;
  context_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SaveQuestionFeedbackInput {
  feedback_id?: string;
  owner_uid: string;
  portrait_id?: string | null;
  request_id: string;
  score: number;
  question_json?: unknown;
  context_json?: unknown;
  created_at?: string;
  updated_at?: string;
}

export interface QuestionFeedbackStore {
  save(input: SaveQuestionFeedbackInput): Promise<QuestionFeedbackRecord>;
}

interface FileSystemQuestionFeedbackStoreOptions {
  baseDirectory: string;
}

interface QuestionFeedbackFile {
  version: "question-feedback.v1";
  feedback: QuestionFeedbackRecord[];
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeQuestionFeedbackScore(value: unknown): number | null {
  const score = typeof value === "number" ? value : Number.parseInt(normalizeString(value), 10);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return null;
  }
  return score;
}

function normalizeContext(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function normalizeQuestionFeedbackRecord(input: SaveQuestionFeedbackInput): QuestionFeedbackRecord {
  const ownerUid = normalizeString(input.owner_uid);
  const requestId = normalizeString(input.request_id);
  const score = normalizeQuestionFeedbackScore(input.score);
  if (!ownerUid || !requestId || score === null) {
    throw new Error("Invalid question feedback payload.");
  }
  const now = new Date().toISOString();
  return {
    feedback_id: normalizeString(input.feedback_id) || `qfeedback_${randomUUID().replace(/-/g, "")}`,
    owner_uid: ownerUid,
    portrait_id: normalizeString(input.portrait_id) || null,
    request_id: requestId,
    score,
    question_json: input.question_json ?? null,
    context_json: normalizeContext(input.context_json),
    created_at: normalizeString(input.created_at) || now,
    updated_at: normalizeString(input.updated_at) || now,
  };
}

function cloneRecord(record: QuestionFeedbackRecord): QuestionFeedbackRecord {
  return JSON.parse(JSON.stringify(record)) as QuestionFeedbackRecord;
}

export function createInMemoryQuestionFeedbackStore(): QuestionFeedbackStore {
  const records = new Map<string, QuestionFeedbackRecord>();
  const runFeedbackLock = createAsyncKeyedLock();

  return {
    save(input: SaveQuestionFeedbackInput): Promise<QuestionFeedbackRecord> {
      const normalized = normalizeQuestionFeedbackRecord(input);
      const key = `${normalized.owner_uid}:${normalized.request_id}`;
      return runFeedbackLock(key, () => {
        const existing = records.get(key);
        const next = {
          ...normalized,
          feedback_id: existing?.feedback_id || normalized.feedback_id,
          created_at: existing?.created_at || normalized.created_at,
        };
        records.set(key, cloneRecord(next));
        return cloneRecord(next);
      });
    },
  };
}

export function createFileSystemQuestionFeedbackStore(
  options: FileSystemQuestionFeedbackStoreOptions,
): QuestionFeedbackStore {
  const feedbackDirectory = path.join(options.baseDirectory, "question-feedback");
  const feedbackPath = path.join(feedbackDirectory, "feedback.json");
  const runFeedbackLock = createAsyncKeyedLock();

  function readFile(): QuestionFeedbackFile {
    if (!fs.existsSync(feedbackPath)) {
      return { version: "question-feedback.v1", feedback: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(feedbackPath, "utf-8")) as Partial<QuestionFeedbackFile>;
    return {
      version: "question-feedback.v1",
      feedback: Array.isArray(parsed.feedback)
        ? parsed.feedback
          .map((entry) => {
            try {
              return normalizeQuestionFeedbackRecord(entry);
            } catch {
              return null;
            }
          })
          .filter((entry): entry is QuestionFeedbackRecord => entry !== null)
        : [],
    };
  }

  function writeFile(file: QuestionFeedbackFile): void {
    ensureDirectory(feedbackDirectory);
    fs.writeFileSync(feedbackPath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  }

  return {
    save(input: SaveQuestionFeedbackInput): Promise<QuestionFeedbackRecord> {
      const normalized = normalizeQuestionFeedbackRecord(input);
      return runFeedbackLock("feedback-file", () => {
        const file = readFile();
        const existingIndex = file.feedback.findIndex((entry) => (
          entry.owner_uid === normalized.owner_uid && entry.request_id === normalized.request_id
        ));
        const next = existingIndex >= 0
          ? {
            ...normalized,
            feedback_id: file.feedback[existingIndex].feedback_id,
            created_at: file.feedback[existingIndex].created_at,
          }
          : normalized;
        if (existingIndex >= 0) {
          file.feedback[existingIndex] = next;
        } else {
          file.feedback.push(next);
        }
        writeFile(file);
        return cloneRecord(next);
      });
    },
  };
}
