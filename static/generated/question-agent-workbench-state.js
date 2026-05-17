import { DEFAULT_CLIENT_CONFIG, DEFAULT_PERSISTED_STATE } from "./question-agent-workbench-types.js";
import { IMAGE_TARGET_BY_PLACEMENT } from "./question-agent-workbench-types.js";
import { WorkbenchApi } from "./question-agent-workbench-api.js";
import { loadSessionToken, loadWorkbenchState, clearGuestAuth, clearSessionToken, saveSessionToken, saveWorkbenchState, } from "./question-agent-workbench-storage.js";
import { createRequestId, getPortraitReadyState, normalizePortraitList, normalizeString, readSpecResponseFromError } from "./question-agent-workbench-utils.js";
export class WorkbenchSessionStore {
    api = new WorkbenchApi();
    listeners = new Set();
    progressTimerId = null;
    state = {
        authUid: "",
        sessionToken: loadSessionToken(),
        currentUser: "",
        busy: false,
        clientConfig: DEFAULT_CLIENT_CONFIG,
        contractEnvelope: null,
        oahStatus: null,
        portraitList: [],
        portraitDocument: null,
        specNormalizeResponse: null,
        generatedResult: null,
        questionLibraryResults: [],
        questionLibraryLoading: false,
        questionLibraryError: "",
        questionLibrarySearched: false,
        progressSnapshot: null,
        currentRequestId: "",
        persisted: loadWorkbenchState(),
    };
    constructor() {
        clearGuestAuth();
        this.api.setSessionToken(this.state.sessionToken);
        this.api.setUnauthorizedHandler(() => {
            this.clearSession();
            this.emit();
        });
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit() {
        for (const listener of this.listeners) {
            listener();
        }
    }
    persist() {
        saveWorkbenchState(this.state.persisted);
    }
    commitLayout() {
        this.persist();
        this.emit();
    }
    resetGenerationState() {
        this.stopProgressPolling();
        this.state.generatedResult = null;
        this.state.progressSnapshot = null;
        this.state.currentRequestId = "";
    }
    setAuthUid(value) {
        this.state.authUid = value;
        this.emit();
    }
    setBusy(value) {
        this.state.busy = value;
        this.emit();
    }
    setSessionToken(token) {
        this.state.sessionToken = token;
        this.api.setSessionToken(token);
        if (token) {
            saveSessionToken(token);
        }
        else {
            clearSessionToken();
        }
    }
    clearSession() {
        this.resetGenerationState();
        this.setSessionToken("");
        this.state.currentUser = "";
        this.state.oahStatus = null;
        this.state.contractEnvelope = null;
        this.state.portraitList = [];
        this.state.portraitDocument = null;
        this.state.specNormalizeResponse = null;
        this.state.persisted.activePortraitId = "";
        clearGuestAuth();
        this.persist();
    }
    async restoreSession() {
        try {
            const me = await this.api.me();
            const uid = normalizeString(me.uid);
            if (!uid || uid.startsWith("guest_")) {
                try {
                    await this.api.logout();
                }
                catch {
                    // Ignore logout errors while discarding legacy anonymous sessions.
                }
                this.clearSession();
                this.emit();
                return false;
            }
            this.setSessionToken(this.state.sessionToken || "bypass-session");
            this.state.currentUser = uid;
            await this.refreshWorkbenchData();
            await this.restorePortrait();
            this.emit();
            return true;
        }
        catch {
            this.clearSession();
        }
        this.emit();
        return false;
    }
    async authenticate(mode, uid, password, email = "") {
        const response = mode === "login"
            ? await this.api.login(uid, password)
            : await this.api.register(uid, password, email);
        const token = normalizeString(response.token);
        const resolvedUid = normalizeString(response.uid);
        if (!token || !resolvedUid) {
            throw new Error("认证返回缺少 token 或 uid。");
        }
        this.setSessionToken(token);
        this.state.currentUser = resolvedUid;
        await this.refreshWorkbenchData();
        await this.restorePortrait();
        this.emit();
    }
    async logout() {
        try {
            if (this.state.sessionToken) {
                await this.api.logout();
            }
        }
        finally {
            this.clearSession();
            this.emit();
        }
    }
    async refreshWorkbenchData() {
        const [clientConfig, contract, oahStatus, portraitList] = await Promise.allSettled([
            this.api.getClientConfig(),
            this.api.getContract(),
            this.api.getOahStatus(),
            this.api.listPortraits(),
        ]);
        if (clientConfig.status === "fulfilled") {
            this.state.clientConfig = clientConfig.value;
        }
        if (contract.status === "fulfilled") {
            this.state.contractEnvelope = contract.value;
        }
        this.state.oahStatus = oahStatus.status === "fulfilled"
            ? oahStatus.value
            : {
                ok: false,
                status: "unavailable",
                error: oahStatus.reason instanceof Error ? oahStatus.reason.message : "OAH 状态暂不可用",
            };
        if (portraitList.status === "fulfilled") {
            this.state.portraitList = normalizePortraitList(portraitList.value.portraits);
        }
        this.emit();
    }
    async restorePortrait() {
        const portraitId = normalizeString(this.state.persisted.activePortraitId);
        if (!portraitId) {
            this.state.portraitDocument = null;
            this.state.specNormalizeResponse = null;
            this.emit();
            return;
        }
        try {
            await this.loadPortrait(portraitId, false);
        }
        catch {
            this.state.portraitDocument = null;
            this.state.specNormalizeResponse = null;
            this.state.persisted.activePortraitId = "";
            this.persist();
            this.emit();
        }
    }
    startNewPortraitDraft() {
        this.resetGenerationState();
        this.state.portraitDocument = null;
        this.state.specNormalizeResponse = null;
        this.state.persisted.activePortraitId = "";
        this.state.persisted.latestPortraitReplyDraft = "";
        this.persist();
        this.emit();
    }
    startNewRequestDraft() {
        this.resetGenerationState();
        this.state.portraitDocument = null;
        this.state.specNormalizeResponse = null;
        this.state.persisted.activePortraitId = "";
        this.state.persisted.latestKnowledgePointDraft = "";
        this.state.persisted.latestPortraitReplyDraft = "";
        this.state.persisted.requestDraft = structuredClone(DEFAULT_PERSISTED_STATE.requestDraft);
        this.persist();
        this.emit();
    }
    async loadPortrait(portraitId, announce = true) {
        const response = await this.api.getPortrait(portraitId);
        this.resetGenerationState();
        this.state.portraitDocument = response.portrait || null;
        this.state.specNormalizeResponse = this.state.portraitDocument?.spec && this.state.portraitDocument?.plan
            ? {
                spec: this.state.portraitDocument.spec,
                plan: this.state.portraitDocument.plan,
            }
            : null;
        this.state.persisted.activePortraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        this.applyPortraitDraftToRequestDraft();
        this.persist();
        if (announce) {
            this.emit();
            return;
        }
        this.emit();
    }
    async archivePortrait(portraitId) {
        const normalizedPortraitId = normalizeString(portraitId);
        if (!normalizedPortraitId) {
            return;
        }
        await this.api.archivePortrait(normalizedPortraitId);
        const activePortraitId = normalizeString(this.state.portraitDocument?.portrait_id || this.state.persisted.activePortraitId);
        if (activePortraitId === normalizedPortraitId) {
            this.resetGenerationState();
            this.state.portraitDocument = null;
            this.state.specNormalizeResponse = null;
            this.state.persisted.activePortraitId = "";
            this.state.persisted.latestPortraitReplyDraft = "";
        }
        await this.refreshPortraitList();
        this.persist();
        this.emit();
    }
    async refreshPortraitDocument(portraitId) {
        const response = await this.api.getPortrait(portraitId);
        if (!response.portrait) {
            return;
        }
        this.state.portraitDocument = response.portrait;
        this.state.persisted.activePortraitId = normalizeString(response.portrait.portrait_id);
        this.syncPortraitSpecState();
        this.applyPortraitDraftToRequestDraft();
        await this.refreshPortraitList();
        this.persist();
        this.emit();
    }
    async refreshActivePortrait() {
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id || this.state.persisted.activePortraitId);
        if (!portraitId) {
            return;
        }
        await this.refreshPortraitDocument(portraitId);
    }
    setKnowledgePointDraft(value, notify = true) {
        this.state.persisted.latestKnowledgePointDraft = value;
        this.state.persisted.requestDraft.knowledge_point = value;
        this.persist();
        if (notify) {
            this.emit();
        }
    }
    setSubjectDraft(value, notify = true) {
        this.state.persisted.requestDraft.subject = value;
        this.persist();
        if (notify) {
            this.emit();
        }
    }
    setPortraitReplyDraft(value, notify = true) {
        this.state.persisted.latestPortraitReplyDraft = value;
        this.persist();
        if (notify) {
            this.emit();
        }
    }
    updateRequestDraft(patch, notify = true) {
        this.state.persisted.requestDraft = {
            ...this.state.persisted.requestDraft,
            ...patch,
        };
        if (patch.image_placement !== undefined) {
            this.state.persisted.requestDraft.image_targets = patch.image_placement
                ? IMAGE_TARGET_BY_PLACEMENT[patch.image_placement] || []
                : [];
        }
        if (patch.content_mode === "text") {
            this.state.persisted.requestDraft.image_mode = "none";
            this.state.persisted.requestDraft.image_placement = "";
            this.state.persisted.requestDraft.image_targets = [];
        }
        this.persist();
        if (notify) {
            this.emit();
        }
    }
    syncPortraitToDraft() {
        if (!this.applyPortraitDraftToRequestDraft()) {
            return;
        }
        this.persist();
        this.emit();
    }
    applyPortraitDraftToRequestDraft() {
        const draft = this.state.portraitDocument?.draft;
        if (!draft) {
            return false;
        }
        this.state.persisted.latestKnowledgePointDraft = normalizeString(draft.knowledge_point);
        this.state.persisted.requestDraft = {
            subject: normalizeString(draft.subject),
            knowledge_point: normalizeString(draft.knowledge_point),
            difficulty: normalizeString(draft.difficulty) || "2",
            algorithm: normalizeString(draft.algorithm) || "direct",
            question_type: normalizeString(draft.question_type) || "multiple_choice",
            content_mode: normalizeString(draft.content_mode) || "text",
            image_mode: normalizeString(draft.image_mode) || "none",
            image_placement: normalizeString(draft.image_placement),
            image_targets: Array.isArray(draft.image_targets) ? draft.image_targets.map((item) => normalizeString(item)).filter(Boolean) : [],
        };
        return true;
    }
    async startPortraitDialogue(message, attachments = []) {
        const response = await this.api.startPortrait(message, attachments);
        this.resetGenerationState();
        this.state.portraitDocument = response.portrait || null;
        this.state.persisted.activePortraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        this.state.persisted.latestPortraitReplyDraft = "";
        await this.refreshPortraitList();
        this.syncPortraitSpecState();
        this.applyPortraitDraftToRequestDraft();
        this.persist();
        this.emit();
        return response;
    }
    async sendPortraitReply(message, attachments = []) {
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        if (!portraitId) {
            throw new Error("请先开始规范对话。");
        }
        const response = await this.api.replyPortrait(portraitId, message, attachments);
        this.resetGenerationState();
        this.state.portraitDocument = response.portrait || null;
        this.state.persisted.latestPortraitReplyDraft = "";
        await this.refreshPortraitList();
        this.syncPortraitSpecState();
        this.applyPortraitDraftToRequestDraft();
        this.persist();
        this.emit();
        return response;
    }
    syncPortraitSpecState() {
        this.state.specNormalizeResponse = this.state.portraitDocument?.spec && this.state.portraitDocument?.plan
            ? { spec: this.state.portraitDocument.spec, plan: this.state.portraitDocument.plan }
            : null;
    }
    async refreshPortraitList() {
        const portraitList = await this.api.listPortraits();
        this.state.portraitList = normalizePortraitList(portraitList.portraits);
    }
    async appendPortraitHistoryMessage(message) {
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        if (!portraitId) {
            return;
        }
        const response = await this.api.appendPortraitHistory(portraitId, {
            role: normalizeString(message.role) || "assistant",
            kind: normalizeString(message.kind) || "text",
            content: normalizeString(message.content),
            request_id: normalizeString(message.request_id),
            payload: message.payload,
        });
        if (response.portrait) {
            this.state.portraitDocument = response.portrait;
            this.syncPortraitSpecState();
            await this.refreshPortraitList();
            this.persist();
            this.emit();
        }
    }
    hasGeneratedQuestionMessage(requestId) {
        const normalizedRequestId = normalizeString(requestId);
        if (!normalizedRequestId) {
            return false;
        }
        return (this.state.portraitDocument?.messages || []).some((message) => (normalizeString(message.kind) === "generated_question"
            && normalizeString(message.request_id) === normalizedRequestId));
    }
    buildPayload() {
        const requestDraft = this.state.persisted.requestDraft;
        return {
            subject: normalizeString(requestDraft.subject),
            knowledge_point: normalizeString(requestDraft.knowledge_point),
            difficulty: normalizeString(requestDraft.difficulty) || "2",
            algorithm: normalizeString(requestDraft.algorithm) || "direct",
            question_type: normalizeString(requestDraft.question_type) || "multiple_choice",
            content_mode: normalizeString(requestDraft.content_mode) || "text",
            image_mode: normalizeString(requestDraft.image_mode) || "none",
            image_placement: normalizeString(requestDraft.image_placement),
            image_targets: Array.isArray(requestDraft.image_targets) ? requestDraft.image_targets.map((item) => normalizeString(item)).filter(Boolean) : [],
        };
    }
    async validateSpec() {
        const requestId = createRequestId();
        this.state.currentRequestId = requestId;
        const payload = this.buildPayload();
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        try {
            let normalizeResponse;
            if (portraitId) {
                const response = await this.api.commitPortraitSpec(portraitId, payload, requestId);
                normalizeResponse = {
                    spec: response.spec || {},
                    plan: response.plan || {},
                };
                this.state.specNormalizeResponse = normalizeResponse;
                if (response.portrait) {
                    this.state.portraitDocument = response.portrait;
                    this.state.persisted.activePortraitId = normalizeString(response.portrait.portrait_id);
                    await this.refreshPortraitList();
                }
            }
            else {
                normalizeResponse = await this.api.normalizeSpec(payload, requestId);
                this.state.specNormalizeResponse = normalizeResponse;
            }
            return normalizeResponse;
        }
        catch (error) {
            this.state.specNormalizeResponse = readSpecResponseFromError(error);
            throw error;
        }
        finally {
            this.emit();
        }
    }
    async generateQuestion() {
        const requestId = createRequestId();
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        this.state.currentRequestId = requestId;
        this.state.generatedResult = null;
        this.state.progressSnapshot = null;
        this.emit();
        this.startProgressPolling(requestId);
        try {
            const requestPayload = {
                ...this.buildPayload(),
                ...(portraitId ? { portrait_id: portraitId } : {}),
            };
            const result = await this.api.generate(requestPayload, requestId);
            this.state.generatedResult = result;
            if (portraitId) {
                try {
                    await this.refreshPortraitDocument(portraitId);
                }
                catch {
                    // The generated result remains visible even if portrait refresh fails.
                }
                if (!this.hasGeneratedQuestionMessage(requestId)) {
                    try {
                        await this.appendPortraitHistoryMessage({
                            role: "assistant",
                            kind: "generated_question",
                            content: "已生成题目。",
                            request_id: requestId,
                            payload: result,
                            created_at: new Date().toISOString(),
                        });
                    }
                    catch {
                        // The generated result remains visible even if history persistence fails.
                    }
                }
            }
        }
        catch (error) {
            this.state.specNormalizeResponse = readSpecResponseFromError(error);
            throw error;
        }
        finally {
            await this.fetchProgressSnapshot(requestId, true);
            this.stopProgressPolling();
            this.emit();
        }
    }
    startProgressPolling(requestId) {
        this.stopProgressPolling();
        void this.fetchProgressSnapshot(requestId, true);
        this.progressTimerId = window.setInterval(() => {
            void this.fetchProgressSnapshot(requestId, true);
        }, 1000);
    }
    stopProgressPolling() {
        if (this.progressTimerId !== null) {
            window.clearInterval(this.progressTimerId);
            this.progressTimerId = null;
        }
    }
    async fetchProgressSnapshot(requestId, silent404) {
        try {
            this.state.progressSnapshot = await this.api.getProgress(requestId);
            if (this.state.progressSnapshot.finished) {
                this.stopProgressPolling();
            }
            this.emit();
        }
        catch (error) {
            if (silent404 && error instanceof Error && "status" in error && error.status === 404) {
                return;
            }
            this.stopProgressPolling();
            this.emit();
        }
    }
    async downloadPortraitExport(format) {
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        if (!portraitId) {
            throw new Error("请先新建或打开规范对话。");
        }
        return this.api.downloadPortraitExport(portraitId, format);
    }
    async downloadQuestionExport(requestId, format, portraitIdOverride = "") {
        const portraitId = normalizeString(portraitIdOverride) || normalizeString(this.state.portraitDocument?.portrait_id);
        if (!portraitId) {
            throw new Error("请先新建或打开规范对话。");
        }
        return this.api.downloadQuestionExport(portraitId, requestId, format);
    }
    async submitQuestionFeedback(requestId, score, question) {
        const normalizedRequestId = normalizeString(requestId);
        if (!normalizedRequestId) {
            throw new Error("缺少题目 request_id，无法记录反馈。");
        }
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        await this.api.submitQuestionFeedback({
            request_id: normalizedRequestId,
            ...(portraitId ? { portrait_id: portraitId } : {}),
            score,
            question,
            context: {
                submitted_at: new Date().toISOString(),
            },
        });
    }
    async searchQuestionLibrary(filters) {
        this.state.questionLibraryLoading = true;
        this.state.questionLibraryError = "";
        this.state.questionLibrarySearched = true;
        this.emit();
        try {
            const response = await this.api.searchQuestionLibrary({
                subject: filters.subject,
                knowledge_point: filters.knowledge_point,
                difficulty: filters.difficulty,
                question_type: filters.question_type,
                content_mode: filters.content_mode,
                algorithm: filters.algorithm,
            });
            this.state.questionLibraryResults = Array.isArray(response.questions) ? response.questions : [];
        }
        catch (error) {
            this.state.questionLibraryResults = [];
            this.state.questionLibraryError = error instanceof Error ? error.message : "题库搜索失败";
        }
        finally {
            this.state.questionLibraryLoading = false;
            this.emit();
        }
    }
    clearQuestionLibrarySearch() {
        this.state.questionLibraryResults = [];
        this.state.questionLibraryLoading = false;
        this.state.questionLibraryError = "";
        this.state.questionLibrarySearched = false;
        this.emit();
    }
    getGenerateAvailability() {
        const readyState = getPortraitReadyState(this.state.portraitDocument);
        const hasSubject = Boolean(normalizeString(this.state.persisted.requestDraft.subject));
        const hasKnowledgePoint = Boolean(normalizeString(this.state.persisted.requestDraft.knowledge_point));
        return {
            canGenerate: !this.state.busy && hasSubject && hasKnowledgePoint,
            portraitReady: readyState.portraitReady,
            specReady: readyState.specReady,
        };
    }
}
