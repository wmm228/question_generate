import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";

import type { TutorAuthService } from "../services/tutor-auth";
import { logEvent } from "../utils/request";

export type AuthMiddleware = RequestHandler;
export type UidResolver = (req: Request) => string | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequestBody(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readSessionToken(req: Request): string | undefined {
  const tokenHeader = req.headers["x-session-token"];
  return typeof tokenHeader === "string" ? tokenHeader : undefined;
}

export function createUidResolver(authService: TutorAuthService): UidResolver {
  return (req: Request) => authService.getUidForToken(readSessionToken(req));
}

export function createRequireAuth(authService: TutorAuthService): AuthMiddleware {
  const getUidFromReq = createUidResolver(authService);
  return (req: Request, res: Response, next: NextFunction) => {
    if (!getUidFromReq(req)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function createAuthRouter(authService: TutorAuthService): Router {
  const router = Router();
  const getUidFromReq = createUidResolver(authService);

  router.post("/login", (req: Request, res: Response) => {
    const body = readRequestBody(req);
    const uid = readString(body.uid).trim();
    const password = readString(body.password);
    const result = authService.login(uid, password);
    if (!result.ok) {
      logEvent("warn", req, "auth.login.failed", { uid: uid || null, status_code: result.status });
      res.status(result.status).json({ error: result.error });
      return;
    }
    logEvent("info", req, "auth.login.completed", { uid: result.uid });
    res.json(result);
  });

  router.post("/register", (req: Request, res: Response) => {
    const body = readRequestBody(req);
    const uid = readString(body.uid).trim();
    const password = readString(body.password);
    const result = authService.register(uid, password);
    if (!result.ok) {
      logEvent("warn", req, "auth.register.failed", { uid: uid || null, status_code: result.status });
      res.status(result.status).json({ error: result.error });
      return;
    }
    logEvent("info", req, "auth.register.completed", { uid: result.uid });
    res.json(result);
  });

  router.post("/logout", (req: Request, res: Response) => {
    authService.logout(readSessionToken(req));
    logEvent("info", req, "auth.logout.completed");
    res.json({ ok: true });
  });

  router.get("/me", (req: Request, res: Response) => {
    const uid = getUidFromReq(req);
    if (!uid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ uid });
  });

  return router;
}
