import { createHash, randomBytes } from "crypto";
import type { SessionRecord, SessionsDB, TutorAuthStore, UsersDB } from "./tutor-auth-store";

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
  register(uid: string, password: string): Promise<TutorAuthResult>;
  logout(token: string | undefined): Promise<void>;
  getUidForToken(token: string | undefined): Promise<string | null>;
}

export interface TutorAuthServiceDependencies {
  store: TutorAuthStore;
  sessionTtlMs: number;
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

export function createTutorAuthService(deps: TutorAuthServiceDependencies): TutorAuthService {
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
    const token = randomBytes(24).toString("hex");
    const sessions = await loadSessions();
    sessions[token] = buildSessionRecord(uid, deps.sessionTtlMs);
    await saveSessions(sessions);
    return { ok: true, token, uid };
  }

  return {
    async login(uid: string, password: string): Promise<TutorAuthResult> {
      if (!uid || !password) {
        return { ok: false, status: 400, error: "uid and password are required" };
      }
      const users = await loadUsers();
      const user = users[uid];
      if (!user || user.password_hash !== hashPassword(password)) {
        return { ok: false, status: 401, error: "invalid username or password" };
      }
      return createSession(uid);
    },
    async register(uid: string, password: string): Promise<TutorAuthResult> {
      if (!uid || !password) {
        return { ok: false, status: 400, error: "uid and password are required" };
      }
      if (!/^[a-zA-Z0-9_-]{2,20}$/.test(uid)) {
        return { ok: false, status: 400, error: "uid must match [a-zA-Z0-9_-]{2,20}" };
      }
      if (password.length < 6) {
        return { ok: false, status: 400, error: "password must be at least 6 characters" };
      }
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
      return createSession(uid);
    },
    async logout(token: string | undefined): Promise<void> {
      if (!token) {
        return;
      }
      const sessions = await loadSessions();
      if (!sessions[token]) {
        return;
      }
      delete sessions[token];
      await saveSessions(sessions);
    },
    async getUidForToken(token: string | undefined): Promise<string | null> {
      if (!token) {
        return null;
      }
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
    },
  };
}
