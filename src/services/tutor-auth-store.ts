import fs from "fs";

export interface UserRecord {
  uid: string;
  password_hash: string;
  created_at: string;
}

export type UsersDB = Record<string, UserRecord>;

export interface SessionRecord {
  uid: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt?: string;
}

export type SessionsDB = Record<string, SessionRecord>;

export interface TutorAuthStore {
  loadUsers(): UsersDB;
  saveUsers(users: UsersDB): void;
  loadSessions(): Record<string, unknown>;
  saveSessions(sessions: SessionsDB): void;
}

export interface JsonFileTutorAuthStoreDependencies {
  usersPath: string;
  sessionsPath: string;
}

export interface InMemoryTutorAuthStoreOptions {
  users?: UsersDB;
  sessions?: SessionsDB;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function cloneUsers(users: UsersDB): UsersDB {
  return Object.fromEntries(Object.entries(users).map(([uid, user]) => [uid, { ...user }]));
}

function cloneSessions(sessions: SessionsDB): SessionsDB {
  return Object.fromEntries(Object.entries(sessions).map(([token, session]) => [token, { ...session }]));
}

export function createJsonFileTutorAuthStore(
  deps: JsonFileTutorAuthStoreDependencies,
): TutorAuthStore {
  return {
    loadUsers(): UsersDB {
      return readJsonFile<UsersDB>(deps.usersPath, {});
    },
    saveUsers(users: UsersDB): void {
      writeJsonFile(deps.usersPath, users);
    },
    loadSessions(): Record<string, unknown> {
      return readJsonFile<Record<string, unknown>>(deps.sessionsPath, {});
    },
    saveSessions(sessions: SessionsDB): void {
      writeJsonFile(deps.sessionsPath, sessions);
    },
  };
}

export function createInMemoryTutorAuthStore(
  options: InMemoryTutorAuthStoreOptions = {},
): TutorAuthStore {
  let users = cloneUsers(options.users ?? {});
  let sessions = cloneSessions(options.sessions ?? {});

  return {
    loadUsers(): UsersDB {
      return cloneUsers(users);
    },
    saveUsers(nextUsers: UsersDB): void {
      users = cloneUsers(nextUsers);
    },
    loadSessions(): Record<string, unknown> {
      return cloneSessions(sessions);
    },
    saveSessions(nextSessions: SessionsDB): void {
      sessions = cloneSessions(nextSessions);
    },
  };
}
