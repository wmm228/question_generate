import { createHash, randomBytes } from "crypto";
import type { SessionRecord, SessionsDB, TutorAuthStore, UsersDB } from "./tutor-auth-store";
import { createAsyncKeyedLock } from "./async-lock";
import {
  createZitadelAuthClient,
  ZitadelRequestError,
  type ZitadelAuthClient,
  type ZitadelAuthConfig,
} from "./zitadel-auth";

export interface TutorAuthSuccessResult {
  ok: true;
  token: string;
  uid: string;
}

export interface TutorAuthFailureResult {
  ok: false;
  status: number;
  error: string;
}

export type TutorAuthResult = TutorAuthSuccessResult | TutorAuthFailureResult;

export interface TutorAuthService {
  login(uid: string, password: string): Promise<TutorAuthResult>;
  register(uid: string, password: string, options?: TutorRegisterOptions): Promise<TutorAuthResult>;
  logout(token: string | undefined): Promise<void>;
  getUidForToken(token: string | undefined): Promise<string | null>;
}

export interface TutorRegisterOptions {
  email?: string;
  displayName?: string;
}

export interface TutorAuthServiceDependencies {
  store: TutorAuthStore;
  sessionTtlMs: number;
  zitadel?: ZitadelAuthConfig | null;
  zitadelEnabled?: boolean;
  authBypassUid?: string;
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function buildSessionRecord(uid: string, sessionTtlMs: number, createdAt = new Date()): SessionRecord {
  return {
    uid,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + sessionTtlMs).toISOString(),
  };
}

function normalizeSessionRecord(value: unknown, sessionTtlMs: number): SessionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const session = value as Partial<SessionRecord>;
  if (typeof session.uid !== "string" || !session.uid.trim()) {
    return null;
  }
  const createdAt = isValidIsoDate(session.createdAt) ? session.createdAt : new Date().toISOString();
  const createdAtMs = Date.parse(createdAt);
  const expiresAt = isValidIsoDate(session.expiresAt)
    ? session.expiresAt
    : new Date(createdAtMs + sessionTtlMs).toISOString();
  if (Date.parse(expiresAt) <= Date.now()) {
    return null;
  }
  return isValidIsoDate(session.lastSeenAt)
    ? { uid: session.uid, createdAt, expiresAt, lastSeenAt: session.lastSeenAt }
    : { uid: session.uid, createdAt, expiresAt };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isZitadelAuthConfigured(deps: TutorAuthServiceDependencies): boolean {
  return Boolean(deps.zitadel?.baseUrl && deps.zitadel.personalAccessToken);
}

function isStrongRegisterPassword(value: string): boolean {
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function readZitadelErrorText(error: ZitadelRequestError): string {
  const parts = [error.code, error.message];
  if (error.payload && typeof error.payload === "object" && !Array.isArray(error.payload)) {
    const payload = error.payload as Record<string, unknown>;
    for (const key of ["code", "message", "error", "details"]) {
      const value = payload[key];
      if (typeof value === "string") {
        parts.push(value);
      }
    }
  }
  return parts.join(" ").toLowerCase();
}

function translateZitadelRegisterValidationError(error: ZitadelRequestError): TutorAuthFailureResult {
  const errorText = readZitadelErrorText(error);
  if (
    error.status === 409
    || errorText.includes("already")
    || errorText.includes("exists")
    || errorText.includes("unique")
    || errorText.includes("duplicate")
  ) {
    return {
      ok: false,
      status: 409,
      error: "用户名或邮箱已存在，请换一个用户名/邮箱，或切到登录页直接登录。",
    };
  }
  if (errorText.includes("password") || errorText.includes("passwort") || errorText.includes("policy")) {
    return {
      ok: false,
      status: 400,
      error: "密码未通过 ZITADEL 策略：请至少 8 位，并同时包含大写字母、小写字母、数字和特殊符号。",
    };
  }
  if (errorText.includes("email") || errorText.includes("mail")) {
    return {
      ok: false,
      status: 400,
      error: "邮箱未通过 ZITADEL 校验，请确认邮箱格式或换一个邮箱。",
    };
  }
  if (errorText.includes("username") || errorText.includes("login")) {
    return {
      ok: false,
      status: 400,
      error: "用户名未通过 ZITADEL 校验，请使用 2-20 位字母、数字、下划线或短横线。",
    };
  }
  return { ok: false, status: 400, error: "注册信息未通过 ZITADEL 校验，请换一个用户名/邮箱并使用更强密码。" };
}

function translateZitadelAuthError(error: unknown, mode: "login" | "register"): TutorAuthFailureResult {
  if (error instanceof ZitadelRequestError) {
    if (error.status === 401 || error.status === 403) {
      if (mode === "login") {
        return { ok: false, status: 401, error: "用户名或密码错误" };
      }
      return { ok: false, status: 502, error: "ZITADEL 服务认证失败，请检查 PAT 权限" };
    }
    if (mode === "register" && (error.status === 400 || error.status === 409)) {
      return translateZitadelRegisterValidationError(error);
    }
    if (error.status === 400) {
      return {
        ok: false,
        status: mode === "login" ? 401 : 400,
        error: mode === "login" ? "用户名或密码错误" : "注册信息未通过 ZITADEL 校验",
      };
    }
    return { ok: false, status: 502, error: "ZITADEL 服务暂不可用" };
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("timeout") || message.includes("aborted")) {
    return { ok: false, status: 504, error: "连接 ZITADEL 超时" };
  }
  return { ok: false, status: 502, error: "ZITADEL 服务暂不可用" };
}

export function createTutorAuthService(deps: TutorAuthServiceDependencies): TutorAuthService {
  const authBypassUid = (deps.authBypassUid || "").trim();
  const runAuthLock = createAsyncKeyedLock();
  const zitadelClient: ZitadelAuthClient | null = isZitadelAuthConfigured(deps)
    ? createZitadelAuthClient(deps.zitadel as ZitadelAuthConfig)
    : null;

  async function loadUsers(): Promise<UsersDB> {
    return deps.store.loadUsers();
  }

  async function saveUsers(users: UsersDB): Promise<void> {
    await deps.store.saveUsers(users);
  }

  async function loadSessions(): Promise<SessionsDB> {
    const raw = await deps.store.loadSessions();
    const sessions: SessionsDB = {};
    let changed = false;
    for (const [token, value] of Object.entries(raw)) {
      const session = normalizeSessionRecord(value, deps.sessionTtlMs);
      if (!session) {
        changed = true;
        continue;
      }
      sessions[token] = session;
      if (value !== session) {
        changed = true;
      }
    }
    if (changed) {
      await saveSessions(sessions);
    }
    return sessions;
  }

  async function saveSessions(sessions: SessionsDB): Promise<void> {
    await deps.store.saveSessions(sessions);
  }

  async function createSession(uid: string): Promise<TutorAuthSuccessResult> {
    return runAuthLock("sessions", async () => {
      const token = randomBytes(24).toString("hex");
      const sessions = await loadSessions();
      sessions[token] = buildSessionRecord(uid, deps.sessionTtlMs);
      await saveSessions(sessions);
      return { ok: true, token, uid };
    });
  }

  function readZitadelClient(): TutorAuthFailureResult | ZitadelAuthClient {
    if (!deps.zitadelEnabled) {
      return { ok: false, status: 500, error: "ZITADEL auth is not enabled" };
    }
    if (!zitadelClient) {
      return { ok: false, status: 500, error: "ZITADEL 登录服务未配置完整" };
    }
    return zitadelClient;
  }

  return {
    async login(uid: string, password: string): Promise<TutorAuthResult> {
      if (authBypassUid) {
        return createSession(authBypassUid);
      }
      if (!uid || !password) {
        return { ok: false, status: 400, error: "uid and password are required" };
      }
      if (deps.zitadelEnabled) {
        const client = readZitadelClient();
        if ("ok" in client) {
          return client;
        }
        try {
          const user = await client.login(uid, password);
          return createSession(user.uid);
        } catch (error) {
          return translateZitadelAuthError(error, "login");
        }
      }
      const users = await loadUsers();
      const user = users[uid];
      if (!user || user.password_hash !== hashPassword(password)) {
        return { ok: false, status: 401, error: "invalid username or password" };
      }
      return createSession(uid);
    },
    async register(uid: string, password: string, options: TutorRegisterOptions = {}): Promise<TutorAuthResult> {
      if (authBypassUid) {
        return createSession(authBypassUid);
      }
      if (!uid || !password) {
        return { ok: false, status: 400, error: "uid and password are required" };
      }
      if (!/^[a-zA-Z0-9_-]{2,20}$/.test(uid)) {
        return { ok: false, status: 400, error: "uid must match [a-zA-Z0-9_-]{2,20}" };
      }
      if (password.length < 6) {
        return { ok: false, status: 400, error: "password must be at least 6 characters" };
      }
      if (deps.zitadelEnabled) {
        if (!isStrongRegisterPassword(password)) {
          return {
            ok: false,
            status: 400,
            error: "密码至少 8 位，并且需要同时包含大写字母、小写字母、数字和特殊符号。",
          };
        }
        const email = (options.email || "").trim().toLowerCase();
        if (!isValidEmail(email)) {
          return { ok: false, status: 400, error: "请输入有效邮箱" };
        }
        const client = readZitadelClient();
        if ("ok" in client) {
          return client;
        }
        try {
          const user = await client.register({
            uid,
            password,
            email,
            displayName: options.displayName || uid,
          });
          return createSession(user.uid);
        } catch (error) {
          return translateZitadelAuthError(error, "register");
        }
      }
      const registerResult = await runAuthLock<TutorAuthFailureResult | null>("users", async () => {
        const users = await loadUsers();
        if (users[uid]) {
          return { ok: false, status: 409, error: "uid already exists" };
        }
        users[uid] = {
          uid,
          password_hash: hashPassword(password),
          created_at: new Date().toISOString(),
        };
        await saveUsers(users);
        return null;
      });
      if (registerResult) {
        return registerResult;
      }
      return createSession(uid);
    },
    async logout(token: string | undefined): Promise<void> {
      if (!token) {
        return;
      }
      await runAuthLock("sessions", async () => {
        const sessions = await loadSessions();
        if (!sessions[token]) {
          return;
        }
        delete sessions[token];
        await saveSessions(sessions);
      });
    },
    async getUidForToken(token: string | undefined): Promise<string | null> {
      if (authBypassUid) {
        return authBypassUid;
      }
      if (!token) {
        return null;
      }
      return runAuthLock("sessions", async () => {
        const sessions = await loadSessions();
        const session = sessions[token];
        if (!session) {
          return null;
        }
        if (Date.parse(session.expiresAt) <= Date.now()) {
          delete sessions[token];
          await saveSessions(sessions);
          return null;
        }
        return session.uid;
      });
    },
  };
}
