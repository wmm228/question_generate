import { DEFAULT_CLIENT_CONFIG } from "./question-agent-workbench-types.js";
import { IMAGE_TARGET_BY_PLACEMENT } from "./question-agent-workbench-types.js";
import { WorkbenchApi } from "./question-agent-workbench-api.js";
import { clearSessionToken, loadGuestAuth, loadSessionToken, loadWorkbenchState, saveGuestAuth, saveSessionToken, saveWorkbenchState, } from "./question-agent-workbench-storage.js";
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
        progressSnapshot: null,
        currentRequestId: "",
        persisted: loadWorkbenchState(),
    };
    constructor() {
        this.api.setSessionToken(this.state.sessionToken);
        this.api.setUnauthorizedHandler(() => {
            void this.bootstrapAnonymousSession();
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
        this.stopProgressPolling();
        this.setSessionToken("");
        this.state.currentUser = "";
        this.state.oahStatus = null;
        this.state.contractEnvelope = null;
        this.state.portraitList = [];
        this.state.portraitDocument = null;
        this.state.specNormalizeResponse = null;
        this.state.generatedResult = null;
        this.state.progressSnapshot = null;
        this.state.currentRequestId = "";
        this.state.persisted.activePortraitId = "";
        this.persist();
    }
    async restoreSession() {
        if (this.state.sessionToken) {
            try {
                const me = await this.api.me();
                this.state.currentUser = normalizeString(me.uid) || "自动会话";
                await this.refreshWorkbenchData();
                await this.restorePortrait();
                this.emit();
                return true;
            }
            catch {
                this.clearSession();
            }
        }
        await this.bootstrapAnonymousSession();
        return true;
    }
    createAnonymousAuth() {
        const stored = loadGuestAuth();
        if (stored) {
            return stored;
        }
        const uid = `guest_${globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12) || Date.now().toString(36)}`;
        const password = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now()}${Math.random().toString(36).slice(2)}`;
        const auth = { uid, password };
        saveGuestAuth(auth);
        return auth;
    }
    async bootstrapAnonymousSession() {
        const auth = this.createAnonymousAuth();
        try {
            const login = await this.api.login(auth.uid, auth.password);
            this.setSessionToken(normalizeString(login.token));
            this.state.currentUser = "自动会话";
            await this.refreshWorkbenchData();
            await this.restorePortrait();
            this.emit();
            return;
        }
        catch {
            // Fall through to register a local anonymous account.
        }
        const register = await this.api.register(auth.uid, auth.password);
        const token = normalizeString(register.token);
        const uid = normalizeString(register.uid);
        if (!token || !uid) {
            throw new Error("自动会话初始化失败");
        }
        this.setSessionToken(token);
        this.state.currentUser = "自动会话";
        await this.refreshWorkbenchData();
        await this.restorePortrait();
        this.emit();
    }
    async authenticate(mode, uid, password) {
        const response = mode === "login"
            ? await this.api.login(uid, password)
            : await this.api.register(uid, password);
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
        const [clientConfig, contract, oahStatus, portraitList] = await Promise.all([
            this.api.getClientConfig(),
            this.api.getContract(),
            this.api.getOahStatus(),
            this.api.listPortraits(),
        ]);
        this.state.clientConfig = clientConfig;
        this.state.contractEnvelope = contract;
        this.state.oahStatus = oahStatus;
        this.state.portraitList = normalizePortraitList(portraitList.portraits);
        this.emit();
    }
    async restorePortrait() {
        const preferredPortraitId = this.state.persisted.activePortraitId;
        const portraitId = preferredPortraitId || normalizeString(this.state.portraitList[0]?.portrait_id);
        if (!portraitId) {
            this.state.portraitDocument = null;
            this.state.specNormalizeResponse = null;
            this.emit();
            return;
        }
        await this.loadPortrait(portraitId, false);
    }
    async loadPortrait(portraitId, announce = true) {
        const response = await this.api.getPortrait(portraitId);
        this.state.portraitDocument = response.portrait || null;
        this.state.specNormalizeResponse = this.state.portraitDocument?.spec && this.state.portraitDocument?.plan
            ? {
                spec: this.state.portraitDocument.spec,
                plan: this.state.portraitDocument.plan,
            }
            : null;
        this.state.persisted.activePortraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        this.persist();
        if (announce) {
            this.emit();
            return;
        }
        this.emit();
    }
    setKnowledgePointDraft(value) {
        this.state.persisted.latestKnowledgePointDraft = value;
        this.state.persisted.requestDraft.knowledge_point = value;
        this.persist();
        this.emit();
    }
    setPortraitReplyDraft(value) {
        this.state.persisted.latestPortraitReplyDraft = value;
        this.persist();
        this.emit();
    }
    updateRequestDraft(patch) {
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
        this.emit();
    }
    syncPortraitToDraft() {
        const draft = this.state.portraitDocument?.draft;
        if (!draft) {
            return;
        }
        this.state.persisted.latestKnowledgePointDraft = normalizeString(draft.knowledge_point);
        this.state.persisted.requestDraft = {
            knowledge_point: normalizeString(draft.knowledge_point),
            difficulty: normalizeString(draft.difficulty) || "2",
            algorithm: normalizeString(draft.algorithm) || "direct",
            question_type: normalizeString(draft.question_type) || "multiple_choice",
            content_mode: normalizeString(draft.content_mode) || "text",
            image_mode: normalizeString(draft.image_mode) || "none",
            image_placement: normalizeString(draft.image_placement),
            image_targets: Array.isArray(draft.image_targets) ? draft.image_targets.map((item) => normalizeString(item)).filter(Boolean) : [],
        };
        this.persist();
        this.emit();
    }
    async startPortraitDialogue(message) {
        const response = await this.api.startPortrait(message);
        this.state.portraitDocument = response.portrait || null;
        this.state.persisted.activePortraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        this.state.persisted.latestPortraitReplyDraft = "";
        await this.refreshPortraitList();
        this.syncPortraitSpecState();
        this.persist();
        this.emit();
    }
    async sendPortraitReply(message) {
        const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
        if (!portraitId) {
            throw new Error("请先开始画像对话。");
        }
        const response = await this.api.replyPortrait(portraitId, message);
        this.state.portraitDocument = response.portrait || null;
        this.state.persisted.latestPortraitReplyDraft = "";
        await this.refreshPortraitList();
        this.syncPortraitSpecState();
        this.persist();
        this.emit();
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
    buildPayload() {
        const requestDraft = this.state.persisted.requestDraft;
        return {
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
        try {
            this.state.specNormalizeResponse = await this.api.normalizeSpec(payload, requestId);
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
        this.state.currentRequestId = requestId;
        this.state.generatedResult = null;
        this.state.progressSnapshot = null;
        this.emit();
        this.startProgressPolling(requestId);
        try {
            this.state.generatedResult = await this.api.generate(this.buildPayload(), requestId);
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
        void this.fetchProgressSnapshot(requestId, false);
        this.progressTimerId = window.setInterval(() => {
            void this.fetchProgressSnapshot(requestId, false);
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
            if (!silent404) {
                this.stopProgressPolling();
            }
        }
    }
    getGenerateAvailability() {
        const readyState = getPortraitReadyState(this.state.portraitDocument);
        return {
            canGenerate: readyState.portraitReady && readyState.specReady && !this.state.busy,
            portraitReady: readyState.portraitReady,
            specReady: readyState.specReady,
        };
    }
}
