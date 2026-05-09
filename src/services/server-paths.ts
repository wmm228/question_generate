import fs from "fs";
import path from "path";

import dotenv from "dotenv";

export interface ResolveTutorServerPathsInput {
  currentWorkingDirectory: string;
  runtimeDirectory: string;
}

export interface TutorServerPaths {
  appRoot: string;
  workspaceRoot: string;
  envPath: string;
  staticDirectory: string;
  tutorHomeHtmlPath: string;
  questionAgentWorkbenchHtmlPath: string;
  resourcesDirectory: string;
  usersPath: string;
  sessionsPath: string;
  serverLockPath: string;
  stateDirectory: string;
}

export interface TutorPostgresConfig {
  connectionString: string | null;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  schema: string;
}

export type TutorStorageBackend = "memory" | "filesystem" | "postgres";
export type TutorStateBackend = TutorStorageBackend;

export interface TutorServerEnvironment {
  port: number;
  sessionTtlMs: number;
  storageBackend: TutorStorageBackend;
  postgres: TutorPostgresConfig;
}

const DEFAULT_PORT = 7896;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_POSTGRES_SCHEMA = "public";

function uniqueResolvedPaths(paths: string[]): string[] {
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
}

function resolveExistingPath(candidates: string[]): string {
  const resolvedCandidates = uniqueResolvedPaths(candidates);
  return resolvedCandidates.find((candidate) => fs.existsSync(candidate)) ?? resolvedCandidates[0];
}

function resolveResourceDirectory(appRoot: string, workspaceRoot: string, runtimeDirectory: string): string {
  const candidates = uniqueResolvedPaths([
    path.join(appRoot, "resources"),
    path.join(workspaceRoot, "resources"),
    path.resolve(runtimeDirectory, "../../resources"),
    path.resolve(runtimeDirectory, "../../../resources"),
  ]);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "database.json")))
    ?? candidates.find((candidate) => fs.existsSync(candidate))
    ?? candidates[0];
}

function normalizePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_PORT), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

function normalizeSessionTtlMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_SESSION_TTL_MS), 10);
  const ttlMs = Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_TTL_MS;
  return Math.max(ttlMs, 60 * 1000);
}

function normalizeStorageBackend(value: string | undefined): TutorStorageBackend {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "memory") {
    return "memory";
  }
  if (normalized === "postgres") {
    return "postgres";
  }
  return "filesystem";
}

function normalizeBoolean(value: string | undefined, fallback = false): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
}

function normalizePostgresPort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? String(DEFAULT_POSTGRES_PORT), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_POSTGRES_PORT;
}

function normalizePostgresSchema(value: string | undefined): string {
  const normalized = (value || "").trim();
  return normalized || DEFAULT_POSTGRES_SCHEMA;
}

function loadTutorPostgresConfig(): TutorPostgresConfig {
  return {
    connectionString: (process.env.DATABASE_URL || "").trim() || null,
    host: (process.env.POSTGRES_HOST || process.env.PGHOST || "127.0.0.1").trim(),
    port: normalizePostgresPort(process.env.POSTGRES_PORT || process.env.PGPORT),
    database: (process.env.POSTGRES_DB || process.env.PGDATABASE || "tutor").trim(),
    user: (process.env.POSTGRES_USER || process.env.PGUSER || "postgres").trim(),
    password: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || "",
    ssl: normalizeBoolean(process.env.POSTGRES_SSL || process.env.PGSSL, false),
    schema: normalizePostgresSchema(process.env.POSTGRES_SCHEMA),
  };
}

function resolveFrontendAssetPath(
  appRoot: string,
  workspaceRoot: string,
  runtimeDirectory: string,
  fileName: string,
): string {
  return resolveExistingPath([
    path.join(appRoot, "src", "frontend", fileName),
    path.join(workspaceRoot, "tutor", "src", "frontend", fileName),
    path.resolve(runtimeDirectory, "../frontend", fileName),
    path.resolve(runtimeDirectory, "../../../src/frontend", fileName),
  ]);
}

export function resolveTutorServerPaths(input: ResolveTutorServerPathsInput): TutorServerPaths {
  const appRoot = resolveExistingPath([
    input.currentWorkingDirectory,
    path.resolve(input.runtimeDirectory, ".."),
    path.resolve(input.runtimeDirectory, "../.."),
    path.resolve(input.runtimeDirectory, "../../.."),
  ]);
  const workspaceRoot = resolveExistingPath([
    path.resolve(appRoot, ".."),
    path.resolve(input.runtimeDirectory, "../../.."),
    path.resolve(input.runtimeDirectory, "../../../.."),
    path.resolve(input.runtimeDirectory, "../.."),
  ]);
  const envPath = resolveExistingPath([
    path.join(appRoot, ".env"),
    path.join(workspaceRoot, ".env"),
    path.resolve(input.runtimeDirectory, "../.env"),
    path.resolve(input.runtimeDirectory, "../../.env"),
    path.resolve(input.runtimeDirectory, "../../../.env"),
  ]);
  const resourcesDirectory = resolveResourceDirectory(appRoot, workspaceRoot, input.runtimeDirectory);

  return {
    appRoot,
    workspaceRoot,
    envPath,
    staticDirectory: resolveExistingPath([
      path.join(appRoot, "static"),
      path.join(workspaceRoot, "static"),
      path.resolve(input.runtimeDirectory, "../../static"),
      path.resolve(input.runtimeDirectory, "../../../static"),
    ]),
    tutorHomeHtmlPath: resolveFrontendAssetPath(
      appRoot,
      workspaceRoot,
      input.runtimeDirectory,
      "tutor-home.html",
    ),
    questionAgentWorkbenchHtmlPath: resolveFrontendAssetPath(
      appRoot,
      workspaceRoot,
      input.runtimeDirectory,
      "question-agent-workbench.html",
    ),
    resourcesDirectory,
    usersPath: resolveExistingPath([
      path.join(appRoot, "users.json"),
      path.join(workspaceRoot, "users.json"),
      path.resolve(input.runtimeDirectory, "../../users.json"),
      path.resolve(input.runtimeDirectory, "../../../users.json"),
    ]),
    sessionsPath: resolveExistingPath([
      path.join(appRoot, "sessions.json"),
      path.join(workspaceRoot, "sessions.json"),
      path.resolve(input.runtimeDirectory, "../../sessions.json"),
      path.resolve(input.runtimeDirectory, "../../../sessions.json"),
    ]),
    serverLockPath: path.join(appRoot, "server.lock.json"),
    stateDirectory: path.join(resourcesDirectory, "runtime-state"),
  };
}

export function loadTutorServerEnvironment(envPath: string): TutorServerEnvironment {
  dotenv.config({ path: envPath, quiet: true });
  return {
    port: normalizePort(process.env.TUTOR_PORT),
    sessionTtlMs: normalizeSessionTtlMs(process.env.SESSION_TTL_MS),
    storageBackend: normalizeStorageBackend(process.env.TUTOR_STORAGE_BACKEND ?? process.env.TUTOR_STATE_BACKEND),
    postgres: loadTutorPostgresConfig(),
  };
}
