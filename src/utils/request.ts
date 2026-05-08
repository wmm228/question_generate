import { Request } from "express";
import { randomUUID } from "crypto";

export type RequestWithId = Request & { requestId?: string };
export type LogLevel = "info" | "warn" | "error";

export const REQUEST_ID_HEADER = "x-request-uuid";

export function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function isValidRequestId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

export function createRequestId(): string {
  return randomUUID();
}

export function buildSyntheticRequestId(prefix: string, suffix: string): string {
  return `${prefix}-${suffix}-${Date.now()}`;
}

export function getRequestId(req: Request): string {
  const requestWithId = req as RequestWithId;
  const existing = requestWithId.requestId;
  if (existing) {
    return existing;
  }

  const headerValue = normalizeHeaderValue(req.headers[REQUEST_ID_HEADER]);
  const requestId = isValidRequestId(headerValue) ? headerValue : createRequestId();
  requestWithId.requestId = requestId;
  return requestId;
}

export function serializeError(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? "",
    };
  }
  return { message: String(error) };
}

export function logEvent(
  level: LogLevel,
  req: Request | null,
  event: string,
  details: Record<string, unknown> = {}
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    request_uuid: req ? getRequestId(req) : null,
    request_path: req?.originalUrl ?? req?.url ?? null,
    request_method: req?.method ?? null,
    ...details,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}
