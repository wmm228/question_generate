import type {
  GeneratedResult,
  GenerationPayload,
  OahStatusEnvelope,
  PersistedWorkbenchState,
  PortraitAttachment,
  PortraitDocumentEnvelope,
  PortraitListItem,
  PortraitMessage,
  PortraitTurnEnvelope,
  ProgressSnapshot,
  QuestionAgentContractEnvelope,
  QuestionLibraryItem,
  SpecNormalizeResponse,
  WorkbenchClientConfig,
} from "./question-agent-workbench-types";
import { DEFAULT_CLIENT_CONFIG, DEFAULT_PERSISTED_STATE } from "./question-agent-workbench-types.js";
import { IMAGE_TARGET_BY_PLACEMENT } from "./question-agent-workbench-types.js";
import { WorkbenchApi } from "./question-agent-workbench-api.js";
import {
  loadSessionToken,
  loadWorkbenchState,
  clearGuestAuth,
  clearSessionToken,
  saveSessionToken,
  saveWorkbenchState,
} from "./question-agent-workbench-storage.js";
import { createRequestId, getPortraitReadyState, normalizePortraitList, normalizeString, readSpecResponseFromError } from "./question-agent-workbench-utils.js";

const ACTIVE_GENERATION_STATUS_GRACE_MS = 2 * 60 * 1000;

export interface WorkbenchSessionState {
  authUid: string;
  sessionToken: string;
  currentUser: string;
  busy: boolean;
  clientConfig: WorkbenchClientConfig;
  contractEnvelope: QuestionAgentContractEnvelope | null;
  oahStatus: OahStatusEnvelope | null;
  portraitList: PortraitListItem[];
  portraitDocument: PortraitDocumentEnvelope | null;
  specNormalizeResponse: SpecNormalizeResponse | null;
  generatedResult: GeneratedResult | null;
  questionLibraryResults: QuestionLibraryItem[];
  questionLibraryLoading: boolean;
  questionLibraryError: string;
  questionLibrarySearched: boolean;
  progressSnapshot: ProgressSnapshot | null;
  currentRequestId: string;
  persisted: PersistedWorkbenchState;
}

export class WorkbenchSessionStore {
  private readonly api = new WorkbenchApi();
  private readonly listeners = new Set<() => void>();
  private progressTimerId: number | null = null;

  readonly state: WorkbenchSessionState = {
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private persist(): void {
    saveWorkbenchState(this.state.persisted);
  }

  commitLayout(): void {
    this.persist();
    this.emit();
  }

  private resetGenerationState(): void {
    this.stopProgressPolling();
    this.state.generatedResult = null;
    this.state.progressSnapshot = null;
    this.state.currentRequestId = "";
  }

  private setActiveGeneration(requestId: string, portraitId: string): void {
    this.state.persisted.activeGeneration = {
      requestId,
      portraitId,
      startedAt: new Date().toISOString(),
    };
    this.persist();
  }

  private clearActiveGeneration(requestId = ""): void {
    const activeRequestId = normalizeString(this.state.persisted.activeGeneration?.requestId);
    if (requestId && activeRequestId && activeRequestId !== requestId) {
      return;
    }
    this.state.persisted.activeGeneration = null;
    this.persist();
  }

  private isActiveGenerationRequest(requestId: string): boolean {
    const activeRequestId = normalizeString(this.state.persisted.activeGeneration?.requestId);
    return Boolean(activeRequestId && activeRequestId === normalizeString(requestId));
  }

  private shouldKeepMissingActiveGeneration(requestId: string): boolean {
    if (!this.isActiveGenerationRequest(requestId)) {
      return false;
    }
    const startedAt = Date.parse(normalizeString(this.state.persisted.activeGeneration?.startedAt));
    if (!Number.isFinite(startedAt)) {
      return false;
    }
    return Date.now() - startedAt <= ACTIVE_GENERATION_STATUS_GRACE_MS;
  }

  private markActiveGenerationMissing(requestId: string): void {
    const now = new Date().toISOString();
    const activeStartedAt = normalizeString(this.state.persisted.activeGeneration?.startedAt) || now;
    this.stopProgressPolling();
    this.state.currentRequestId = normalizeString(requestId);
    this.state.progressSnapshot = {
      requestId: normalizeString(requestId),
      startedAt: activeStartedAt,
      updatedAt: now,
      finished: true,
      error: "生成请求没有建立服务端进度，可能已被刷新中断。请重新点击生成。",
      stages: [
        {
          key: "submit",
          label: "提交请求",
          detail: "未确认服务端接收本次生成请求。",
          state: "error",
          updatedAt: now,
        },
      ],
      logs: ["刷新后没有找到本次生成请求的服务端进度快照。"],
    };
    this.clearActiveGeneration(requestId);
    this.emit();
  }

  private async finalizeFinishedActiveGeneration(requestId: string): Promise<void> {
    if (!this.isActiveGenerationRequest(requestId)) {
      return;
    }
    const portraitId = normalizeString(this.state.persisted.activeGeneration?.portraitId);
    if (portraitId) {
      try {
        await this.refreshPortraitDocument(portraitId);
      } catch {
        // Keep the terminal progress state visible if portrait refresh fails.
      }
    }
    this.clearActiveGeneration(requestId);
  }

  setAuthUid(value: string): void {
    this.state.authUid = value;
    this.emit();
  }

  setBusy(value: boolean): void {
    this.state.busy = value;
    this.emit();
  }

  setSessionToken(token: string): void {
    this.state.sessionToken = token;
    this.api.setSessionToken(token);
    if (token) {
      saveSessionToken(token);
    } else {
      clearSessionToken();
    }
  }

  clearSession(): void {
    this.resetGenerationState();
    this.setSessionToken("");
    this.state.currentUser = "";
    this.state.oahStatus = null;
    this.state.contractEnvelope = null;
    this.state.portraitList = [];
    this.state.portraitDocument = null;
    this.state.specNormalizeResponse = null;
    this.state.persisted.activePortraitId = "";
    this.clearActiveGeneration();
    clearGuestAuth();
    this.persist();
  }

  async restoreSession(): Promise<boolean> {
    try {
      const me = await this.api.me();
      const uid = normalizeString(me.uid);
      if (!uid || uid.startsWith("guest_")) {
        try {
          await this.api.logout();
        } catch {
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
      await this.restoreActiveGeneration();
      this.emit();
      return true;
    } catch {
      this.clearSession();
    }

    this.emit();
    return false;
  }

  async authenticate(mode: "login" | "register", uid: string, password: string, email = ""): Promise<void> {
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
    await this.restoreActiveGeneration();
    this.emit();
  }

  async logout(): Promise<void> {
    try {
      if (this.state.sessionToken) {
        await this.api.logout();
      }
    } finally {
      this.clearSession();
      this.emit();
    }
  }

  async refreshWorkbenchData(): Promise<void> {
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

  async restorePortrait(): Promise<void> {
    const portraitId = normalizeString(this.state.persisted.activePortraitId);
    if (!portraitId) {
      this.state.portraitDocument = null;
      this.state.specNormalizeResponse = null;
      this.emit();
      return;
    }
    try {
      await this.loadPortrait(portraitId, false);
    } catch {
      this.state.portraitDocument = null;
      this.state.specNormalizeResponse = null;
      this.state.persisted.activePortraitId = "";
      this.persist();
      this.emit();
    }
  }

  async restoreActiveGeneration(): Promise<void> {
    const activeGeneration = this.state.persisted.activeGeneration;
    const requestId = normalizeString(activeGeneration?.requestId);
    const portraitId = normalizeString(activeGeneration?.portraitId);
    if (!requestId) {
      return;
    }
    if (portraitId && normalizeString(this.state.portraitDocument?.portrait_id) !== portraitId) {
      return;
    }
    this.state.currentRequestId = requestId;
    this.emit();
    const foundSnapshot = await this.fetchProgressSnapshot(requestId, true);
    if (!foundSnapshot) {
      if (this.shouldKeepMissingActiveGeneration(requestId)) {
        this.startProgressPolling(requestId);
        return;
      }
      this.markActiveGenerationMissing(requestId);
      return;
    }
    if (this.state.progressSnapshot?.finished) {
      if (portraitId) {
        try {
          await this.refreshPortraitDocument(portraitId);
        } catch {
          // Keep the progress snapshot visible even if portrait refresh fails.
        }
      }
      this.clearActiveGeneration(requestId);
      return;
    }
    this.startProgressPolling(requestId);
  }

  startNewPortraitDraft(): void {
    this.resetGenerationState();
    this.state.portraitDocument = null;
    this.state.specNormalizeResponse = null;
    this.state.persisted.activePortraitId = "";
    this.clearActiveGeneration();
    this.state.persisted.latestPortraitReplyDraft = "";
    this.persist();
    this.emit();
  }

  startNewRequestDraft(): void {
    this.resetGenerationState();
    this.state.portraitDocument = null;
    this.state.specNormalizeResponse = null;
    this.state.persisted.activePortraitId = "";
    this.clearActiveGeneration();
    this.state.persisted.latestKnowledgePointDraft = "";
    this.state.persisted.latestPortraitReplyDraft = "";
    this.state.persisted.requestDraft = structuredClone(DEFAULT_PERSISTED_STATE.requestDraft);
    this.persist();
    this.emit();
  }

  async loadPortrait(portraitId: string, announce = true): Promise<void> {
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

  async archivePortrait(portraitId: string): Promise<void> {
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
      this.clearActiveGeneration();
      this.state.persisted.latestPortraitReplyDraft = "";
    }
    await this.refreshPortraitList();
    this.persist();
    this.emit();
  }

  private async refreshPortraitDocument(portraitId: string): Promise<void> {
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

  async refreshActivePortrait(): Promise<void> {
    const portraitId = normalizeString(this.state.portraitDocument?.portrait_id || this.state.persisted.activePortraitId);
    if (!portraitId) {
      return;
    }
    await this.refreshPortraitDocument(portraitId);
  }

  setKnowledgePointDraft(value: string, notify = true): void {
    this.state.persisted.latestKnowledgePointDraft = value;
    this.state.persisted.requestDraft.knowledge_point = value;
    this.persist();
    if (notify) {
      this.emit();
    }
  }

  setSubjectDraft(value: string, notify = true): void {
    this.state.persisted.requestDraft.subject = value;
    this.persist();
    if (notify) {
      this.emit();
    }
  }

  setPortraitReplyDraft(value: string, notify = true): void {
    this.state.persisted.latestPortraitReplyDraft = value;
    this.persist();
    if (notify) {
      this.emit();
    }
  }

  updateRequestDraft(patch: Partial<GenerationPayload>, notify = true): void {
    this.state.persisted.requestDraft = {
      ...this.state.persisted.requestDraft,
      ...patch,
    };

    if (patch.image_placement !== undefined) {
      this.state.persisted.requestDraft.image_targets = patch.image_placement
        ? IMAGE_TARGET_BY_PLACEMENT[patch.image_placement] || []
        : [];
    }

    const contentMode = normalizeString(this.state.persisted.requestDraft.content_mode) || "text";
    if (contentMode === "image") {
      this.state.persisted.requestDraft.image_mode = "required";
    } else {
      this.state.persisted.requestDraft.image_mode = "none";
      this.state.persisted.requestDraft.image_placement = "";
      this.state.persisted.requestDraft.image_targets = [];
    }

    this.persist();
    if (notify) {
      this.emit();
    }
  }

  syncPortraitToDraft(): void {
    if (!this.applyPortraitDraftToRequestDraft()) {
      return;
    }
    this.persist();
    this.emit();
  }

  private applyPortraitDraftToRequestDraft(): boolean {
    const draft = this.state.portraitDocument?.draft;
    if (!draft) {
      return false;
    }
    const contentMode = normalizeString(draft.content_mode) || "text";
    this.state.persisted.latestKnowledgePointDraft = normalizeString(draft.knowledge_point);
    this.state.persisted.requestDraft = {
      subject: normalizeString(draft.subject),
      knowledge_point: normalizeString(draft.knowledge_point),
      difficulty: normalizeString(draft.difficulty) || "2",
      algorithm: normalizeString(draft.algorithm) || "direct",
      question_type: normalizeString(draft.question_type) || "multiple_choice",
      content_mode: contentMode,
      image_mode: contentMode === "image" ? "required" : "none",
      image_placement: contentMode === "image" ? normalizeString(draft.image_placement) : "",
      image_targets: contentMode === "image" && Array.isArray(draft.image_targets)
        ? draft.image_targets.map((item) => normalizeString(item)).filter(Boolean)
        : [],
    };
    return true;
  }

  async startPortraitDialogue(message: string, attachments: PortraitAttachment[] = []): Promise<PortraitTurnEnvelope> {
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

  async sendPortraitReply(message: string, attachments: PortraitAttachment[] = []): Promise<PortraitTurnEnvelope> {
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

  private syncPortraitSpecState(): void {
    this.state.specNormalizeResponse = this.state.portraitDocument?.spec && this.state.portraitDocument?.plan
      ? { spec: this.state.portraitDocument.spec, plan: this.state.portraitDocument.plan }
      : null;
  }

  async refreshPortraitList(): Promise<void> {
    const portraitList = await this.api.listPortraits();
    this.state.portraitList = normalizePortraitList(portraitList.portraits);
  }

  private async appendPortraitHistoryMessage(message: PortraitMessage): Promise<void> {
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

  hasGeneratedQuestionMessage(requestId: string): boolean {
    const normalizedRequestId = normalizeString(requestId);
    if (!normalizedRequestId) {
      return false;
    }
    return (this.state.portraitDocument?.messages || []).some((message) => (
      normalizeString(message.kind) === "generated_question"
      && normalizeString(message.request_id) === normalizedRequestId
    ));
  }

  buildPayload(): GenerationPayload {
    const requestDraft = this.state.persisted.requestDraft;
    const contentMode = normalizeString(requestDraft.content_mode) || "text";
    return {
      subject: normalizeString(requestDraft.subject),
      knowledge_point: normalizeString(requestDraft.knowledge_point),
      difficulty: normalizeString(requestDraft.difficulty) || "2",
      algorithm: normalizeString(requestDraft.algorithm) || "direct",
      question_type: normalizeString(requestDraft.question_type) || "multiple_choice",
      content_mode: contentMode,
      image_mode: contentMode === "image" ? "required" : "none",
      image_placement: contentMode === "image" ? normalizeString(requestDraft.image_placement) : "",
      image_targets: contentMode === "image" && Array.isArray(requestDraft.image_targets)
        ? requestDraft.image_targets.map((item) => normalizeString(item)).filter(Boolean)
        : [],
    };
  }

  async validateSpec(): Promise<SpecNormalizeResponse> {
    const requestId = createRequestId();
    this.state.currentRequestId = requestId;
    const payload = this.buildPayload();
    const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
    try {
      let normalizeResponse: SpecNormalizeResponse;
      if (portraitId) {
        const response = await this.api.commitPortraitSpec(portraitId, payload as unknown as Record<string, unknown>, requestId);
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
      } else {
        normalizeResponse = await this.api.normalizeSpec(payload as unknown as Record<string, unknown>, requestId);
        this.state.specNormalizeResponse = normalizeResponse;
      }
      return normalizeResponse;
    } catch (error) {
      this.state.specNormalizeResponse = readSpecResponseFromError(error);
      throw error;
    } finally {
      this.emit();
    }
  }

  async generateQuestion(): Promise<void> {
    const requestId = createRequestId();
    const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
    this.state.currentRequestId = requestId;
    this.setActiveGeneration(requestId, portraitId);
    this.state.generatedResult = null;
    this.state.progressSnapshot = null;
    this.emit();
    this.startProgressPolling(requestId);
    try {
      const requestPayload = {
        ...(this.buildPayload() as unknown as Record<string, unknown>),
        ...(portraitId ? { portrait_id: portraitId } : {}),
      };
      const result = await this.api.generate(requestPayload, requestId);
      this.state.generatedResult = result;
      if (portraitId) {
        try {
          await this.refreshPortraitDocument(portraitId);
        } catch {
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
          } catch {
            // The generated result remains visible even if history persistence fails.
          }
        }
      }
    } catch (error) {
      this.state.specNormalizeResponse = readSpecResponseFromError(error);
      throw error;
    } finally {
      await this.fetchProgressSnapshot(requestId, true);
      if (portraitId) {
        try {
          await this.refreshPortraitDocument(portraitId);
        } catch {
          // The progress/error state remains visible even if portrait refresh fails.
        }
      }
      this.clearActiveGeneration(requestId);
      this.stopProgressPolling();
      this.emit();
    }
  }

  private startProgressPolling(requestId: string): void {
    this.stopProgressPolling();
    void this.fetchProgressSnapshot(requestId, true);
    this.progressTimerId = window.setInterval(() => {
      void this.fetchProgressSnapshot(requestId, true);
    }, 1000);
  }

  stopProgressPolling(): void {
    if (this.progressTimerId !== null) {
      window.clearInterval(this.progressTimerId);
      this.progressTimerId = null;
    }
  }

  async fetchProgressSnapshot(requestId: string, silent404: boolean): Promise<boolean> {
    try {
      this.state.progressSnapshot = await this.api.getProgress(requestId);
      if (this.state.progressSnapshot.finished && this.state.progressSnapshot.result) {
        this.state.generatedResult = this.state.progressSnapshot.result;
      }
      if (this.state.progressSnapshot.finished) {
        this.stopProgressPolling();
        await this.finalizeFinishedActiveGeneration(requestId);
      }
      this.emit();
      return true;
    } catch (error) {
      if (silent404 && error instanceof Error && "status" in error && (error as { status?: number }).status === 404) {
        if (this.shouldKeepMissingActiveGeneration(requestId)) {
          this.emit();
          return false;
        }
        if (this.isActiveGenerationRequest(requestId)) {
          this.markActiveGenerationMissing(requestId);
          return false;
        }
        return false;
      }
      this.stopProgressPolling();
      this.emit();
      return false;
    }
  }

  async downloadPortraitExport(format: string): Promise<Blob> {
    const portraitId = normalizeString(this.state.portraitDocument?.portrait_id);
    if (!portraitId) {
      throw new Error("请先新建或打开规范对话。");
    }
    return this.api.downloadPortraitExport(portraitId, format);
  }

  async downloadQuestionExport(requestId: string, format: string, portraitIdOverride = ""): Promise<Blob> {
    const portraitId = normalizeString(portraitIdOverride) || normalizeString(this.state.portraitDocument?.portrait_id);
    if (!portraitId) {
      throw new Error("请先新建或打开规范对话。");
    }
    return this.api.downloadQuestionExport(portraitId, requestId, format);
  }

  async submitQuestionFeedback(requestId: string, score: number, question: GeneratedResult | null): Promise<void> {
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

  async searchQuestionLibrary(filters: GenerationPayload): Promise<void> {
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
    } catch (error) {
      this.state.questionLibraryResults = [];
      this.state.questionLibraryError = error instanceof Error ? error.message : "题库搜索失败";
    } finally {
      this.state.questionLibraryLoading = false;
      this.emit();
    }
  }

  clearQuestionLibrarySearch(): void {
    this.state.questionLibraryResults = [];
    this.state.questionLibraryLoading = false;
    this.state.questionLibraryError = "";
    this.state.questionLibrarySearched = false;
    this.emit();
  }

  getGenerateAvailability(): {
    canGenerate: boolean;
    portraitReady: boolean;
    specReady: boolean;
  } {
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
