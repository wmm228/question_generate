import fs from "fs";
import path from "path";

import type { QuestionPortraitDocument } from "../types/question-portrait";

export interface QuestionPortraitListItem {
  portrait_id: string;
  title: string;
  status: string;
  pending_field: string;
  summary: string;
  updated_at: string;
  created_at: string;
}

export interface QuestionPortraitStore {
  load(ownerUid: string, portraitId: string): QuestionPortraitDocument | null;
  save(document: QuestionPortraitDocument): QuestionPortraitDocument;
  list(ownerUid: string): QuestionPortraitListItem[];
}

interface FileSystemQuestionPortraitStoreOptions {
  baseDirectory: string;
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

function normalizeQuestionPortraitDocument(value: unknown): QuestionPortraitDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!normalizeString(value.portrait_id) || !normalizeString(value.owner_uid) || !isRecord(value.draft)) {
    return null;
  }
  return value as unknown as QuestionPortraitDocument;
}

function toPortraitListItem(document: QuestionPortraitDocument): QuestionPortraitListItem {
  return {
    portrait_id: document.portrait_id,
    title: document.title,
    status: document.status,
    pending_field: document.pending_field,
    summary: document.summary,
    updated_at: document.updated_at,
    created_at: document.created_at,
  };
}

function sortPortraitsByUpdatedAtDescending(items: QuestionPortraitListItem[]): QuestionPortraitListItem[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.updated_at) || 0;
    const rightTime = Date.parse(right.updated_at) || 0;
    return rightTime - leftTime;
  });
}

export function createInMemoryQuestionPortraitStore(): QuestionPortraitStore {
  const documents = new Map<string, QuestionPortraitDocument>();

  return {
    load(ownerUid: string, portraitId: string): QuestionPortraitDocument | null {
      const document = documents.get(portraitId);
      if (!document || document.owner_uid !== ownerUid) {
        return null;
      }
      return JSON.parse(JSON.stringify(document)) as QuestionPortraitDocument;
    },
    save(document: QuestionPortraitDocument): QuestionPortraitDocument {
      const cloned = JSON.parse(JSON.stringify(document)) as QuestionPortraitDocument;
      documents.set(document.portrait_id, cloned);
      return JSON.parse(JSON.stringify(cloned)) as QuestionPortraitDocument;
    },
    list(ownerUid: string): QuestionPortraitListItem[] {
      const items = Array.from(documents.values())
        .filter((document) => document.owner_uid === ownerUid)
        .map((document) => toPortraitListItem(document));
      return sortPortraitsByUpdatedAtDescending(items);
    },
  };
}

export function createFileSystemQuestionPortraitStore(
  options: FileSystemQuestionPortraitStoreOptions,
): QuestionPortraitStore {
  const baseDirectory = path.join(options.baseDirectory, "question-portraits");
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

  return {
    load(ownerUid: string, portraitId: string): QuestionPortraitDocument | null {
      const statePath = getStatePath(portraitId);
      if (!fs.existsSync(statePath)) {
        return null;
      }
      const document = normalizeQuestionPortraitDocument(readJsonFile(statePath));
      if (!document || document.owner_uid !== ownerUid) {
        return null;
      }
      const markdownPath = getMarkdownPath(portraitId);
      return {
        ...document,
        markdown_path: markdownPath,
      };
    },
    save(document: QuestionPortraitDocument): QuestionPortraitDocument {
      const portraitDirectory = getPortraitDirectory(document.portrait_id);
      const statePath = getStatePath(document.portrait_id);
      const markdownPath = getMarkdownPath(document.portrait_id);
      ensureDirectory(portraitDirectory);
      const nextDocument: QuestionPortraitDocument = {
        ...document,
        markdown_path: markdownPath,
      };
      fs.writeFileSync(statePath, JSON.stringify(nextDocument, null, 2), "utf-8");
      fs.writeFileSync(markdownPath, nextDocument.markdown, "utf-8");
      return nextDocument;
    },
    list(ownerUid: string): QuestionPortraitListItem[] {
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
        if (!document || document.owner_uid !== ownerUid) {
          continue;
        }
        items.push(toPortraitListItem(document));
      }

      return sortPortraitsByUpdatedAtDescending(items);
    },
  };
}
