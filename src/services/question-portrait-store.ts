import fs from "fs";
import path from "path";

import type {
  QuestionPortraitDocument,
  QuestionPortraitMessage,
  QuestionPortraitMessageKind,
  QuestionPortraitRole,
} from "../types/question-portrait";
import { createAsyncKeyedLock } from "./async-lock";

export interface QuestionPortraitListItem {
  portrait_id: string;
  title: string;
  status: string;
  pending_field: string;
  summary: string;
  updated_at: string;
  created_at: string;
  history_updated_at: string;
  message_count: number;
}

export interface GeneratedQuestionSearchFilters {
  subject?: string;
  knowledge_point?: string;
  difficulty?: string;
  question_type?: string;
  content_mode?: string;
  algorithm?: string;
  limit?: number;
}

export interface GeneratedQuestionLibraryItem {
  question_id: string;
  portrait_id: string;
  request_id: string;
  subject: string;
  knowledge_point: string;
  difficulty: string;
  question_type: string;
  content_mode: string;
  algorithm: string;
  created_at: string;
  updated_at: string;
  result: Record<string, unknown>;
}

export interface QuestionPortraitStore {
  load(ownerUid: string, portraitId: string): Promise<QuestionPortraitDocument | null>;
  save(document: QuestionPortraitDocument): Promise<QuestionPortraitDocument>;
  saveIfLatestPendingTurn(
    ownerUid: string,
    portraitId: string,
    turnId: string,
    document: QuestionPortraitDocument,
  ): Promise<QuestionPortraitDocument | null>;
  appendMessage(
    ownerUid: string,
    portraitId: string,
    message: QuestionPortraitMessage,
  ): Promise<QuestionPortraitDocument | null>;
  archive(ownerUid: string, portraitId: string): Promise<boolean>;
  list(ownerUid: string): Promise<QuestionPortraitListItem[]>;
  searchGeneratedQuestions(ownerUid: string, filters: GeneratedQuestionSearchFilters): Promise<GeneratedQuestionLibraryItem[]>;
}

interface FileSystemQuestionPortraitStoreOptions {
  baseDirectory: string;
}

interface QuestionPortraitHistoryFile {
  version: "question-portrait-history.v1";
  portrait_id: string;
  owner_uid: string;
  updated_at: string;
  messages: QuestionPortraitMessage[];
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeMessageRole(value: unknown): QuestionPortraitRole | null {
  const normalized = normalizeString(value);
  if (normalized === "teacher" || normalized === "assistant") {
    return normalized;
  }
  return null;
}

function normalizeMessageKind(value: unknown): QuestionPortraitMessageKind | undefined {
  const normalized = normalizeString(value);
  if (
    normalized === "text"
    || normalized === "generated_question"
    || normalized === "notice"
    || normalized === "error"
  ) {
    return normalized;
  }
  return undefined;
}

export function normalizeQuestionPortraitMessage(value: unknown): QuestionPortraitMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  const role = normalizeMessageRole(value.role);
  const content = normalizeString(value.content);
  const createdAt = normalizeString(value.created_at);
  if (!role || !createdAt) {
    return null;
  }
  const kind = normalizeMessageKind(value.kind);
  const requestId = normalizeString(value.request_id);
  return {
    role,
    content,
    created_at: createdAt,
    ...(kind ? { kind } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, "payload") ? { payload: value.payload } : {}),
  };
}

export function normalizeQuestionPortraitMessages(value: unknown): QuestionPortraitMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeQuestionPortraitMessage(entry))
    .filter((entry): entry is QuestionPortraitMessage => entry !== null);
}

function isMessagePayloadRecord(payload: unknown): payload is Record<string, unknown> {
  return isRecord(payload);
}

function isPendingTeacherReplyPayload(payload: unknown): boolean {
  if (!isMessagePayloadRecord(payload)) {
    return false;
  }
  return payload.reply_pending === true || normalizeString(payload.reply_pending).toLowerCase() === "true";
}

function readMessagePayloadString(payload: unknown, key: string): string {
  return isMessagePayloadRecord(payload) ? normalizeString(payload[key]) : "";
}

function readLatestPendingTurnRequirement(message: QuestionPortraitMessage): string {
  return readMessagePayloadString(message.payload, "requires_latest_pending_turn_id");
}

function readErrorTurnId(message: QuestionPortraitMessage): string {
  return readMessagePayloadString(message.payload, "error_for_turn_id");
}

export function isLatestPendingQuestionPortraitTurn(messages: QuestionPortraitMessage[], turnId: string): boolean {
  if (!turnId) {
    return false;
  }
  const latest = messages[messages.length - 1];
  return latest?.role === "teacher"
    && isPendingTeacherReplyPayload(latest.payload)
    && readMessagePayloadString(latest.payload, "turn_id") === turnId;
}

export function supersedePendingTeacherReplies(
  messages: QuestionPortraitMessage[],
  nextMessage: QuestionPortraitMessage,
): QuestionPortraitMessage[] {
  if (nextMessage.role !== "teacher" || !isPendingTeacherReplyPayload(nextMessage.payload)) {
    return messages;
  }
  const supersededAt = new Date().toISOString();
  return messages.map((message) => {
    if (message.role !== "teacher" || !isPendingTeacherReplyPayload(message.payload)) {
      return message;
    }
    return {
      ...message,
      payload: {
        ...(message.payload as Record<string, unknown>),
        reply_pending: false,
        superseded: true,
        superseded_at: supersededAt,
      },
    };
  });
}

export function prepareQuestionPortraitMessagesForAppend(
  messages: QuestionPortraitMessage[],
  nextMessage: QuestionPortraitMessage,
): QuestionPortraitMessage[] | null {
  const requiredTurnId = readLatestPendingTurnRequirement(nextMessage);
  if (requiredTurnId && !isLatestPendingQuestionPortraitTurn(messages, requiredTurnId)) {
    return null;
  }

  const errorTurnId = readErrorTurnId(nextMessage);
  if (errorTurnId) {
    const failedAt = new Date().toISOString();
    return messages.map((message) => {
      if (
        message.role !== "teacher"
        || !isPendingTeacherReplyPayload(message.payload)
        || readMessagePayloadString(message.payload, "turn_id") !== errorTurnId
      ) {
        return message;
      }
      return {
        ...message,
        payload: {
          ...(message.payload as Record<string, unknown>),
          reply_pending: false,
          failed_at: failedAt,
        },
      };
    });
  }

  return supersedePendingTeacherReplies(messages, nextMessage);
}

function normalizeQuestionPortraitDocument(value: unknown): QuestionPortraitDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!normalizeString(value.portrait_id) || !normalizeString(value.owner_uid) || !isRecord(value.draft)) {
    return null;
  }
  return value as unknown as QuestionPortraitDocument;
}

function isPortraitArchived(document: QuestionPortraitDocument): boolean {
  return Boolean(normalizeString(document.archived_at));
}

export function getQuestionPortraitHistoryUpdatedAt(
  messages: QuestionPortraitMessage[],
  fallback: string,
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const createdAt = normalizeString(messages[index]?.created_at);
    if (createdAt) {
      return createdAt;
    }
  }
  return fallback;
}

export function stripPortraitDialogueMarkdown(markdown: string): string {
  const headingMatches = Array.from(markdown.matchAll(/\n## [^\n]*/g));
  for (let index = headingMatches.length - 1; index >= 0; index -= 1) {
    const match = headingMatches[index];
    const start = match.index ?? -1;
    if (start < 0) {
      continue;
    }
    const section = markdown.slice(start);
    if (/\n-\s*(teacher|assistant):/.test(section)) {
      return `${markdown.slice(0, start).trimEnd()}\n`;
    }
  }
  return markdown;
}

function repairPortraitMarkdownSubjectField(
  markdown: string,
  document: QuestionPortraitDocument,
): string {
  if (!markdown || /(^|\n)-\s*学科\s*[:：]/.test(markdown)) {
    return markdown;
  }
  const subjectLine = `- 学科: ${normalizeString(document.draft.subject).trim() || "待确认"}`;
  const knowledgePointLinePattern = /(^|\n)(-\s*知识点\s*[:：][^\n]*(?:\n|$))/;
  if (knowledgePointLinePattern.test(markdown)) {
    return markdown.replace(
      knowledgePointLinePattern,
      (_match, prefix: string, knowledgePointLine: string) => `${prefix}${subjectLine}\n${knowledgePointLine}`,
    );
  }
  const currentFieldsHeadingPattern = /(^|\n)(## 当前画像字段[^\n]*\n)(\n?)/;
  if (currentFieldsHeadingPattern.test(markdown)) {
    return markdown.replace(
      currentFieldsHeadingPattern,
      (_match, prefix: string, heading: string, blankLine: string) => `${prefix}${heading}${blankLine}${subjectLine}\n`,
    );
  }
  return markdown;
}

export function sanitizeQuestionPortraitDocument(
  document: QuestionPortraitDocument,
): QuestionPortraitDocument {
  const markdown = stripPortraitDialogueMarkdown(normalizeString(document.markdown));
  return {
    ...document,
    messages: normalizeQuestionPortraitMessages(document.messages),
    markdown: repairPortraitMarkdownSubjectField(markdown, document),
  };
}

export function createQuestionPortraitStateSnapshot(
  document: QuestionPortraitDocument,
): Omit<QuestionPortraitDocument, "messages"> {
  const sanitized = sanitizeQuestionPortraitDocument(document);
  const { messages, ...stateDocument } = sanitized;
  void messages;
  return stateDocument;
}

export function createQuestionPortraitHistorySnapshot(
  document: QuestionPortraitDocument,
): QuestionPortraitHistoryFile {
  const messages = normalizeQuestionPortraitMessages(document.messages);
  return {
    version: "question-portrait-history.v1",
    portrait_id: document.portrait_id,
    owner_uid: document.owner_uid,
    updated_at: getQuestionPortraitHistoryUpdatedAt(messages, document.updated_at),
    messages,
  };
}

function cloneDocument(document: QuestionPortraitDocument): QuestionPortraitDocument {
  return JSON.parse(JSON.stringify(document)) as QuestionPortraitDocument;
}

function toPortraitListItem(
  document: QuestionPortraitDocument,
  messages: QuestionPortraitMessage[] = normalizeQuestionPortraitMessages(document.messages),
): QuestionPortraitListItem {
  const historyUpdatedAt = getQuestionPortraitHistoryUpdatedAt(messages, document.updated_at);
  return {
    portrait_id: document.portrait_id,
    title: document.title,
    status: document.status,
    pending_field: document.pending_field,
    summary: document.summary,
    updated_at: document.updated_at,
    created_at: document.created_at,
    history_updated_at: historyUpdatedAt,
    message_count: messages.length,
  };
}

function sortPortraitsByUpdatedAtDescending(items: QuestionPortraitListItem[]): QuestionPortraitListItem[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.history_updated_at || left.updated_at) || 0;
    const rightTime = Date.parse(right.history_updated_at || right.updated_at) || 0;
    return rightTime - leftTime;
  });
}

function normalizeFilterValue(value: unknown): string {
  return normalizeString(value).trim();
}

function isGeneratedQuestionPayload(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && typeof value.question === "string"
    && Array.isArray(value.options)
    && Array.isArray(value.solution_steps)
    && typeof value.ground_truth === "string";
}

function readPayloadRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return isRecord(payload[key]) ? payload[key] : null;
}

function readGeneratedQuestionField(
  document: QuestionPortraitDocument,
  payload: Record<string, unknown>,
  field: keyof Omit<GeneratedQuestionSearchFilters, "limit">,
): string {
  const meta = readPayloadRecord(payload, "meta");
  const request = readPayloadRecord(payload, "request");
  const spec: Record<string, unknown> = isRecord(document.spec) ? document.spec : {};
  const draft: Record<string, unknown> = isRecord(document.draft) ? document.draft : {};
  const specDifficulty = field === "difficulty" ? spec.difficulty_level : spec[field];
  return normalizeFilterValue(meta?.[field])
    || normalizeFilterValue(request?.[field])
    || normalizeFilterValue(specDifficulty)
    || normalizeFilterValue(draft[field]);
}

function includesFilter(value: string, filter: unknown): boolean {
  const normalizedFilter = normalizeFilterValue(filter).toLocaleLowerCase();
  if (!normalizedFilter) {
    return true;
  }
  return normalizeFilterValue(value).toLocaleLowerCase().includes(normalizedFilter);
}

function equalsFilter(value: string, filter: unknown): boolean {
  const normalizedFilter = normalizeFilterValue(filter);
  if (!normalizedFilter) {
    return true;
  }
  return normalizeFilterValue(value) === normalizedFilter;
}

function generatedQuestionMatchesFilters(
  document: QuestionPortraitDocument,
  payload: Record<string, unknown>,
  filters: GeneratedQuestionSearchFilters,
): boolean {
  const questionText = normalizeFilterValue(payload.question);
  const knowledgePoint = readGeneratedQuestionField(document, payload, "knowledge_point");
  return includesFilter(readGeneratedQuestionField(document, payload, "subject"), filters.subject)
    && (includesFilter(knowledgePoint, filters.knowledge_point) || includesFilter(questionText, filters.knowledge_point))
    && equalsFilter(readGeneratedQuestionField(document, payload, "difficulty"), filters.difficulty)
    && equalsFilter(readGeneratedQuestionField(document, payload, "question_type"), filters.question_type)
    && equalsFilter(readGeneratedQuestionField(document, payload, "content_mode"), filters.content_mode)
    && equalsFilter(readGeneratedQuestionField(document, payload, "algorithm"), filters.algorithm);
}

function buildGeneratedQuestionLibraryItems(
  document: QuestionPortraitDocument,
  filters: GeneratedQuestionSearchFilters,
): GeneratedQuestionLibraryItem[] {
  if (isPortraitArchived(document)) {
    return [];
  }
  const messages = normalizeQuestionPortraitMessages(document.messages);
  const items: GeneratedQuestionLibraryItem[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.kind !== "generated_question" || !isGeneratedQuestionPayload(message.payload)) {
      continue;
    }
    if (!generatedQuestionMatchesFilters(document, message.payload, filters)) {
      continue;
    }
    const requestId = normalizeFilterValue(message.request_id);
    const createdAt = normalizeFilterValue(message.created_at) || normalizeFilterValue(document.updated_at);
    items.push({
      question_id: requestId || `${document.portrait_id}-${index + 1}`,
      portrait_id: document.portrait_id,
      request_id: requestId,
      subject: readGeneratedQuestionField(document, message.payload, "subject"),
      knowledge_point: readGeneratedQuestionField(document, message.payload, "knowledge_point"),
      difficulty: readGeneratedQuestionField(document, message.payload, "difficulty"),
      question_type: readGeneratedQuestionField(document, message.payload, "question_type"),
      content_mode: readGeneratedQuestionField(document, message.payload, "content_mode"),
      algorithm: readGeneratedQuestionField(document, message.payload, "algorithm"),
      created_at: createdAt,
      updated_at: normalizeFilterValue(document.updated_at) || createdAt,
      result: message.payload,
    });
  }
  return items;
}

function applyGeneratedQuestionSearchLimit(
  items: GeneratedQuestionLibraryItem[],
  limit: number | undefined,
): GeneratedQuestionLibraryItem[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Number(limit))) : 50;
  return [...items]
    .sort((left, right) => (Date.parse(right.created_at) || 0) - (Date.parse(left.created_at) || 0))
    .slice(0, normalizedLimit);
}

export function createInMemoryQuestionPortraitStore(): QuestionPortraitStore {
  const documents = new Map<string, QuestionPortraitDocument>();
  const runPortraitLock = createAsyncKeyedLock();

  return {
    load(ownerUid: string, portraitId: string): Promise<QuestionPortraitDocument | null> {
      const document = documents.get(portraitId);
      if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(cloneDocument(document));
    },
    save(document: QuestionPortraitDocument): Promise<QuestionPortraitDocument> {
      return runPortraitLock(document.portrait_id, () => {
        const cloned = sanitizeQuestionPortraitDocument(cloneDocument(document));
        documents.set(document.portrait_id, cloned);
        return cloneDocument(cloned);
      });
    },
    saveIfLatestPendingTurn(
      ownerUid: string,
      portraitId: string,
      turnId: string,
      document: QuestionPortraitDocument,
    ): Promise<QuestionPortraitDocument | null> {
      return runPortraitLock(portraitId, () => {
        const current = documents.get(portraitId);
        if (
          !current
          || current.owner_uid !== ownerUid
          || isPortraitArchived(current)
          || document.owner_uid !== ownerUid
          || document.portrait_id !== portraitId
          || !isLatestPendingQuestionPortraitTurn(normalizeQuestionPortraitMessages(current.messages), turnId)
        ) {
          return null;
        }
        const nextDocument = sanitizeQuestionPortraitDocument(cloneDocument(document));
        documents.set(portraitId, nextDocument);
        return cloneDocument(nextDocument);
      });
    },
    appendMessage(
      ownerUid: string,
      portraitId: string,
      message: QuestionPortraitMessage,
    ): Promise<QuestionPortraitDocument | null> {
      return runPortraitLock(portraitId, () => {
        const document = documents.get(portraitId);
        if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
          return null;
        }
        const normalized = normalizeQuestionPortraitMessage(message);
        if (!normalized) {
          return cloneDocument(document);
        }
        const existingMessages = normalizeQuestionPortraitMessages(document.messages);
        const preparedMessages = prepareQuestionPortraitMessagesForAppend(existingMessages, normalized);
        if (!preparedMessages) {
          return cloneDocument(document);
        }
        const nextDocument = sanitizeQuestionPortraitDocument({
          ...document,
          messages: [...preparedMessages, normalized],
        });
        documents.set(portraitId, nextDocument);
        return cloneDocument(nextDocument);
      });
    },
    archive(ownerUid: string, portraitId: string): Promise<boolean> {
      return runPortraitLock(portraitId, () => {
        const document = documents.get(portraitId);
        if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
          return false;
        }
        documents.set(portraitId, {
          ...document,
          archived_at: new Date().toISOString(),
        });
        return true;
      });
    },
    list(ownerUid: string): Promise<QuestionPortraitListItem[]> {
      const items = Array.from(documents.values())
        .filter((document) => document.owner_uid === ownerUid && !isPortraitArchived(document))
        .map((document) => toPortraitListItem(document));
      return Promise.resolve(sortPortraitsByUpdatedAtDescending(items));
    },
    searchGeneratedQuestions(ownerUid: string, filters: GeneratedQuestionSearchFilters): Promise<GeneratedQuestionLibraryItem[]> {
      const items = Array.from(documents.values())
        .filter((document) => document.owner_uid === ownerUid && !isPortraitArchived(document))
        .flatMap((document) => buildGeneratedQuestionLibraryItems(document, filters));
      return Promise.resolve(applyGeneratedQuestionSearchLimit(items, filters.limit));
    },
  };
}

export function createFileSystemQuestionPortraitStore(
  options: FileSystemQuestionPortraitStoreOptions,
): QuestionPortraitStore {
  const baseDirectory = path.join(options.baseDirectory, "question-portraits");
  const runPortraitLock = createAsyncKeyedLock();
  ensureDirectory(baseDirectory);

  function getPortraitDirectory(portraitId: string): string {
    return path.join(baseDirectory, portraitId);
  }

  function getStatePath(portraitId: string): string {
    return path.join(getPortraitDirectory(portraitId), "state.json");
  }

  function getMarkdownPath(portraitId: string): string {
    return path.join(getPortraitDirectory(portraitId), "portrait.md");
  }

  function getHistoryPath(portraitId: string): string {
    return path.join(getPortraitDirectory(portraitId), "history.json");
  }

  function readHistoryMessages(
    portraitId: string,
    fallbackDocument: QuestionPortraitDocument,
  ): QuestionPortraitMessage[] {
    const historyPath = getHistoryPath(portraitId);
    if (fs.existsSync(historyPath)) {
      try {
        const history = readJsonFile(historyPath);
        if (isRecord(history)) {
          return normalizeQuestionPortraitMessages(history.messages);
        }
      } catch {
        return [];
      }
    }
    return normalizeQuestionPortraitMessages(fallbackDocument.messages);
  }

  function writeHistoryFile(document: QuestionPortraitDocument): void {
    const historyPath = getHistoryPath(document.portrait_id);
    const history = createQuestionPortraitHistorySnapshot(document);
    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8");
  }

  return {
    load(ownerUid: string, portraitId: string): Promise<QuestionPortraitDocument | null> {
      const statePath = getStatePath(portraitId);
      if (!fs.existsSync(statePath)) {
        return Promise.resolve(null);
      }
      const document = normalizeQuestionPortraitDocument(readJsonFile(statePath));
      if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
        return Promise.resolve(null);
      }
      const markdownPath = getMarkdownPath(portraitId);
      const messages = readHistoryMessages(portraitId, document);
      return Promise.resolve(sanitizeQuestionPortraitDocument({
        ...document,
        messages,
        markdown_path: markdownPath,
      }));
    },
    save(document: QuestionPortraitDocument): Promise<QuestionPortraitDocument> {
      return runPortraitLock(document.portrait_id, () => {
        const portraitDirectory = getPortraitDirectory(document.portrait_id);
        const statePath = getStatePath(document.portrait_id);
        const markdownPath = getMarkdownPath(document.portrait_id);
        ensureDirectory(portraitDirectory);
        const nextDocument = sanitizeQuestionPortraitDocument({
          ...document,
          markdown_path: markdownPath,
        });
        const stateDocument = createQuestionPortraitStateSnapshot(nextDocument);
        fs.writeFileSync(statePath, JSON.stringify(stateDocument, null, 2), "utf-8");
        fs.writeFileSync(markdownPath, nextDocument.markdown, "utf-8");
        writeHistoryFile(nextDocument);
        return nextDocument;
      });
    },
    saveIfLatestPendingTurn(
      ownerUid: string,
      portraitId: string,
      turnId: string,
      document: QuestionPortraitDocument,
    ): Promise<QuestionPortraitDocument | null> {
      return runPortraitLock(portraitId, () => {
        const statePath = getStatePath(portraitId);
        if (!fs.existsSync(statePath) || document.owner_uid !== ownerUid || document.portrait_id !== portraitId) {
          return null;
        }
        const current = normalizeQuestionPortraitDocument(readJsonFile(statePath));
        if (!current || current.owner_uid !== ownerUid || isPortraitArchived(current)) {
          return null;
        }
        const currentMessages = readHistoryMessages(portraitId, current);
        if (!isLatestPendingQuestionPortraitTurn(currentMessages, turnId)) {
          return null;
        }
        const portraitDirectory = getPortraitDirectory(portraitId);
        const markdownPath = getMarkdownPath(portraitId);
        ensureDirectory(portraitDirectory);
        const nextDocument = sanitizeQuestionPortraitDocument({
          ...document,
          markdown_path: markdownPath,
        });
        const stateDocument = createQuestionPortraitStateSnapshot(nextDocument);
        fs.writeFileSync(statePath, JSON.stringify(stateDocument, null, 2), "utf-8");
        fs.writeFileSync(markdownPath, nextDocument.markdown, "utf-8");
        writeHistoryFile(nextDocument);
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
        const normalized = normalizeQuestionPortraitMessage(message);
        if (!normalized) {
          return document;
        }
        const existingMessages = normalizeQuestionPortraitMessages(document.messages);
        const preparedMessages = prepareQuestionPortraitMessagesForAppend(existingMessages, normalized);
        if (!preparedMessages) {
          return document;
        }
        const nextDocument = sanitizeQuestionPortraitDocument({
          ...document,
          messages: [...preparedMessages, normalized],
        });
        const statePath = getStatePath(portraitId);
        const markdownPath = getMarkdownPath(portraitId);
        const stateDocument = createQuestionPortraitStateSnapshot(nextDocument);
        fs.writeFileSync(statePath, JSON.stringify(stateDocument, null, 2), "utf-8");
        fs.writeFileSync(markdownPath, nextDocument.markdown, "utf-8");
        writeHistoryFile(nextDocument);
        return nextDocument;
      });
    },
    archive(ownerUid: string, portraitId: string): Promise<boolean> {
      return runPortraitLock(portraitId, () => {
        const statePath = getStatePath(portraitId);
        if (!fs.existsSync(statePath)) {
          return false;
        }
        const document = normalizeQuestionPortraitDocument(readJsonFile(statePath));
        if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
          return false;
        }
        const markdownPath = getMarkdownPath(portraitId);
        const nextDocument = sanitizeQuestionPortraitDocument({
          ...document,
          archived_at: new Date().toISOString(),
          markdown_path: markdownPath,
          messages: readHistoryMessages(portraitId, document),
        });
        const stateDocument = createQuestionPortraitStateSnapshot(nextDocument);
        fs.writeFileSync(statePath, JSON.stringify(stateDocument, null, 2), "utf-8");
        fs.writeFileSync(markdownPath, nextDocument.markdown, "utf-8");
        writeHistoryFile(nextDocument);
        return true;
      });
    },
    list(ownerUid: string): Promise<QuestionPortraitListItem[]> {
      const portraitIds = fs.readdirSync(baseDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      const items: QuestionPortraitListItem[] = [];
      for (const portraitId of portraitIds) {
        const statePath = getStatePath(portraitId);
        if (!fs.existsSync(statePath)) {
          continue;
        }
        const document = normalizeQuestionPortraitDocument(readJsonFile(statePath));
        if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
          continue;
        }
        items.push(toPortraitListItem(document, readHistoryMessages(portraitId, document)));
      }

      return Promise.resolve(sortPortraitsByUpdatedAtDescending(items));
    },
    searchGeneratedQuestions(ownerUid: string, filters: GeneratedQuestionSearchFilters): Promise<GeneratedQuestionLibraryItem[]> {
      const portraitIds = fs.readdirSync(baseDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      const items: GeneratedQuestionLibraryItem[] = [];
      for (const portraitId of portraitIds) {
        const statePath = getStatePath(portraitId);
        if (!fs.existsSync(statePath)) {
          continue;
        }
        const document = normalizeQuestionPortraitDocument(readJsonFile(statePath));
        if (!document || document.owner_uid !== ownerUid || isPortraitArchived(document)) {
          continue;
        }
        const documentWithHistory = {
          ...document,
          messages: readHistoryMessages(portraitId, document),
        };
        items.push(...buildGeneratedQuestionLibraryItems(documentWithHistory, filters));
      }

      return Promise.resolve(applyGeneratedQuestionSearchLimit(items, filters.limit));
    },
  };
}
