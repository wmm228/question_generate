import type {
  AuthResponse,
  GeneratedResult,
  MeEnvelope,
  OahStatusEnvelope,
  PortraitDocumentEnvelope,
  PortraitListEnvelope,
  PortraitTurnEnvelope,
  ProgressSnapshot,
  QuestionAgentContractEnvelope,
  SpecNormalizeResponse,
  WorkbenchClientConfig,
} from "./question-agent-workbench-types.js";
import { ApiRequestError, isRecord, normalizeString, normalizeStringArray, translateProgressText } from "./question-agent-workbench-utils.js";

export class WorkbenchApi {
  private sessionToken = "";
  private onUnauthorized: (() => void) | null = null;

  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  setUnauthorizedHandler(handler: (() => void) | null): void {
    this.onUnauthorized = handler;
  }

  async login(uid: string, password: string): Promise<AuthResponse> {
    return this.requestJson<AuthResponse>("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, password }),
    }, false);
  }

  async register(uid: string, password: string): Promise<AuthResponse> {
    return this.requestJson<AuthResponse>("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, password }),
    }, false);
  }

  async logout(): Promise<void> {
    await this.requestJson("/api/logout", { method: "POST" });
  }

  async me(): Promise<MeEnvelope> {
    return this.requestJson<MeEnvelope>("/api/me", { method: "GET" });
  }

  async getClientConfig(): Promise<WorkbenchClientConfig> {
    return this.requestJson<WorkbenchClientConfig>("/api/ai-question/client-config", { method: "GET" });
  }

  async getContract(): Promise<QuestionAgentContractEnvelope> {
    return this.requestJson<QuestionAgentContractEnvelope>("/api/ai-question/contract", { method: "GET" });
  }

  async getOahStatus(): Promise<OahStatusEnvelope> {
    return this.requestJson<OahStatusEnvelope>("/api/ai-question/oah-status", { method: "GET" });
  }

  async listPortraits(): Promise<PortraitListEnvelope> {
    return this.requestJson<PortraitListEnvelope>("/api/ai-question/portraits", { method: "GET" });
  }

  async getPortrait(portraitId: string): Promise<{ portrait?: PortraitDocumentEnvelope }> {
    return this.requestJson<{ portrait?: PortraitDocumentEnvelope }>(
      `/api/ai-question/portrait/${encodeURIComponent(portraitId)}`,
      { method: "GET" },
    );
  }

  async startPortrait(message: string): Promise<PortraitTurnEnvelope> {
    return this.requestJson<PortraitTurnEnvelope>("/api/ai-question/portrait/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  }

  async replyPortrait(portraitId: string, message: string): Promise<PortraitTurnEnvelope> {
    return this.requestJson<PortraitTurnEnvelope>(
      `/api/ai-question/portrait/${encodeURIComponent(portraitId)}/reply`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      },
    );
  }

  async normalizeSpec(payload: Record<string, unknown>, requestId: string): Promise<SpecNormalizeResponse> {
    return this.requestJson<SpecNormalizeResponse>("/api/ai-question/spec/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, request_uuid: requestId }),
    }, true, requestId);
  }

  async generate(payload: Record<string, unknown>, requestId: string): Promise<GeneratedResult> {
    return this.requestJson<GeneratedResult>("/api/ai-question/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, true, requestId);
  }

  async getProgress(requestId: string): Promise<ProgressSnapshot> {
    return this.requestJson<ProgressSnapshot>(
      `/api/ai-question/status/${encodeURIComponent(requestId)}`,
      { method: "GET" },
    );
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    includeSession = true,
    requestId = "",
  ): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    if (includeSession) {
      if (!this.sessionToken) {
        throw new Error("当前没有可用的会话令牌，请重新登录。");
      }
      headers.set("x-session-token", this.sessionToken);
    }
    if (requestId) {
      headers.set("x-request-uuid", requestId);
    }

    const response = await fetch(url, { ...init, headers });
    const text = await response.text();
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.trim() };
      }
    }

    if (response.status === 401 && includeSession) {
      this.onUnauthorized?.();
    }

    if (!response.ok) {
      throw new ApiRequestError(this.readErrorMessage(payload, response.status), response.status, payload);
    }

    return payload as T;
  }

  private readErrorMessage(payload: unknown, status: number): string {
    if (isRecord(payload)) {
      const validationErrors = normalizeStringArray(payload.validation_errors);
      if (validationErrors.length > 0) {
        return validationErrors.map((item) => translateProgressText(item)).join("；");
      }
      const errorMessage = normalizeString(payload.error);
      const details = normalizeString(payload.details);
      const hint = normalizeString(payload.hint);
      if (errorMessage && details && hint) {
        return `${translateProgressText(`${errorMessage}: ${details}`)}\n建议：${translateProgressText(hint)}`;
      }
      if (errorMessage && details) {
        return translateProgressText(`${errorMessage}: ${details}`);
      }
      if (errorMessage) {
        return translateProgressText(errorMessage);
      }
    }
    return `请求失败，状态码 ${status}`;
  }
}
