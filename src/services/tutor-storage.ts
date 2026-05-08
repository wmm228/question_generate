import fs from "fs";
import path from "path";

import type { TutorServerPaths, TutorStateBackend } from "./server-paths";
import {
  createFileSystemAiGenerateStatusStore,
  createInMemoryAiGenerateStatusStore,
  type AiGenerateStatusStore,
} from "./ai-generate-status";
import {
  createFileSystemQuestionPortraitStore,
  createInMemoryQuestionPortraitStore,
  type QuestionPortraitStore,
} from "./question-portrait-store";
import { createInMemoryTutorAuthStore, createJsonFileTutorAuthStore, type TutorAuthStore } from "./tutor-auth-store";

export interface CreateTutorStorageDependencies {
  backend: TutorStateBackend;
  paths: Pick<TutorServerPaths, "usersPath" | "sessionsPath" | "stateDirectory">;
}

export interface TutorStorage {
  backend: TutorStateBackend;
  authStore: TutorAuthStore;
  aiGenerateStatusStore: AiGenerateStatusStore;
  questionPortraitStore: QuestionPortraitStore;
  paths: {
    stateDirectory: string;
    usersPath: string | null;
    sessionsPath: string | null;
  };
}

function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function seedFileIfMissing(sourcePath: string, targetPath: string): void {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath) || sourcePath === targetPath) {
    return;
  }
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
}

export function createTutorStorage(deps: CreateTutorStorageDependencies): TutorStorage {
  if (deps.backend === "memory") {
    return {
      backend: "memory",
      authStore: createInMemoryTutorAuthStore(),
      aiGenerateStatusStore: createInMemoryAiGenerateStatusStore(),
      questionPortraitStore: createInMemoryQuestionPortraitStore(),
      paths: {
        stateDirectory: deps.paths.stateDirectory,
        usersPath: null,
        sessionsPath: null,
      },
    };
  }

  ensureDirectory(deps.paths.stateDirectory);
  const authDirectory = path.join(deps.paths.stateDirectory, "auth");
  const usersPath = path.join(authDirectory, "users.json");
  const sessionsPath = path.join(authDirectory, "sessions.json");
  ensureDirectory(authDirectory);
  seedFileIfMissing(deps.paths.usersPath, usersPath);
  seedFileIfMissing(deps.paths.sessionsPath, sessionsPath);
  return {
    backend: "filesystem",
    authStore: createJsonFileTutorAuthStore({
      usersPath,
      sessionsPath,
    }),
    aiGenerateStatusStore: createFileSystemAiGenerateStatusStore({
      baseDirectory: deps.paths.stateDirectory,
    }),
    questionPortraitStore: createFileSystemQuestionPortraitStore({
      baseDirectory: deps.paths.stateDirectory,
    }),
    paths: {
      stateDirectory: deps.paths.stateDirectory,
      usersPath,
      sessionsPath,
    },
  };
}
