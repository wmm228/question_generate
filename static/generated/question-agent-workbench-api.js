import { ApiRequestError, isRecord, normalizeString, normalizeStringArray, translateProgressText } from "./question-agent-workbench-utils.js";
export class WorkbenchApi {
    sessionToken = "";
    onUnauthorized = null;
    setSessionToken(token) {
        this.sessionToken = token;
    }
    setUnauthorizedHandler(handler) {
        this.onUnauthorized = handler;
    }
    async login(uid, password) {
        return this.requestJson("/api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid, password }),
        }, false);
    }
    async register(uid, password) {
        return this.requestJson("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uid, password }),
        }, false);
    }
    async logout() {
        await this.requestJson("/api/logout", { method: "POST" });
    }
    async me() {
        return this.requestJson("/api/me", { method: "GET" });
    }
    async getClientConfig() {
        return this.requestJson("/api/ai-question/client-config", { method: "GET" });
    }
    async getContract() {
        return this.requestJson("/api/ai-question/contract", { method: "GET" });
    }
    async getOahStatus() {
        return this.requestJson("/api/ai-question/oah-status", { method: "GET" });
    }
    async listPortraits() {
        return this.requestJson("/api/ai-question/portraits", { method: "GET" });
    }
    async getPortrait(portraitId) {
        return this.requestJson(`/api/ai-question/portrait/${encodeURIComponent(portraitId)}`, { method: "GET" });
    }
    async startPortrait(message) {
        return this.requestJson("/api/ai-question/portrait/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        });
    }
    async replyPortrait(portraitId, message) {
        return this.requestJson(`/api/ai-question/portrait/${encodeURIComponent(portraitId)}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        });
    }
    async normalizeSpec(payload, requestId) {
        return this.requestJson("/api/ai-question/spec/normalize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, request_uuid: requestId }),
        }, true, requestId);
    }
    async generate(payload, requestId) {
        return this.requestJson("/api/ai-question/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }, true, requestId);
    }
    async getProgress(requestId) {
        return this.requestJson(`/api/ai-question/status/${encodeURIComponent(requestId)}`, { method: "GET" });
    }
    async requestJson(url, init, includeSession = true, requestId = "") {
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
        let payload = {};
        if (text.trim()) {
            try {
                payload = JSON.parse(text);
            }
            catch {
                payload = { error: text.trim() };
            }
        }
        if (response.status === 401 && includeSession) {
            this.onUnauthorized?.();
        }
        if (!response.ok) {
            throw new ApiRequestError(this.readErrorMessage(payload, response.status), response.status, payload);
        }
        return payload;
    }
    readErrorMessage(payload, status) {
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
