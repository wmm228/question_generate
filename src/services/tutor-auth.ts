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
  login(uid: string, password: string): TutorAuthResult;
  register(uid: string, password: string): TutorAuthResult;
  logout(token: string | undefined): void;
  getUidForToken(token: string | undefined): string | null;
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
  function loadUsers(): UsersDB {
    return deps.store.loadUsers();
  }

  function saveUsers(users: UsersDB): void {
    deps.store.saveUsers(users);
  }

  function loadSessions(): SessionsDB {
    const raw = deps.store.loadSessions();
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
      saveSessions(sessions);
    }
    return sessions;
  }

  function saveSessions(sessions: SessionsDB): void {
    deps.store.saveSessions(sessions);
  }

  function createSession(uid: string): TutorAuthSuccessResult {
    const token = randomBytes(24).toString("hex");
    const sessions = loadSessions();
    sessions[token] = buildSessionRecord(uid, deps.sessionTtlMs);
    saveSessions(sessions);
    return { ok: true, token, uid };
  }

  return {
    login(uid: string, password: string): TutorAuthResult {
      if (!uid || !password) {
        return { ok: false, status: 400, error: "uid and password are required" };
      }
      const users = loadUsers();
      const user = users[uid];
      if (!user || user.password_hash !== hashPassword(password)) {
        return { ok: false, status: 401, error: "invalid username or password" };
      }
      return createSession(uid);
    },
    register(uid: string, password: string): TutorAuthResult {
      if (!uid || !password) {
        return { ok: false, status: 400, error: "uid and password are required" };
      }
      if (!/^[a-zA-Z0-9_-]{2,20}$/.test(uid)) {
        return { ok: false, status: 400, error: "uid must match [a-zA-Z0-9_-]{2,20}" };
      }
      if (password.length < 6) {
        return { ok: false, status: 400, error: "password must be at least 6 characters" };
      }
      const users = loadUsers();
      if (users[uid]) {
        return { ok: false, status: 409, error: "uid already exists" };
      }
      users[uid] = {
        uid,
        password_hash: hashPassword(password),
        created_at: new Date().toISOString(),
      };
      saveUsers(users);
      return createSession(uid);
    },
    logout(token: string | undefined): void {
      if (!token) {
        return;
      }
      const sessions = loadSessions();
      if (!sessions[token]) {
        return;
      }
      delete sessions[token];
      saveSessions(sessions);
    },
    getUidForToken(token: string | undefined): string | null {
      if (!token) {
        return null;
      }
      const sessions = loadSessions();
      const session = sessions[token];
      if (!session) {
        return null;
      }
      if (Date.parse(session.expiresAt) <= Date.now()) {
        delete sessions[token];
        saveSessions(sessions);
        return null;
      }
      return session.uid;
    },
  };
}
