import { Router, type Request, type Response } from "express";

import { renderLegacyTutorHtml } from "../services/legacy-frontend-html";
import { logEvent } from "../utils/request";

export interface TutorFrontendRouterDependencies {
  startupId: string;
  staticDirectory: string;
  workspaceRoot: string;
  questionAgentWorkbenchHtmlPath: string;
}

function setNoCacheHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequestBody(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sendHtmlFile(
  res: Response,
  htmlPath: string,
  errorMessage: string,
): void {
  setNoCacheHeaders(res);
  res.removeHeader("ETag");
  res.sendFile(htmlPath, (error: Error | undefined) => {
    if (!error) {
      return;
    }
    res.status(500).json({
      error: errorMessage,
      details: error.message,
    });
  });
}

export function createTutorFrontendRouter(deps: TutorFrontendRouterDependencies): Router {
  const router = Router();

  function sendLegacyFrontend(res: Response): void {
    setNoCacheHeaders(res);
    res.removeHeader("ETag");
    try {
      res.type("html").send(renderLegacyTutorHtml({
        staticDirectory: deps.staticDirectory,
        workspaceRoot: deps.workspaceRoot,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "legacy tutor frontend render failed";
      res.status(500).json({ error: "legacy tutor frontend unavailable", details: message });
    }
  }

  router.get("/api/ping", (_req: Request, res: Response) => {
    setNoCacheHeaders(res);
    res.json({ ok: true, startupId: deps.startupId, pid: process.pid, now: new Date().toISOString() });
  });

  router.get("/", (_req: Request, res: Response) => {
    sendHtmlFile(res, deps.questionAgentWorkbenchHtmlPath, "question agent workbench unavailable");
  });

  router.get("/legacy-tutor-ui", (_req: Request, res: Response) => {
    sendLegacyFrontend(res);
  });

  router.get("/home", (_req: Request, res: Response) => {
    sendHtmlFile(res, deps.questionAgentWorkbenchHtmlPath, "question agent workbench unavailable");
  });

  router.get("/question-agent-workbench", (_req: Request, res: Response) => {
    sendHtmlFile(res, deps.questionAgentWorkbenchHtmlPath, "question agent workbench unavailable");
  });

  router.post("/api/log", (req: Request, res: Response) => {
    const message = readString(readRequestBody(req).msg);
    logEvent("info", req, "browser.log", { message });
    res.json({ ok: true });
  });

  return router;
}
