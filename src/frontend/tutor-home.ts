interface PingEnvelope {
  ok?: boolean;
  startupId?: string;
  pid?: number;
  now?: string;
}

interface AuthResponse {
  ok?: boolean;
  token?: string;
  uid?: string;
  error?: string;
}

interface MeEnvelope {
  uid?: string;
}

interface ClientConfigEnvelope {
  algorithms?: string[];
}

interface OahStatusEnvelope {
  ok?: boolean;
  status?: string;
  run_execution_ready?: boolean;
  workspace?: Record<string, unknown>;
  details?: string;
  error?: string;
}

type AuthMode = "login" | "register";
type FeedbackTone = "neutral" | "ok" | "warn" | "error";

class ApiRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing element #${id}`);
  }
  return element as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

class TutorHomeApp {
  private readonly loginMask = requireElement<HTMLDivElement>("login-mask");
  private readonly tabLogin = requireElement<HTMLButtonElement>("tab-login");
  private readonly tabRegister = requireElement<HTMLButtonElement>("tab-register");
  private readonly loginSubtitle = requireElement<HTMLDivElement>("login-subtitle");
  private readonly authUidInput = requireElement<HTMLInputElement>("auth-uid");
  private readonly authPwdInput = requireElement<HTMLInputElement>("auth-pwd");
  private readonly authError = requireElement<HTMLDivElement>("auth-error");
  private readonly authSubmitButton = requireElement<HTMLButtonElement>("auth-submit");
  private readonly authButtonText = requireElement<HTMLSpanElement>("auth-btn-text");
  private readonly logoutButton = requireElement<HTMLButtonElement>("logout-button");
  private readonly userName = requireElement<HTMLSpanElement>("user-name");

  private readonly homeFeedback = requireElement<HTMLDivElement>("home-feedback");
  private readonly pingSummary = requireElement<HTMLDivElement>("ping-summary");
  private readonly authSummary = requireElement<HTMLDivElement>("auth-summary");
  private readonly oahSummary = requireElement<HTMLDivElement>("oah-summary");
  private readonly algorithmSummary = requireElement<HTMLDivElement>("algorithm-summary");
  private readonly refreshStatusButton = requireElement<HTMLButtonElement>("refresh-status-button");
  private readonly openContractButton = requireElement<HTMLButtonElement>("open-contract-button");
  private readonly openOahStatusButton = requireElement<HTMLButtonElement>("open-oah-status-button");

  private readonly launchKnowledgePoint = requireElement<HTMLInputElement>("launch-knowledge-point");
  private readonly launchButton = requireElement<HTMLButtonElement>("launch-button");
  private readonly cardWorkbench = requireElement<HTMLButtonElement>("card-workbench");
  private readonly cardTextQuestion = requireElement<HTMLButtonElement>("card-text-question");
  private readonly cardImageQuestion = requireElement<HTMLButtonElement>("card-image-question");
  private readonly cardRuntime = requireElement<HTMLButtonElement>("card-runtime");

  private authMode: AuthMode = "login";
  private sessionToken = localStorage.getItem("session_token") || "";
  private currentUser = "";
  private busy = false;
  private algorithms: string[] = [];
  private oahStatus: OahStatusEnvelope | null = null;

  async init(): Promise<void> {
    this.bindEvents();
    await this.refreshPing();
    await this.restoreSession();
    this.renderAuthState();
    this.renderStatusState();
  }

  private bindEvents(): void {
    this.tabLogin.addEventListener("click", () => {
      this.setAuthMode("login");
    });
    this.tabRegister.addEventListener("click", () => {
      this.setAuthMode("register");
    });
    this.authSubmitButton.addEventListener("click", () => {
      void this.handleAuth();
    });
    this.authUidInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.authPwdInput.focus();
      }
    });
    this.authPwdInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.handleAuth();
      }
    });
    this.logoutButton.addEventListener("click", () => {
      void this.logout();
    });

    this.launchButton.addEventListener("click", () => {
      this.launchWorkbench();
    });
    this.launchKnowledgePoint.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.launchWorkbench();
      }
    });

    this.cardWorkbench.addEventListener("click", () => {
      window.location.href = "/question-agent-workbench";
    });
    this.cardTextQuestion.addEventListener("click", () => {
      this.openPreset({
        algorithm: "direct",
        questionType: "multiple_choice",
        contentMode: "text",
      });
    });
    this.cardImageQuestion.addEventListener("click", () => {
      this.openPreset({
        algorithm: "evoq",
        questionType: "multiple_choice",
        contentMode: "image",
        imageMode: "required",
        imagePlacement: "stem_image",
      });
    });
    this.cardRuntime.addEventListener("click", () => {
      void this.refreshStatus();
    });

    this.refreshStatusButton.addEventListener("click", () => {
      void this.refreshStatus();
    });
    this.openContractButton.addEventListener("click", () => {
      void this.openProtectedJson("/api/ai-question/contract");
    });
    this.openOahStatusButton.addEventListener("click", () => {
      void this.openProtectedJson("/api/ai-question/oah-status");
    });
  }

  private async refreshPing(): Promise<void> {
    try {
      const ping = await this.requestJson<PingEnvelope>("/api/ping", { method: "GET" }, false);
      this.pingSummary.textContent = [
        "service=ready",
        `pid=${ping.pid ?? "-"}`,
        `startup=${normalizeString(ping.startupId) || "-"}`,
        `now=${normalizeString(ping.now) || "-"}`,
      ].join("\n");
    } catch (error) {
      this.pingSummary.textContent = error instanceof Error ? error.message : "服务状态检查失败";
    }
  }

  private async restoreSession(): Promise<void> {
    if (!this.sessionToken) {
      this.showLogin();
      return;
    }

    try {
      const me = await this.requestJson<MeEnvelope>("/api/me", { method: "GET" });
      this.currentUser = normalizeString(me.uid);
      if (!this.currentUser) {
        throw new Error("session user missing");
      }
      this.hideLogin();
      await this.refreshAuthenticatedState();
      this.setFeedback(this.homeFeedback, "登录态已恢复。", "ok");
    } catch (error) {
      this.clearSession();
      this.showLogin();
      this.setFeedback(
        this.homeFeedback,
        error instanceof Error ? error.message : "登录态恢复失败。",
        "warn",
      );
    }
  }

  private async refreshAuthenticatedState(): Promise<void> {
    const [oahStatus, clientConfig] = await Promise.all([
      this.requestJson<OahStatusEnvelope>("/api/ai-question/oah-status", { method: "GET" }),
      this.requestJson<ClientConfigEnvelope>("/api/ai-question/client-config", { method: "GET" }),
    ]);
    this.oahStatus = oahStatus;
    this.algorithms = Array.isArray(clientConfig.algorithms)
      ? clientConfig.algorithms.map((item) => normalizeString(item)).filter(Boolean)
      : [];
    this.renderStatusState();
  }

  private async handleAuth(): Promise<void> {
    const uid = this.authUidInput.value.trim();
    const password = this.authPwdInput.value;
    if (!uid || !password) {
      this.authError.textContent = "请输入用户名和密码";
      return;
    }

    this.busy = true;
    this.renderAuthState();
    this.authError.textContent = "";

    try {
      const response = await this.requestJson<AuthResponse>(
        `/api/${this.authMode}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid, password }),
        },
        false,
      );
      const token = normalizeString(response.token);
      const resolvedUid = normalizeString(response.uid);
      if (!token || !resolvedUid) {
        throw new Error("登录返回缺少 token 或 uid");
      }
      this.sessionToken = token;
      this.currentUser = resolvedUid;
      localStorage.setItem("session_token", token);
      this.authUidInput.value = "";
      this.authPwdInput.value = "";
      this.hideLogin();
      await this.refreshAuthenticatedState();
      this.setFeedback(
        this.homeFeedback,
        this.authMode === "login" ? "登录成功。" : "注册成功。",
        "ok",
      );
    } catch (error) {
      this.authError.textContent = error instanceof Error ? error.message : "认证失败";
    } finally {
      this.busy = false;
      this.renderAuthState();
    }
  }

  private async logout(): Promise<void> {
    try {
      if (this.sessionToken) {
        await this.requestJson("/api/logout", { method: "POST" });
      }
    } catch {
      // Ignore logout transport failures and clear local session anyway.
    }
    this.clearSession();
    this.oahStatus = null;
    this.algorithms = [];
    this.renderStatusState();
    this.showLogin();
    this.setFeedback(this.homeFeedback, "已退出登录。", "warn");
  }

  private async refreshStatus(): Promise<void> {
    await this.refreshPing();
    if (!this.isAuthenticated()) {
      this.renderStatusState();
      this.setFeedback(this.homeFeedback, "请先登录后再查看 OAH 运行状态。", "warn");
      return;
    }
    try {
      await this.refreshAuthenticatedState();
      this.setFeedback(this.homeFeedback, "状态已刷新。", "ok");
    } catch (error) {
      this.setFeedback(
        this.homeFeedback,
        error instanceof Error ? error.message : "状态刷新失败。",
        "error",
      );
    }
  }

  private async openProtectedJson(path: string): Promise<void> {
    if (!this.isAuthenticated()) {
      this.setFeedback(this.homeFeedback, "请先登录。", "warn");
      return;
    }
    try {
      const payload = await this.requestJson<unknown>(path, { method: "GET" });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      this.setFeedback(
        this.homeFeedback,
        error instanceof Error ? error.message : "打开接口失败。",
        "error",
      );
    }
  }

  private renderAuthState(): void {
    this.userName.textContent = this.currentUser || "未登录";
    this.logoutButton.disabled = this.busy || !this.isAuthenticated();
    this.authSubmitButton.disabled = this.busy;
    this.authUidInput.disabled = this.busy;
    this.authPwdInput.disabled = this.busy;
    this.tabLogin.disabled = this.busy;
    this.tabRegister.disabled = this.busy;
    this.loginSubtitle.textContent = this.authMode === "login" ? "登录" : "注册";
    this.authButtonText.textContent = this.authMode === "login" ? "登 录" : "注 册";
    this.tabLogin.classList.toggle("active", this.authMode === "login");
    this.tabRegister.classList.toggle("active", this.authMode === "register");
  }

  private renderStatusState(): void {
    this.authSummary.textContent = this.currentUser || "guest";
    this.algorithmSummary.textContent = this.algorithms.length > 0 ? this.algorithms.join(" / ") : "等待加载";

    if (!this.oahStatus || !this.isAuthenticated()) {
      this.oahSummary.textContent = this.isAuthenticated() ? "等待刷新" : "登录后可查看";
      return;
    }

    const workspace = isRecord(this.oahStatus.workspace) ? this.oahStatus.workspace : {};
    const workspaceName = normalizeString(workspace.name) || "unknown";
    const workspaceRuntime = normalizeString(workspace.runtime) || "unknown";
    const statusText = normalizeString(this.oahStatus.status) || "unknown";
    const ready = this.oahStatus.run_execution_ready === true ? "true" : "false";
    const details = normalizeString(this.oahStatus.details) || normalizeString(this.oahStatus.error);

    this.oahSummary.textContent = [
      `status=${statusText}`,
      `workspace=${workspaceName}`,
      `runtime=${workspaceRuntime}`,
      `run_execution_ready=${ready}`,
      details ? `details=${details}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private launchWorkbench(): void {
    const knowledgePoint = this.launchKnowledgePoint.value.trim();
    const query = new URLSearchParams();
    if (knowledgePoint) {
      query.set("knowledge_point", knowledgePoint);
    }
    window.location.href = query.toString()
      ? `/question-agent-workbench?${query.toString()}`
      : "/question-agent-workbench";
  }

  private openPreset(input: {
    algorithm: string;
    questionType: string;
    contentMode: string;
    imageMode?: string;
    imagePlacement?: string;
  }): void {
    const query = new URLSearchParams();
    const knowledgePoint = this.launchKnowledgePoint.value.trim();
    if (knowledgePoint) {
      query.set("knowledge_point", knowledgePoint);
    }
    query.set("algorithm", input.algorithm);
    query.set("question_type", input.questionType);
    query.set("content_mode", input.contentMode);
    if (input.imageMode) {
      query.set("image_mode", input.imageMode);
    }
    if (input.imagePlacement) {
      query.set("image_placement", input.imagePlacement);
    }
    window.location.href = `/question-agent-workbench?${query.toString()}`;
  }

  private setAuthMode(mode: AuthMode): void {
    this.authMode = mode;
    this.authError.textContent = "";
    this.renderAuthState();
  }

  private showLogin(): void {
    this.loginMask.style.display = "block";
  }

  private hideLogin(): void {
    this.loginMask.style.display = "none";
  }

  private isAuthenticated(): boolean {
    return Boolean(this.sessionToken && this.currentUser);
  }

  private clearSession(): void {
    this.sessionToken = "";
    this.currentUser = "";
    localStorage.removeItem("session_token");
  }

  private setFeedback(element: HTMLElement, message: string, tone: FeedbackTone): void {
    element.textContent = message;
    if (tone === "neutral") {
      element.removeAttribute("data-tone");
      return;
    }
    element.dataset.tone = tone;
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    includeSession = true,
  ): Promise<T> {
    const headers = new Headers(init.headers ?? {});
    if (includeSession) {
      if (!this.sessionToken) {
        throw new Error("当前没有可用的 session token。");
      }
      headers.set("x-session-token", this.sessionToken);
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

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
      this.clearSession();
      this.showLogin();
      this.renderAuthState();
    }

    if (!response.ok) {
      throw new ApiRequestError(this.readErrorMessage(payload, response.status), response.status, payload);
    }

    return payload as T;
  }

  private readErrorMessage(payload: unknown, status: number): string {
    if (isRecord(payload)) {
      const errorMessage = normalizeString(payload.error);
      const details = normalizeString(payload.details);
      if (errorMessage && details) {
        return `${errorMessage}: ${details}`;
      }
      if (errorMessage) {
        return errorMessage;
      }
    }
    return `request failed with status ${status}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const app = new TutorHomeApp();
  void app.init();
});

export {};
