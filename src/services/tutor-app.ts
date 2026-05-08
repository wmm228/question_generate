import express, { type Express, type Request, type Response } from "express";

import { createAuthRouter, createRequireAuth, createUidResolver } from "../routes/auth";
import { createQuestionAgentRouter } from "../routes/question-agent";
import { createTutorFrontendRouter } from "../routes/tutor-frontend";
import type { ServerRuntime } from "./server-runtime";
import type { TutorServerEnvironment, TutorServerPaths } from "./server-paths";
import { createTutorAuthService } from "./tutor-auth";
import { createTutorStorage } from "./tutor-storage";
import { logEvent } from "../utils/request";

export interface CreateTutorAppDependencies {
  startupId: string;
  runtime: ServerRuntime;
  paths: TutorServerPaths;
  environment: TutorServerEnvironment;
}

export interface TutorApp {
  app: Express;
  close(): void;
}

function applyNoCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

export function createTutorApp(deps: CreateTutorAppDependencies): TutorApp {
  const app = express();
  const storage = createTutorStorage({
    backend: deps.environment.storageBackend,
    paths: {
      usersPath: deps.paths.usersPath,
      sessionsPath: deps.paths.sessionsPath,
      stateDirectory: deps.paths.stateDirectory,
    },
  });
  const authService = createTutorAuthService({
    store: storage.authStore,
    sessionTtlMs: deps.environment.sessionTtlMs,
  });
  const requireAuth = createRequireAuth(authService);
  const getUidFromReq = createUidResolver(authService);

  logEvent("info", null, "server.paths.resolved", {
    app_root: deps.paths.appRoot,
    workspace_root: deps.paths.workspaceRoot,
    env_path: deps.paths.envPath,
    static_dir: deps.paths.staticDirectory,
    resources_dir: deps.paths.resourcesDirectory,
    storage_backend: storage.backend,
    storage_directory: deps.paths.stateDirectory,
    storage_users_path: storage.paths.usersPath,
    storage_sessions_path: storage.paths.sessionsPath,
  });

  app.use((req: Request, res: Response, next) => {
    applyNoCacheHeaders(res);
    next();
  });
  app.use((req: Request, res: Response, next) => {
    const startedAt = Date.now();
    logEvent("info", req, "http.request.started", {
      method: req.method,
      path: req.path,
    });
    res.on("finish", () => {
      logEvent("info", req, "http.request.completed", {
        method: req.method,
        path: req.path,
        status_code: res.statusCode,
        duration_ms: Date.now() - startedAt,
      });
    });
    next();
  });
  app.use(express.json({ limit: "20mb" }));
  app.use("/static", express.static(deps.paths.staticDirectory, {
    etag: false,
    maxAge: 0,
    setHeaders: (res) => {
      applyNoCacheHeaders(res);
    },
  }));

  app.use(createTutorFrontendRouter({
    startupId: deps.startupId,
    staticDirectory: deps.paths.staticDirectory,
    workspaceRoot: deps.paths.workspaceRoot,
    questionAgentWorkbenchHtmlPath: deps.paths.questionAgentWorkbenchHtmlPath,
  }));
  app.use("/api", createAuthRouter(authService));
  app.use("/api/ai-question", createQuestionAgentRouter({
    requireAuth,
    statusStore: storage.aiGenerateStatusStore,
    getUidFromReq,
    portraitStore: storage.questionPortraitStore,
  }));

  return {
    app,
    close(): void {
      return;
    },
  };
}
