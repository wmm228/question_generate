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
  loadUsers(): Promise<UsersDB>;
  saveUsers(users: UsersDB): Promise<void>;
  loadSessions(): Promise<Record<string, unknown>>;
  saveSessions(sessions: SessionsDB): Promise<void>;
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
    loadUsers(): Promise<UsersDB> {
      return Promise.resolve(readJsonFile<UsersDB>(deps.usersPath, {}));
    },
    saveUsers(users: UsersDB): Promise<void> {
      writeJsonFile(deps.usersPath, users);
      return Promise.resolve();
    },
    loadSessions(): Promise<Record<string, unknown>> {
      return Promise.resolve(readJsonFile<Record<string, unknown>>(deps.sessionsPath, {}));
    },
    saveSessions(sessions: SessionsDB): Promise<void> {
      writeJsonFile(deps.sessionsPath, sessions);
      return Promise.resolve();
    },
  };
}

export function createInMemoryTutorAuthStore(
  options: InMemoryTutorAuthStoreOptions = {},
): TutorAuthStore {
  let users = cloneUsers(options.users ?? {});
  let sessions = cloneSessions(options.sessions ?? {});

  return {
    loadUsers(): Promise<UsersDB> {
      return Promise.resolve(cloneUsers(users));
    },
    saveUsers(nextUsers: UsersDB): Promise<void> {
      users = cloneUsers(nextUsers);
      return Promise.resolve();
    },
    loadSessions(): Promise<Record<string, unknown>> {
      return Promise.resolve(cloneSessions(sessions));
    },
    saveSessions(nextSessions: SessionsDB): Promise<void> {
      sessions = cloneSessions(nextSessions);
      return Promise.resolve();
    },
  };
}
