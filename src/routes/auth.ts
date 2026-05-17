import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";

import type { TutorAuthService } from "../services/tutor-auth";
import { logEvent } from "../utils/request";

export type AuthMiddleware = RequestHandler;
export type UidResolver = (req: Request) => string | null;

interface AuthenticatedRequest extends Request {
  authUid?: string;
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

function readSessionToken(req: Request): string | undefined {
  const tokenHeader = req.headers["x-session-token"];
  return typeof tokenHeader === "string" ? tokenHeader : undefined;
}

export function createUidResolver(authService: TutorAuthService): UidResolver {
  void authService;
  return (req: Request) => {
    return (req as AuthenticatedRequest).authUid || null;
  };
}

export function createRequireAuth(authService: TutorAuthService): AuthMiddleware {
  return async (req: Request, res: Response, next: NextFunction) => {
    const uid = await authService.getUidForToken(readSessionToken(req));
    if (!uid) {
      res.status(401).json({ error: "Authentication required or session expired" });
      return;
    }
    (req as AuthenticatedRequest).authUid = uid;
    next();
  };
}

export function createAuthRouter(authService: TutorAuthService): Router {
  const router = Router();
  const getUidFromReq = createUidResolver(authService);

  router.post("/login", async (req: Request, res: Response) => {
    const body = readRequestBody(req);
    const uid = readString(body.uid).trim();
    const password = readString(body.password);
    const result = await authService.login(uid, password);
    if (!result.ok) {
      logEvent("warn", req, "auth.login.failed", { uid: uid || null, status_code: result.status });
      res.status(result.status).json({ error: result.error });
      return;
    }
    logEvent("info", req, "auth.login.completed", { uid: result.uid });
    res.json(result);
  });

  router.post("/register", async (req: Request, res: Response) => {
    const body = readRequestBody(req);
    const uid = readString(body.uid).trim();
    const password = readString(body.password);
    const email = readString(body.email).trim();
    const displayName = readString(body.displayName).trim();
    const result = await authService.register(uid, password, { email, displayName });
    if (!result.ok) {
      logEvent("warn", req, "auth.register.failed", { uid: uid || null, status_code: result.status });
      res.status(result.status).json({ error: result.error });
      return;
    }
    logEvent("info", req, "auth.register.completed", { uid: result.uid });
    res.json(result);
  });

  router.post("/logout", async (req: Request, res: Response) => {
    await authService.logout(readSessionToken(req));
    logEvent("info", req, "auth.logout.completed");
    res.json({ ok: true });
  });

  router.get("/me", async (req: Request, res: Response) => {
    const uid = await authService.getUidForToken(readSessionToken(req));
    if (!uid) {
      res.status(401).json({ error: "Authentication required or session expired" });
      return;
    }
    (req as AuthenticatedRequest).authUid = uid;
    res.json({ uid: getUidFromReq(req) });
  });

  return router;
}
