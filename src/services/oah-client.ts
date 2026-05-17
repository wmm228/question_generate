interface OahWorkspace {
  id: string;
  name: string;
  ownerId?: string;
  runtime?: string;
  serviceName?: string;
  status: "active" | "archived" | "disabled";
}

interface OahWorkspacePage {
  items: OahWorkspace[];
  nextCursor?: string;
}

interface OahWorkspaceCatalogAgent {
  name: string;
  mode?: string;
  source?: string;
  description?: string;
}

interface OahWorkspaceCatalogTool {
  name: string;
  transportType?: string;
  toolPrefix?: string;
}

interface OahWorkspaceCatalogModel {
  ref?: string;
  name?: string;
  source?: string;
  provider?: string;
  modelName?: string;
  url?: string;
}

interface OahWorkspaceCatalog {
  workspaceId: string;
  agents: OahWorkspaceCatalogAgent[];
  tools: OahWorkspaceCatalogTool[];
  models: OahWorkspaceCatalogModel[];
  nativeTools?: string[];
  engineTools?: string[];
}

interface OahHealthReport {
  status: string;
  storage?: Record<string, unknown>;
  process?: Record<string, unknown>;
  sandbox?: Record<string, unknown>;
  checks?: Record<string, unknown>;
  worker?: {
    mode?: string;
    draining?: boolean;
    acceptsNewRuns?: boolean;
    activeWorkers?: unknown[];
    summary?: {
      active?: number;
      healthy?: number;
      late?: number;
      busy?: number;
      embedded?: number;
      standalone?: number;
    };
  };
}

interface OahSession {
  id: string;
}

interface OahCreateSessionRequest {
  title?: string;
  agentName?: string;
  modelRef?: string;
}

interface OahMessageAccepted {
  messageId: string;
  runId: string;
  status: "queued";
}

interface OahRun {
  id: string;
  status: "queued" | "running" | "waiting_tool" | "completed" | "failed" | "cancelled" | "timed_out";
  errorCode?: string;
  errorMessage?: string;
}

interface OahMessageTextPart {
  type: "text" | "reasoning";
  text: string;
}

interface OahToolResultOutput {
  type?: string;
  value?: unknown;
}

interface OahToolResultPart {
  type: "tool-result";
  output?: OahToolResultOutput;
}

interface OahToolOnlyPart {
  type: "tool-call" | "tool-approval-request" | "tool-approval-response" | "image" | "file";
}

type OahMessagePart = OahMessageTextPart | OahToolResultPart | OahToolOnlyPart;

interface OahMessageRecord {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  runId?: string;
  content: string | OahMessagePart[];
  createdAt: string;
}

interface OahMessagePage {
  items: OahMessageRecord[];
  nextCursor?: string;
}

export interface OahTextPart {
  type: "text";
  text: string;
}

export interface OahImagePart {
  type: "image";
  image: string;
  mediaType?: string;
}

export interface OahFilePart {
  type: "file";
  data: string;
  filename?: string;
  mediaType: string;
}

export type OahUserMessageContent = string | Array<OahTextPart | OahImagePart | OahFilePart>;

export interface OahSessionRunOptions {
  baseUrl: string;
  requestId: string;
  content: OahUserMessageContent;
  sessionTitle?: string;
  agentName?: string;
  activeSessionAgentName?: string;
  modelRef?: string;
  workspaceId?: string;
  workspaceRuntime?: string;
  workspaceName?: string;
  workspaceOwnerId?: string;
  workspaceServiceName?: string;
  workspaceAutoCreate?: boolean;
  runPollIntervalMs?: number;
  runTimeoutMs?: number;
  requestTimeoutMs?: number;
  modelRetryAttempts?: number;
  modelRetryDelayMs?: number;
  modelFallbackEnabled?: boolean;
}

const RUN_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out"]);
const DEFAULT_OAH_RUN_POLL_INTERVAL_MS = 1000;
const DEFAULT_OAH_RUN_TIMEOUT_MS = 1_800_000;
const DEFAULT_OAH_REQUEST_TIMEOUT_MS = 240_000;
const DEFAULT_OAH_MODEL_RETRY_DELAY_MS = 5000;
const DEFAULT_OAH_MODEL_RETRY_ATTEMPTS = 2;

export interface OahSessionRunResult {
  text: string;
  workspaceId: string;
  sessionId: string;
  runId: string;
  runStatus: OahRun["status"];
}

export interface OahWorkspaceResolutionResult {
  workspaceId: string;
  workspace: OahWorkspace;
  catalog: OahWorkspaceCatalog;
  health: OahHealthReport;
  runExecutionReady: boolean;
}

export type OahSessionClientOptions = Omit<OahSessionRunOptions, "content">;

export interface OahSessionClient {
  workspaceId: string;
  sessionId: string;
  agentName?: string;
  send: (content: OahUserMessageContent) => Promise<OahSessionRunResult>;
}

export interface ExistingOahSessionClientOptions extends OahSessionClientOptions {
  workspaceId: string;
  sessionId: string;
}

function requireConfiguredValue(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} not configured`);
  }
  return trimmed;
}

function truncateForError(value: string, maxLength = 800): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...<truncated>`;
}

function describeFetchError(error: unknown): string {
  if (!error) {
    return "unknown fetch error";
  }
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return `${error.message}: ${cause.message}`;
    }
    if (typeof cause === "string" && cause.trim()) {
      return `${error.message}: ${cause.trim()}`;
    }
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

function isEnabledFlag(value: string | undefined): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isModelFallbackEnabled(): boolean {
  const raw = (process.env.OAH_MODEL_FALLBACK_ENABLED || "").trim().toLowerCase();
  if (!raw) {
    return false;
  }
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function normalizeModelRef(value: string | undefined): string {
  return (value || "").trim();
}

function readConfiguredModelPriority(): string[] {
  const raw = (process.env.OAH_MODEL_PRIORITY || "").trim();
  if (!raw) {
    return [];
  }
  return [...new Set(raw.split(",").map((item) => normalizeModelRef(item)).filter(Boolean))];
}

function buildBaseUrlCandidates(baseUrl: string): string[] {
  const normalized = requireConfiguredValue(baseUrl, "OAH_BASE_URL").replace(/\/+$/, "");
  const candidates = [normalized];
  if (!isEnabledFlag(process.env.OAH_ALLOW_5173_FALLBACK)) {
    return candidates;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.port === "8787") {
      const fallback = new URL(normalized);
      fallback.port = "5173";
      candidates.push(fallback.toString().replace(/\/+$/, ""));
    }
  } catch {
    // Keep the configured base URL only.
  }
  return [...new Set(candidates)];
}

function resolvePositiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveNonNegativeInteger(value: string | number | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveTimeoutMs(value: string | number | undefined, fallback: number): number {
  return resolveNonNegativeInteger(value, fallback);
}

function listCandidateModelRefs(
  catalog: OahWorkspaceCatalog,
  preferredModelRef: string | undefined,
): string[] {
  const preferred = normalizeModelRef(preferredModelRef);
  const refs = catalog.models
    .map((entry) => normalizeModelRef(entry.ref))
    .filter(Boolean);
  const configuredPriority = readConfiguredModelPriority();

  const orderedRefs = [
    ...(preferred ? [preferred] : []),
    ...configuredPriority,
    ...refs,
  ];

  return [...new Set(orderedRefs.filter(Boolean))];
}

function isRetriableModelExecutionError(error: unknown): boolean {
  const text = describeFetchError(error);
  return (
    text.includes("Cannot connect to API")
    || text.includes("getaddrinfo ENOTFOUND")
    || text.includes("EAI_AGAIN")
    || text.includes("ECONNRESET")
    || text.includes("socket hang up")
    || text.includes("fetch failed")
    || text.includes("This operation was aborted")
    || text.includes("OAH request timed out")
    || text.includes("upstream")
    || text.includes("status=failed")
    || text.includes("status=timed_out")
    || text.includes("Run exceeded configured timeout")
  );
}

function isRateLimitedModelExecutionError(error: unknown): boolean {
  const text = describeFetchError(error);
  return text.includes("Too Many Requests") || text.includes("429");
}

function formatAttemptedModels(models: string[]): string {
  return models.length > 0 ? models.join(", ") : "(workspace default)";
}

function scoreWorkspace(
  workspace: OahWorkspace,
  selector: Pick<OahSessionRunOptions, "workspaceRuntime" | "workspaceName" | "workspaceOwnerId" | "workspaceServiceName">
): number {
  if (workspace.status !== "active") {
    return -1;
  }

  if (!selector.workspaceRuntime && !selector.workspaceName && !selector.workspaceOwnerId && !selector.workspaceServiceName) {
    return -1;
  }

  const workspaceServiceName = (workspace.serviceName || "").trim().toLowerCase();
  const selectorServiceName = (selector.workspaceServiceName || "").trim().toLowerCase();

  if (selector.workspaceRuntime && workspace.runtime !== selector.workspaceRuntime) {
    return -1;
  }
  if (selectorServiceName && workspaceServiceName !== selectorServiceName) {
    return -1;
  }
  if (selector.workspaceOwnerId && workspace.ownerId !== selector.workspaceOwnerId) {
    return -1;
  }
  if (selector.workspaceName && workspace.name !== selector.workspaceName) {
    return -1;
  }

  let score = 0;
  if (selector.workspaceRuntime && workspace.runtime === selector.workspaceRuntime) {
    score += 100;
  }
  if (selectorServiceName && workspaceServiceName === selectorServiceName) {
    score += 80;
  }
  if (selector.workspaceOwnerId && workspace.ownerId === selector.workspaceOwnerId) {
    score += 70;
  }
  if (selector.workspaceName && workspace.name === selector.workspaceName) {
    score += 60;
  }

  return score;
}

function normalizeWorkspaceRuntime(options: OahSessionClientOptions): string {
  return options.workspaceRuntime?.trim() || "";
}

function normalizeWorkspaceCreationName(options: OahSessionClientOptions): string {
  const configuredName = options.workspaceName?.trim();
  if (configuredName) {
    return configuredName;
  }
  const ownerSuffix = options.workspaceOwnerId?.trim() ? `-${options.workspaceOwnerId.trim()}` : "";
  return `tutor-question-generation${ownerSuffix}`;
}

async function createWorkspace(options: OahSessionClientOptions): Promise<string> {
  const runtime = normalizeWorkspaceRuntime(options);
  if (!runtime) {
    throw new Error("OAH workspace runtime not configured. Set OAH_WORKSPACE_RUNTIME or OAH_WORKSPACE_ID.");
  }

  const workspace = await requestOahJson<OahWorkspace>(
    options.baseUrl,
    "/api/v1/workspaces",
    options.requestId,
    {
      method: "POST",
      body: JSON.stringify({
        name: normalizeWorkspaceCreationName(options),
        runtime,
        ...(options.workspaceOwnerId ? { ownerId: options.workspaceOwnerId } : {}),
        ...(options.workspaceServiceName ? { serviceName: options.workspaceServiceName } : {}),
      }),
    },
    options.requestTimeoutMs,
  );

  return workspace.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildHeaders(requestId: string, includeJsonContentType = true): Record<string, string> {
  const headers: Record<string, string> = {
    "x-request-uuid": requestId,
  };

  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function requestOahJson<T>(
  baseUrl: string,
  apiPath: string,
  requestId: string,
  init: RequestInit = {},
  requestTimeoutMs?: number,
): Promise<T> {
  const errors: string[] = [];
  for (const candidateBaseUrl of buildBaseUrlCandidates(baseUrl)) {
    let response: globalThis.Response;
    const timeoutMs = resolveTimeoutMs(
      requestTimeoutMs ?? process.env.OAH_REQUEST_TIMEOUT_MS,
      DEFAULT_OAH_REQUEST_TIMEOUT_MS,
    );
    const controller = timeoutMs > 0 ? new AbortController() : null;
    const timeout = controller
      ? setTimeout(() => {
        controller.abort(new Error(`OAH request timed out after ${timeoutMs}ms`));
      }, timeoutMs)
      : null;
    try {
      response = await fetch(`${candidateBaseUrl}${apiPath}`, {
        ...init,
        headers: {
          ...buildHeaders(requestId, init.body !== undefined),
          ...(init.headers ?? {}),
        },
        signal: controller?.signal ?? init.signal,
      });
    } catch (error) {
      errors.push(`${candidateBaseUrl}: ${describeFetchError(error)}`);
      continue;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OAH request failed (${response.status} ${apiPath}) via ${candidateBaseUrl}: ${truncateForError(text)}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`OAH request returned invalid JSON (${apiPath}) via ${candidateBaseUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `OAH network request failed (${apiPath}) after trying ${buildBaseUrlCandidates(baseUrl).join(", ")}: ${errors.join(" | ")}`
  );
}

async function resolveWorkspaceId(options: OahSessionClientOptions): Promise<string> {
  if (options.workspaceId?.trim()) {
    return options.workspaceId.trim();
  }

  const query = new URLSearchParams({ pageSize: "200" });
  const page = await requestOahJson<OahWorkspacePage>(
    options.baseUrl,
    `/api/v1/workspaces?${query.toString()}`,
    options.requestId,
    { method: "GET" },
    options.requestTimeoutMs,
  );

  const candidates = page.items
    .map((workspace) => ({
      workspace,
      score: scoreWorkspace(workspace, {
        workspaceRuntime: options.workspaceRuntime,
        workspaceName: options.workspaceName,
        workspaceOwnerId: options.workspaceOwnerId,
        workspaceServiceName: options.workspaceServiceName,
      }),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  const selected = candidates[0]?.workspace;
  if (selected) {
    return selected.id;
  }

  if (options.workspaceAutoCreate === false) {
    throw new Error(
      `No matching OAH workspace found. Set OAH_WORKSPACE_ID or enable OAH_WORKSPACE_AUTO_CREATE with OAH_WORKSPACE_RUNTIME.`
    );
  }

  return createWorkspace(options);
}

async function getWorkspace(
  baseUrl: string,
  workspaceId: string,
  requestId: string,
  requestTimeoutMs?: number,
): Promise<OahWorkspace> {
  return requestOahJson<OahWorkspace>(
    baseUrl,
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}`,
    requestId,
    { method: "GET" },
    requestTimeoutMs,
  );
}

async function getWorkspaceCatalog(
  baseUrl: string,
  workspaceId: string,
  requestId: string,
  requestTimeoutMs?: number,
): Promise<OahWorkspaceCatalog> {
  return requestOahJson<OahWorkspaceCatalog>(
    baseUrl,
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/catalog`,
    requestId,
    { method: "GET" },
    requestTimeoutMs,
  );
}

async function getHealthReport(
  baseUrl: string,
  requestId: string,
  requestTimeoutMs?: number,
): Promise<OahHealthReport> {
  return requestOahJson<OahHealthReport>(
    baseUrl,
    "/healthz",
    requestId,
    { method: "GET" },
    requestTimeoutMs,
  );
}

async function getHealthReportBestEffort(
  baseUrl: string,
  requestId: string,
  requestTimeoutMs?: number,
): Promise<OahHealthReport> {
  try {
    return await getHealthReport(baseUrl, requestId, requestTimeoutMs);
  } catch {
    return { status: "unknown" };
  }
}

function isRunExecutionReady(health: OahHealthReport): boolean {
  if (health.status !== "ok" && health.status !== "ready") {
    return false;
  }
  const worker = health.worker;
  if (!worker) {
    return true;
  }
  if ((worker.mode || "").toLowerCase() === "disabled") {
    return false;
  }
  if (worker.acceptsNewRuns === false) {
    return false;
  }

  const processMode = readHealthText(health.process?.mode).toLowerCase();
  const processExecution = readHealthText(health.process?.execution).toLowerCase();
  const sandboxExecutionModel = readHealthText(health.sandbox?.executionModel).toLowerCase();
  if (
    (worker.mode || "").toLowerCase() === "embedded" ||
    processMode.includes("embedded_worker") ||
    processExecution === "local_inline" ||
    sandboxExecutionModel === "local_embedded"
  ) {
    return true;
  }

  const summary = worker.summary;
  const activeWorkerCount = Array.isArray(worker.activeWorkers) ? worker.activeWorkers.length : null;
  if (!summary && activeWorkerCount === null) {
    return true;
  }

  const healthyCount = Number(summary?.healthy ?? 0);
  const activeCount = Number(summary?.active ?? 0);
  const embeddedCount = Number(summary?.embedded ?? 0);
  return healthyCount > 0 || activeCount > 0 || embeddedCount > 0 || (activeWorkerCount ?? 0) > 0;
}

function readHealthText(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function describeRunExecutionReadiness(health: OahHealthReport): string {
  const worker = health.worker;
  if (!worker) {
    return `health_status=${health.status}, worker=not_reported`;
  }

  const activeWorkerCount = Array.isArray(worker.activeWorkers) ? worker.activeWorkers.length : 0;
  return [
    `health_status=${health.status}`,
    `process_mode=${readHealthText(health.process?.mode, "unknown")}`,
    `execution=${readHealthText(health.process?.execution, "unknown")}`,
    `worker_mode=${worker.mode || "unknown"}`,
    `accepts_new_runs=${worker.acceptsNewRuns !== false}`,
    `active_workers=${activeWorkerCount}`,
    `healthy=${Number(worker.summary?.healthy ?? 0)}`,
    `active=${Number(worker.summary?.active ?? 0)}`,
    `embedded=${Number(worker.summary?.embedded ?? 0)}`,
  ].join(", ");
}

function assertRunExecutionReady(health: OahHealthReport, workspaceId: string): void {
  if (isRunExecutionReady(health)) {
    return;
  }
  throw new Error(
    `OAH no execution worker is available for runs. workspaceId=${workspaceId}; ${describeRunExecutionReadiness(health)}`,
  );
}

async function createSession(workspaceId: string, options: OahSessionClientOptions): Promise<string> {
  const body: OahCreateSessionRequest = {
    ...(options.sessionTitle ? { title: options.sessionTitle } : {}),
    ...((options.activeSessionAgentName || options.agentName)
      ? { agentName: options.activeSessionAgentName || options.agentName }
      : {}),
    ...(options.modelRef ? { modelRef: options.modelRef } : {}),
  };
  const session = await requestOahJson<OahSession>(
    options.baseUrl,
    `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions`,
    options.requestId,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    options.requestTimeoutMs,
  );

  return session.id;
}

async function createSessionForModel(
  workspaceId: string,
  options: OahSessionClientOptions,
  modelRef: string,
): Promise<string> {
  return createSession(workspaceId, {
    ...options,
    modelRef,
  });
}

async function submitMessage(sessionId: string, options: OahSessionRunOptions): Promise<OahMessageAccepted> {
  return requestOahJson<OahMessageAccepted>(
    options.baseUrl,
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    options.requestId,
    {
      method: "POST",
      body: JSON.stringify({
        content: options.content,
        runningRunBehavior: "queue",
      }),
    },
    options.requestTimeoutMs,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRunCompletion(runId: string, options: OahSessionRunOptions): Promise<OahRun> {
  const pollIntervalMs = resolvePositiveInteger(
    options.runPollIntervalMs ?? process.env.OAH_RUN_POLL_INTERVAL_MS,
    DEFAULT_OAH_RUN_POLL_INTERVAL_MS
  );
  const timeoutMs = resolveTimeoutMs(
    options.runTimeoutMs ?? process.env.OAH_RUN_TIMEOUT_MS,
    DEFAULT_OAH_RUN_TIMEOUT_MS
  );
  const startedAt = Date.now();
  let lastStatus = "unknown";
  while (true) {
    const run = await requestOahJson<OahRun>(
      options.baseUrl,
      `/api/v1/runs/${encodeURIComponent(runId)}`,
      options.requestId,
      { method: "GET" },
      options.requestTimeoutMs,
    );
    lastStatus = run.status;

    if (RUN_TERMINAL_STATUSES.has(run.status)) {
      return run;
    }

    const elapsedMs = Date.now() - startedAt;
    if (timeoutMs > 0 && elapsedMs >= timeoutMs) {
      throw new Error(
        `Run exceeded configured timeout (${timeoutMs}ms). runId=${runId}, last_status=${lastStatus}`,
      );
    }

    await sleep(timeoutMs > 0 ? Math.min(pollIntervalMs, Math.max(1, timeoutMs - elapsedMs)) : pollIntervalMs);
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") {
      continue;
    }

    if (part.type === "text" && typeof part.text === "string") {
      const text = part.text.trim();
      if (text) {
        chunks.push(text);
      }
      continue;
    }

    if (part.type !== "tool-result" || !isRecord(part.output)) {
      continue;
    }

    const outputType = typeof part.output.type === "string" ? part.output.type : "";
    if ((outputType === "text" || outputType === "error-text") && typeof part.output.value === "string") {
      const text = part.output.value.trim();
      if (text) {
        chunks.push(text);
      }
    }
  }

  return chunks.join("\n\n").trim();
}

function looksLikeJsonObject(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("{") && trimmed.endsWith("}");
}

async function loadRunMessages(sessionId: string, options: OahSessionRunOptions): Promise<OahMessageRecord[]> {
  const query = new URLSearchParams({
    pageSize: "100",
    direction: "backward",
  });

  const page = await requestOahJson<OahMessagePage>(
    options.baseUrl,
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?${query.toString()}`,
    options.requestId,
    { method: "GET" },
    options.requestTimeoutMs,
  );

  return page.items;
}

function extractFinalRunMessage(messages: OahMessageRecord[], runId: string): string {
  const candidates: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant" || message.runId !== runId) {
      continue;
    }

    const text = extractMessageText(message.content);
    if (text) {
      candidates.push(text);
    }
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (looksLikeJsonObject(candidates[index])) {
      return candidates[index];
    }
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const text = candidates[index];
    if (text) {
      return text;
    }
  }

  throw new Error(`OAH run ${runId} completed without a displayable assistant message`);
}

async function runOahSessionMessage(
  workspaceId: string,
  sessionId: string,
  options: OahSessionRunOptions,
): Promise<OahSessionRunResult> {
  const accepted = await submitMessage(sessionId, options);
  let run: OahRun;
  try {
    run = await waitForRunCompletion(accepted.runId, options);
  } catch (error) {
    throw new Error(
      `OAH run did not finish. workspaceId=${workspaceId}, sessionId=${sessionId}, runId=${accepted.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (run.status !== "completed") {
    throw new Error(
      `OAH run ${run.id} finished with status=${run.status}. workspaceId=${workspaceId}, sessionId=${sessionId}${
        run.errorMessage ? `: ${run.errorMessage}` : ""
      }`
    );
  }

  const messages = await loadRunMessages(sessionId, options);
  return {
    text: extractFinalRunMessage(messages, run.id),
    workspaceId,
    sessionId,
    runId: run.id,
    runStatus: run.status,
  };
}

async function runOahSessionMessageWithRetry(
  workspaceId: string,
  sessionId: string,
  options: OahSessionRunOptions,
): Promise<OahSessionRunResult> {
  const maxRetries = resolveNonNegativeInteger(
    options.modelRetryAttempts ?? process.env.OAH_MODEL_RETRY_ATTEMPTS,
    DEFAULT_OAH_MODEL_RETRY_ATTEMPTS,
  );
  const retryDelayMs = resolvePositiveInteger(
    options.modelRetryDelayMs ?? process.env.OAH_MODEL_RETRY_DELAY_MS,
    DEFAULT_OAH_MODEL_RETRY_DELAY_MS,
  );

  let attempt = 0;
  while (true) {
    try {
      return await runOahSessionMessage(workspaceId, sessionId, options);
    } catch (error) {
      const retriable = isRateLimitedModelExecutionError(error) || isRetriableModelExecutionError(error);
      if (!retriable || attempt >= maxRetries) {
        throw error;
      }
      attempt += 1;
      await sleep(retryDelayMs * attempt);
    }
  }
}

async function runSessionMessageWithModelFallback(
  workspaceId: string,
  sessionId: string,
  options: OahSessionClientOptions,
  content: OahUserMessageContent,
  catalog: OahWorkspaceCatalog,
): Promise<OahSessionRunResult> {
  const attemptedModels: string[] = [];
  const primaryModelRef = normalizeModelRef(options.modelRef);

  try {
    const initialResult = await runOahSessionMessageWithRetry(workspaceId, sessionId, {
      ...options,
      content,
    });
    return {
      ...initialResult,
      sessionId: initialResult.sessionId,
    };
  } catch (error) {
    const fallbackEnabled = options.modelFallbackEnabled ?? isModelFallbackEnabled();
    if (!fallbackEnabled || !isRetriableModelExecutionError(error)) {
      throw error;
    }
    if (primaryModelRef) {
      attemptedModels.push(primaryModelRef);
    }

    const candidateModelRefs = listCandidateModelRefs(catalog, options.modelRef)
      .filter((modelRef) => modelRef !== primaryModelRef);

    let lastError = error;
    for (const fallbackModelRef of candidateModelRefs) {
      attemptedModels.push(fallbackModelRef);
      const fallbackSessionId = await createSessionForModel(workspaceId, options, fallbackModelRef);
      try {
        return await runOahSessionMessageWithRetry(workspaceId, fallbackSessionId, {
          ...options,
          modelRef: fallbackModelRef,
          content,
        });
      } catch (fallbackError) {
        lastError = fallbackError;
        if (!isRetriableModelExecutionError(fallbackError)) {
          throw fallbackError;
        }
      }
    }

    const message = describeFetchError(lastError);
    throw new Error(
      `OAH model execution failed after fallback attempts. attempted_model_refs=${formatAttemptedModels(attemptedModels)}. last_error=${message}`,
    );
  }
}

export async function createOahSessionClient(options: OahSessionClientOptions): Promise<OahSessionClient> {
  const baseUrl = requireConfiguredValue(options.baseUrl, "OAH_BASE_URL").replace(/\/+$/, "");
  const normalizedOptions: OahSessionClientOptions = {
    ...options,
    baseUrl,
  };

  const workspaceId = await resolveWorkspaceId(normalizedOptions);
  const [catalog, health] = await Promise.all([
    getWorkspaceCatalog(baseUrl, workspaceId, normalizedOptions.requestId, normalizedOptions.requestTimeoutMs),
    getHealthReportBestEffort(baseUrl, normalizedOptions.requestId, normalizedOptions.requestTimeoutMs),
  ]);
  assertRunExecutionReady(health, workspaceId);
  const sessionId = await createSession(workspaceId, normalizedOptions);
  let activeSessionId = sessionId;
  return {
    workspaceId,
    sessionId: activeSessionId,
    agentName: normalizedOptions.activeSessionAgentName || normalizedOptions.agentName,
    send: async (content: OahUserMessageContent) => {
      const result = await runSessionMessageWithModelFallback(
        workspaceId,
        activeSessionId,
        normalizedOptions,
        content,
        catalog,
      );
      activeSessionId = result.sessionId;
      return result;
    },
  };
}

export function createOahSessionClientForExistingSession(
  options: ExistingOahSessionClientOptions,
): OahSessionClient {
  const baseUrl = requireConfiguredValue(options.baseUrl, "OAH_BASE_URL").replace(/\/+$/, "");
  const workspaceId = requireConfiguredValue(options.workspaceId, "workspaceId");
  const sessionId = requireConfiguredValue(options.sessionId, "sessionId");
  const normalizedOptions: ExistingOahSessionClientOptions = {
    ...options,
    baseUrl,
    workspaceId,
    sessionId,
  };

  return {
    workspaceId,
    sessionId,
    agentName: normalizedOptions.activeSessionAgentName || normalizedOptions.agentName,
    send: async (content: OahUserMessageContent) => {
      const [catalog, health] = await Promise.all([
        getWorkspaceCatalog(baseUrl, workspaceId, normalizedOptions.requestId, normalizedOptions.requestTimeoutMs),
        getHealthReportBestEffort(baseUrl, normalizedOptions.requestId, normalizedOptions.requestTimeoutMs),
      ]);
      assertRunExecutionReady(health, workspaceId);
      return runSessionMessageWithModelFallback(
        workspaceId,
        sessionId,
        normalizedOptions,
        content,
        catalog,
      );
    },
  };
}

export async function callOahSession(options: OahSessionRunOptions): Promise<OahSessionRunResult> {
  const sessionClient = await createOahSessionClient(options);
  return sessionClient.send(options.content);
}

export async function resolveOahWorkspace(options: OahSessionRunOptions): Promise<OahWorkspaceResolutionResult> {
  const baseUrl = requireConfiguredValue(options.baseUrl, "OAH_BASE_URL").replace(/\/+$/, "");
  const normalizedOptions: OahSessionRunOptions = {
    ...options,
    baseUrl,
  };
  const workspaceId = await resolveWorkspaceId(normalizedOptions);
  const [workspace, catalog, health] = await Promise.all([
    getWorkspace(baseUrl, workspaceId, options.requestId, normalizedOptions.requestTimeoutMs),
    getWorkspaceCatalog(baseUrl, workspaceId, options.requestId, normalizedOptions.requestTimeoutMs),
    getHealthReportBestEffort(baseUrl, options.requestId, normalizedOptions.requestTimeoutMs),
  ]);
  return {
    workspaceId,
    workspace,
    catalog,
    health,
    runExecutionReady: isRunExecutionReady(health),
  };
}

export async function callOahSessionText(options: OahSessionRunOptions): Promise<string> {
  const result = await callOahSession(options);
  return result.text;
}

export function emitTextInChunks(text: string, onDelta: (delta: string) => void, chunkSize = 24): void {
  const chunks = Array.from(text);
  for (let start = 0; start < chunks.length; start += chunkSize) {
    const delta = chunks.slice(start, start + chunkSize).join("");
    if (delta) {
      onDelta(delta);
    }
  }
}
