import fs from "fs";
import path from "path";

import type { TutorPostgresConfig, TutorServerPaths, TutorStateBackend } from "./server-paths";
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
import {
  createFileSystemQuestionFeedbackStore,
  createInMemoryQuestionFeedbackStore,
  type QuestionFeedbackStore,
} from "./question-feedback-store";
import { createInMemoryTutorAuthStore, createJsonFileTutorAuthStore, type TutorAuthStore } from "./tutor-auth-store";
import { createTutorPostgresRuntime } from "./tutor-postgres";

export interface CreateTutorStorageDependencies {
  backend: TutorStateBackend;
  paths: Pick<TutorServerPaths, "usersPath" | "sessionsPath" | "stateDirectory">;
  postgres: TutorPostgresConfig;
}

export interface TutorStorage {
  backend: TutorStateBackend;
  authStore: TutorAuthStore;
  aiGenerateStatusStore: AiGenerateStatusStore;
  questionPortraitStore: QuestionPortraitStore;
  questionFeedbackStore: QuestionFeedbackStore;
  paths: {
    stateDirectory: string;
    usersPath: string | null;
    sessionsPath: string | null;
  };
  close(): Promise<void>;
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

export async function createTutorStorage(deps: CreateTutorStorageDependencies): Promise<TutorStorage> {
  if (deps.backend === "memory") {
    return {
      backend: "memory",
      authStore: createInMemoryTutorAuthStore(),
      aiGenerateStatusStore: createInMemoryAiGenerateStatusStore(),
      questionPortraitStore: createInMemoryQuestionPortraitStore(),
      questionFeedbackStore: createInMemoryQuestionFeedbackStore(),
      paths: {
        stateDirectory: deps.paths.stateDirectory,
        usersPath: null,
        sessionsPath: null,
      },
      close(): Promise<void> {
        return Promise.resolve();
      },
    };
  }

  if (deps.backend === "postgres") {
    const runtime = await createTutorPostgresRuntime(deps.postgres);
    return {
      backend: "postgres",
      authStore: runtime.authStore,
      aiGenerateStatusStore: runtime.aiGenerateStatusStore,
      questionPortraitStore: runtime.questionPortraitStore,
      questionFeedbackStore: runtime.questionFeedbackStore,
      paths: {
        stateDirectory: deps.paths.stateDirectory,
        usersPath: null,
        sessionsPath: null,
      },
      close(): Promise<void> {
        return runtime.close();
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
    questionFeedbackStore: createFileSystemQuestionFeedbackStore({
      baseDirectory: deps.paths.stateDirectory,
    }),
    paths: {
      stateDirectory: deps.paths.stateDirectory,
      usersPath,
      sessionsPath,
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}
