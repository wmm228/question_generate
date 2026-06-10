import { IMAGE_TARGET_BY_PLACEMENT } from "./question-agent-workbench-types.js";
import { WorkbenchSessionStore } from "./question-agent-workbench-state.js";
import { autoResizeTextarea, buildProgressStageMarkup, escapeHtml, formatPortraitTime, getPortraitReadyState, normalizeString, readPortraitChecklist, readPortraitMissingItems, readPortraitNextStep, readPortraitStatusExplanation, renderMathText, renderValidationMessages, renderPendingFieldLabel, requireElement, resolveExplanationImageSrc, resolveOptionImageMap, resolveStemImageSrc, translateProgressText, } from "./question-agent-workbench-utils.js";
const PORTRAIT_ATTACHMENT_MAX_COUNT = 4;
const PORTRAIT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const PORTRAIT_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
]);
function stripOptionPrefix(value) {
    const normalized = normalizeString(value);
    return normalized.replace(/^[A-D]\s*[.、:：)]\s*/, "").trim() || normalized;
}
class QuestionAgentWorkbenchApp {
    store = new WorkbenchSessionStore();
    loginMask = requireElement("login-mask");
    tabLogin = requireElement("tab-login");
    tabRegister = requireElement("tab-register");
    authPanelTitle = requireElement("auth-panel-title");
    authUidInput = requireElement("auth-uid");
    authEmailInput = requireElement("auth-email");
    authEmailField = requireElement("auth-email-field");
    authPwdInput = requireElement("auth-pwd");
    authPwdToggle = requireElement("auth-pwd-toggle");
    authConfirmPwdInput = requireElement("auth-confirm-pwd");
    authConfirmPwdToggle = requireElement("auth-confirm-pwd-toggle");
    authConfirmField = requireElement("auth-confirm-field");
    authSwitchLink = requireElement("auth-switch-link");
    authError = requireElement("auth-error");
    authSubmitButton = requireElement("auth-submit");
    authButtonText = requireElement("auth-btn-text");
    openAuthButton = requireElement("open-auth-button");
    logoutButton = requireElement("logout-button");
    userName = requireElement("user-name");
    runtimeBadges = requireElement("runtime-badges");
    runtimeSummary = requireElement("runtime-summary");
    refreshRuntimeButton = requireElement("refresh-runtime-button");
    runtimeDiagnosis = requireElement("runtime-diagnosis");
    portraitStartButton = requireElement("portrait-start-button");
    portraitSyncButton = requireElement("portrait-sync-button");
    portraitSendButton = requireElement("portrait-send-button");
    portraitFileInput = requireElement("portrait-file-input");
    portraitReplyInput = requireElement("portrait-reply");
    portraitAttachments = requireElement("portrait-attachments");
    queuedPortraitReply = requireElement("queued-portrait-reply");
    portraitChat = requireElement("portrait-chat");
    chatSpecForm = requireElement("chat-spec-form");
    portraitBadges = requireElement("portrait-badges");
    portraitSource = requireElement("portrait-source");
    portraitFeedback = requireElement("portrait-feedback");
    portraitErrors = requireElement("portrait-errors");
    portraitChecklist = requireElement("portrait-checklist");
    portraitNextStep = requireElement("portrait-next-step");
    portraitMarkdown = requireElement("portrait-markdown");
    portraitSpecMeta = requireElement("portrait-spec-meta");
    portraitMissingMeta = requireElement("portrait-missing-meta");
    portraitConfirmedMeta = requireElement("portrait-confirmed-meta");
    exportWordButton = requireElement("export-word-button");
    exportFormatSelect = requireElement("export-format-select");
    exportSpecButton = requireElement("export-spec-button");
    exportResultButton = requireElement("export-result-button");
    sessionHistory = requireElement("session-history");
    sessionHistoryEmpty = requireElement("session-history-empty");
    sessionSearchInput = requireElement("session-search");
    sessionStripTitle = requireElement("session-strip-title");
    sessionStripMeta = requireElement("session-strip-meta");
    sessionRefreshButton = requireElement("session-refresh-button");
    sessionOpenLatestButton = requireElement("session-open-latest-button");
    sessionSyncButton = requireElement("session-sync-button");
    sessionNewButton = requireElement("session-new-button");
    knowledgePointInput = requireElement("knowledge-point");
    subjectInput = requireElement("subject");
    generateFeedback = requireElement("generate-feedback");
    validateButton = requireElement("validate-button");
    generateButton = requireElement("generate-button");
    difficultySelect = requireElement("difficulty");
    algorithmSelect = requireElement("algorithm");
    questionTypeSelect = requireElement("question-type");
    contentModeSelect = requireElement("content-mode");
    imageModeSelect = requireElement("image-mode");
    imagePlacementSelect = requireElement("image-placement");
    imagePlacementField = requireElement("image-placement-field");
    imageControls = requireElement("image-controls");
    requestBadges = requireElement("request-badges");
    requestSummary = requireElement("request-summary");
    specPreview = requireElement("spec-preview");
    contractSource = requireElement("contract-source");
    contractBadges = requireElement("contract-badges");
    contractPreview = requireElement("contract-preview");
    progressRequestId = requireElement("progress-request-id");
    progressView = requireElement("progress-view");
    progressLogs = requireElement("progress-logs");
    resultView = requireElement("result-view");
    materialSpecMeta = requireElement("material-spec-meta");
    materialSubjectLabel = requireElement("material-subject-label");
    materialSubjectMeta = requireElement("material-subject-meta");
    materialKnowledgeLabel = requireElement("material-knowledge-label");
    materialKnowledgeMeta = requireElement("material-knowledge-meta");
    materialTypeLabel = requireElement("material-type-label");
    materialTypeMeta = requireElement("material-type-meta");
    materialQuestionLabel = requireElement("material-question-label");
    materialModeMeta = requireElement("material-mode-meta");
    materialResultMeta = requireElement("material-result-meta");
    materialProgressMeta = requireElement("material-progress-meta");
    materialJsonMeta = requireElement("material-json-meta");
    materialPreviewTitle = requireElement("material-preview-title");
    materialPreviewSubtitle = requireElement("material-preview-subtitle");
    materialOpenLabel = requireElement("material-open-label");
    materialCopyButton = requireElement("material-copy-button");
    materialEditButton = requireElement("material-edit-button");
    materialExportButton = requireElement("material-export-button");
    workspaceSidebar = requireElement("workspace-sidebar");
    sidebarResizeHandle = requireElement("sidebar-resize-handle");
    studioGrid = requireElement("studio-grid");
    chatSurface = requireElement("chat-surface");
    inspectorColumn = requireElement("inspector-column");
    inspectorResizeHandle = requireElement("inspector-resize-handle");
    toggleSidebarButton = requireElement("toggle-sidebar-button");
    toggleInspectorButton = requireElement("toggle-inspector-button");
    closeInspectorDetailButton = requireElement("close-inspector-detail-button");
    inspectorLauncher = requireElement("inspector-launcher");
    inspectorLauncherMenu = requireElement("inspector-launcher-menu");
    inspectorRailButton = requireElement("inspector-rail-button");
    authMode = "login";
    sessionSearchQuery = "";
    dialogueScrollTimerId = null;
    inspectorScrollTimerId = null;
    hiddenHistoryIds = new Set(this.readLocalStringArray("hidden_history_ids"));
    submittedFeedbackRequestIds = new Set(this.readLocalStringArray("submitted_feedback_request_ids"));
    historyTitleOverrides = this.readLocalStringRecord("history_title_overrides");
    portraitReplyCompositionActive = false;
    sendingPortraitReply = false;
    localTeacherNotice = "";
    pendingTeacherMessage = "";
    waitingForAssistant = false;
    localAssistantNotice = "";
    localAssistantNoticeTone = "neutral";
    requestFormOpened = false;
    activeMaterialTarget = "inspector-section-result";
    materialPreviewOpen = false;
    materialTreeInitialized = false;
    pendingAttachments = [];
    pendingTeacherAttachments = [];
    queuedTeacherMessage = "";
    queuedTeacherAttachments = [];
    portraitPollTimerId = null;
    handledPortraitGenerationIntentKeys = new Set();
    portraitGenerationIntentInFlight = false;
    async init() {
        this.bindEvents();
        this.hydrateFromQuery();
        this.store.subscribe(() => this.render());
        const restored = await this.store.restoreSession();
        if (restored) {
            this.hideLogin();
            if (this.isGenerationInProgress()) {
                this.renderGenerationFeedbackFromProgress();
            }
            else {
                this.setFeedback(this.generateFeedback, "工作台已连接。", "ok");
            }
        }
        else {
            this.showLogin();
            this.setFeedback(this.generateFeedback, "请登录或注册后使用工作台。", "warn");
        }
        this.syncRequestFormOpenedFromPortrait();
        this.setAuthMode(this.authMode);
        this.render();
    }
    bindEvents() {
        this.tabLogin.addEventListener("click", () => this.setAuthMode("login"));
        this.tabRegister.addEventListener("click", () => this.setAuthMode("register"));
        this.authSwitchLink.addEventListener("click", () => {
            this.setAuthMode(this.authMode === "login" ? "register" : "login");
        });
        this.authSubmitButton.addEventListener("click", () => void this.handleAuth());
        this.authPwdToggle.addEventListener("click", () => this.togglePasswordVisibility(this.authPwdInput, this.authPwdToggle, "密码"));
        this.authConfirmPwdToggle.addEventListener("click", () => this.togglePasswordVisibility(this.authConfirmPwdInput, this.authConfirmPwdToggle, "确认密码"));
        this.authUidInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                if (this.authMode === "register") {
                    this.authEmailInput.focus();
                }
                else {
                    this.authPwdInput.focus();
                }
            }
        });
        this.authEmailInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                this.authPwdInput.focus();
            }
        });
        this.authPwdInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && this.authMode === "login") {
                event.preventDefault();
                void this.handleAuth();
            }
        });
        this.authConfirmPwdInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                void this.handleAuth();
            }
        });
        this.openAuthButton.addEventListener("click", () => {
            this.setAuthMode("login");
            this.showLogin();
        });
        this.logoutButton.addEventListener("click", () => void this.handleLogout());
        this.refreshRuntimeButton.addEventListener("click", () => void this.refreshWorkbench());
        this.sessionRefreshButton.addEventListener("click", () => void this.handleRefreshCurrentSession());
        this.sessionOpenLatestButton.addEventListener("click", () => void this.handleOpenLatestSession());
        this.sessionSyncButton.addEventListener("click", () => this.handleSyncPortrait());
        this.sessionNewButton.addEventListener("click", () => void this.handleStartPortrait());
        this.toggleSidebarButton.addEventListener("click", () => this.toggleSidebar());
        this.toggleInspectorButton.addEventListener("click", () => this.toggleInspector());
        this.closeInspectorDetailButton.addEventListener("click", () => this.setInspectorCollapsed(true));
        this.inspectorRailButton.addEventListener("click", (event) => {
            event.preventDefault();
            this.toggleInspectorLauncherMenu();
        });
        this.inspectorLauncherMenu.addEventListener("click", (event) => this.handleInspectorLauncherMenuClick(event));
        this.inspectorColumn.addEventListener("click", (event) => this.handleInspectorNavigation(event));
        this.materialCopyButton.addEventListener("click", () => void this.handleMaterialPreviewAction("copy"));
        this.materialEditButton.addEventListener("click", () => void this.handleMaterialPreviewAction("edit"));
        this.materialExportButton.addEventListener("click", () => void this.handleMaterialPreviewAction("export"));
        document.addEventListener("click", (event) => {
            const target = event.target;
            if (target instanceof Node && !this.inspectorLauncher.contains(target)) {
                this.closeInspectorLauncherMenu();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.closeInspectorLauncherMenu();
            }
        });
        this.bindResizeHandles();
        this.bindDialogueScrollbar();
        this.bindInspectorScrollbar();
        this.sessionSearchInput.addEventListener("input", () => {
            this.sessionSearchQuery = normalizeString(this.sessionSearchInput.value).toLowerCase();
            this.renderSessionHistory();
        });
        this.knowledgePointInput.addEventListener("input", () => {
            this.store.setKnowledgePointDraft(this.knowledgePointInput.value, false);
            autoResizeTextarea(this.knowledgePointInput);
            this.renderRequestSummary();
            this.renderMaterialLibraryState();
            this.updateActionAvailability();
        });
        this.knowledgePointInput.addEventListener("blur", () => {
            this.store.setKnowledgePointDraft(this.knowledgePointInput.value);
        });
        this.subjectInput.addEventListener("input", () => {
            this.store.setSubjectDraft(this.subjectInput.value, false);
            this.renderRequestSummary();
            this.renderMaterialLibraryState();
            this.updateActionAvailability();
        });
        this.subjectInput.addEventListener("blur", () => {
            this.store.setSubjectDraft(this.subjectInput.value);
        });
        this.portraitReplyInput.addEventListener("input", () => {
            this.store.setPortraitReplyDraft(this.portraitReplyInput.value, false);
            autoResizeTextarea(this.portraitReplyInput);
        });
        this.portraitReplyInput.addEventListener("blur", () => {
            this.store.setPortraitReplyDraft(this.portraitReplyInput.value);
        });
        this.portraitReplyInput.addEventListener("paste", (event) => void this.handleAttachmentPaste(event));
        this.portraitReplyInput.addEventListener("keydown", (event) => {
            if (!this.shouldSubmitOnEnter(event, this.portraitReplyCompositionActive)) {
                return;
            }
            event.preventDefault();
            void this.handleSendPortraitReply();
        });
        this.portraitReplyInput.addEventListener("compositionstart", () => {
            this.portraitReplyCompositionActive = true;
        });
        this.portraitReplyInput.addEventListener("compositionend", () => {
            window.setTimeout(() => {
                this.portraitReplyCompositionActive = false;
            }, 0);
        });
        this.portraitStartButton.addEventListener("click", () => void this.handleStartPortrait());
        this.portraitSendButton.addEventListener("click", () => void this.handleSendPortraitReply());
        this.portraitFileInput.addEventListener("change", () => void this.handleAttachmentFiles(this.portraitFileInput.files));
        this.portraitAttachments.addEventListener("click", (event) => this.handleAttachmentAction(event));
        this.portraitAttachments.addEventListener("keydown", (event) => this.handleAttachmentKeydown(event));
        this.queuedPortraitReply.addEventListener("click", (event) => void this.handleQueuedReplyAction(event));
        this.portraitSyncButton.addEventListener("click", () => this.handleSyncPortrait());
        this.validateButton.addEventListener("click", () => void this.handleValidate());
        this.generateButton.addEventListener("click", () => void this.handleGenerate());
        this.exportWordButton.addEventListener("click", () => this.handleExport("word"));
        this.exportSpecButton.addEventListener("click", () => this.handleExport(this.readExportFormat()));
        this.exportResultButton.addEventListener("click", () => this.handleExportResult(this.readExportFormat()));
        this.portraitChat.addEventListener("click", (event) => void this.handleDialogueAction(event));
        this.resultView.addEventListener("click", (event) => void this.handleLibrarySearchAction(event));
        this.resultView.addEventListener("click", (event) => void this.handleDialogueAction(event));
        this.resultView.addEventListener("change", (event) => this.handleLibraryFilterChange(event));
        this.resultView.addEventListener("keydown", (event) => this.handleLibraryFilterKeydown(event));
        this.difficultySelect.addEventListener("change", () => this.syncFormToDraft());
        this.algorithmSelect.addEventListener("change", () => this.syncFormToDraft());
        this.questionTypeSelect.addEventListener("change", () => this.syncFormToDraft());
        this.contentModeSelect.addEventListener("change", () => this.syncFormToDraft());
        this.imageModeSelect.addEventListener("change", () => this.syncFormToDraft());
        this.imagePlacementSelect.addEventListener("change", () => this.syncFormToDraft());
        document.querySelectorAll("[data-workbench-preset]").forEach((button) => {
            button.addEventListener("click", () => {
                const dataset = button.dataset;
                this.requestFormOpened = true;
                this.knowledgePointInput.value = dataset.knowledgePoint || "";
                autoResizeTextarea(this.knowledgePointInput);
                this.store.setKnowledgePointDraft(this.knowledgePointInput.value);
                this.store.updateRequestDraft({
                    subject: dataset.subject || "",
                    knowledge_point: dataset.knowledgePoint || "",
                    algorithm: dataset.algorithm || "direct",
                    question_type: dataset.questionType || "multiple_choice",
                    content_mode: dataset.contentMode || "text",
                    image_mode: dataset.imageMode || "none",
                    image_placement: dataset.imagePlacement || "",
                });
                this.renderFormFromDraft();
                this.setFeedback(this.generateFeedback, "已进入试题规范表单。", "ok");
                window.setTimeout(() => this.knowledgePointInput.focus(), 0);
            });
        });
    }
    handleInspectorNavigation(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-inspector-target]");
        const closeButton = target.closest("[data-inspector-close-preview]");
        if (closeButton) {
            event.preventDefault();
            this.setInspectorCollapsed(true);
            this.updateMaterialPreviewState();
            return;
        }
        if (!button || !this.inspectorColumn.contains(button)) {
            return;
        }
        const targetId = normalizeString(button.dataset.inspectorTarget);
        const section = targetId ? document.getElementById(targetId) : null;
        if (!(section instanceof HTMLDetailsElement)) {
            return;
        }
        event.preventDefault();
        this.handleMaterialTreeToggle(button);
        this.activeMaterialTarget = targetId;
        this.materialPreviewOpen = true;
        this.setActiveInspectorNavigation(targetId, button);
        section.open = true;
        this.updateMaterialPreviewState();
    }
    handleInspectorLauncherMenuClick(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-inspector-launch-target]");
        if (!button || !this.inspectorLauncherMenu.contains(button)) {
            return;
        }
        event.preventDefault();
        const targetId = normalizeString(button.dataset.inspectorLaunchTarget);
        if (!targetId) {
            return;
        }
        this.openInspectorTarget(targetId);
    }
    toggleInspectorLauncherMenu(force) {
        const open = force ?? !this.inspectorLauncher.classList.contains("is-open");
        this.inspectorLauncher.classList.toggle("is-open", open);
        this.inspectorRailButton.setAttribute("aria-expanded", String(open));
    }
    closeInspectorLauncherMenu() {
        this.toggleInspectorLauncherMenu(false);
    }
    openInspectorTarget(targetId) {
        const section = document.getElementById(targetId);
        if (!(section instanceof HTMLDetailsElement)) {
            return;
        }
        this.activeMaterialTarget = targetId;
        this.materialPreviewOpen = true;
        this.store.state.persisted.layout.inspectorCollapsed = false;
        this.store.commitLayout();
        section.open = true;
        const activeButton = Array.from(this.inspectorColumn.querySelectorAll(".material-root, .material-node, .material-import"))
            .find((item) => normalizeString(item.dataset.inspectorTarget) === targetId);
        if (activeButton) {
            this.setActiveInspectorNavigation(targetId, activeButton);
        }
        this.updateMaterialPreviewState();
        this.closeInspectorLauncherMenu();
    }
    handleMaterialTreeToggle(button) {
        const tree = button.closest(".material-tree");
        if (!tree) {
            return;
        }
        if (button.classList.contains("material-level-1")) {
            const isOpening = tree.classList.contains("is-subject-collapsed");
            if (isOpening) {
                tree.classList.remove("is-subject-collapsed");
                tree.classList.add("is-knowledge-collapsed", "is-type-collapsed");
            }
            else {
                tree.classList.add("is-subject-collapsed", "is-knowledge-collapsed", "is-type-collapsed");
            }
        }
        else if (button.classList.contains("material-level-2")) {
            tree.classList.remove("is-subject-collapsed");
            const isOpening = tree.classList.contains("is-knowledge-collapsed");
            if (isOpening) {
                tree.classList.remove("is-knowledge-collapsed");
                tree.classList.add("is-type-collapsed");
            }
            else {
                tree.classList.add("is-knowledge-collapsed", "is-type-collapsed");
            }
        }
        else if (button.classList.contains("material-level-3")) {
            tree.classList.remove("is-subject-collapsed", "is-knowledge-collapsed");
            tree.classList.toggle("is-type-collapsed");
        }
        this.syncMaterialTreeExpandedState();
    }
    setActiveInspectorNavigation(targetId, activeButton) {
        const isQuestionBankTarget = targetId === "inspector-section-result";
        this.inspectorColumn.querySelectorAll(".material-root, .material-node, .material-import").forEach((node) => {
            const nodeTarget = normalizeString(node.dataset.inspectorTarget);
            const active = node === activeButton
                || (isQuestionBankTarget && nodeTarget === targetId && !node.classList.contains("material-import"));
            node.classList.toggle("active", active);
        });
        this.inspectorColumn.querySelectorAll(".material-preview-pane > .inspector-section").forEach((section) => {
            const active = section.id === targetId;
            section.classList.toggle("is-active-preview", active);
            section.open = active;
        });
    }
    syncMaterialTreeExpandedState() {
        const tree = this.inspectorColumn.querySelector(".material-tree");
        if (!tree) {
            return;
        }
        if (!this.materialTreeInitialized) {
            tree.classList.add("is-subject-collapsed", "is-knowledge-collapsed", "is-type-collapsed");
            this.materialTreeInitialized = true;
        }
        const subjectOpen = !tree.classList.contains("is-subject-collapsed");
        const knowledgeOpen = subjectOpen && !tree.classList.contains("is-knowledge-collapsed");
        const typeOpen = knowledgeOpen && !tree.classList.contains("is-type-collapsed");
        tree.querySelector(".material-level-1")?.setAttribute("aria-expanded", String(subjectOpen));
        tree.querySelector(".material-level-2")?.setAttribute("aria-expanded", String(knowledgeOpen));
        tree.querySelector(".material-level-3")?.setAttribute("aria-expanded", String(typeOpen));
    }
    hydrateFromQuery() {
        const query = new URLSearchParams(window.location.search);
        const knowledgePoint = normalizeString(query.get("knowledge_point"));
        if (knowledgePoint) {
            this.store.setKnowledgePointDraft(knowledgePoint);
        }
        const subject = normalizeString(query.get("subject"));
        const algorithm = normalizeString(query.get("algorithm"));
        const questionType = normalizeString(query.get("question_type"));
        const contentMode = normalizeString(query.get("content_mode"));
        const imageMode = normalizeString(query.get("image_mode"));
        const imagePlacement = normalizeString(query.get("image_placement"));
        if (subject || algorithm || questionType || contentMode || imageMode || imagePlacement) {
            this.store.updateRequestDraft({
                subject,
                algorithm,
                question_type: questionType,
                content_mode: contentMode,
                image_mode: imageMode,
                image_placement: imagePlacement,
            });
        }
    }
    render() {
        this.renderAuthState();
        this.renderRuntimeState();
        this.renderSessionHistory();
        this.renderPortraitState();
        this.renderFormFromDraft();
        this.renderAttachmentComposer();
        this.renderQueuedReply();
        this.renderRequestSummary();
        this.renderSpecState();
        this.renderContractState();
        this.renderProgressState();
        this.renderResultState();
        this.renderSessionStrip();
        this.renderMaterialLibraryState();
        this.renderLayoutState();
        this.syncPortraitPolling();
        this.updateActionAvailability();
    }
    renderAuthState() {
        const state = this.store.state;
        const authenticated = this.isAuthenticated();
        this.userName.textContent = state.currentUser || "未登录";
        this.logoutButton.disabled = !authenticated || state.busy;
        this.openAuthButton.textContent = authenticated ? "切换" : "登录";
        this.logoutButton.textContent = "退出";
        document.body.classList.toggle("is-authenticated", authenticated);
    }
    readLocalStringArray(key) {
        try {
            const raw = localStorage.getItem(`tutor_question_workbench_${key}`);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed.map((item) => normalizeString(item)).filter(Boolean) : [];
        }
        catch {
            return [];
        }
    }
    writeLocalStringArray(key, values) {
        try {
            localStorage.setItem(`tutor_question_workbench_${key}`, JSON.stringify(values));
        }
        catch {
            return;
        }
    }
    readLocalStringRecord(key) {
        try {
            const raw = localStorage.getItem(`tutor_question_workbench_${key}`);
            const parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                return {};
            }
            const entries = Object.entries(parsed)
                .map(([entryKey, entryValue]) => [normalizeString(entryKey), normalizeString(entryValue)])
                .filter(([entryKey, entryValue]) => Boolean(entryKey && entryValue));
            return Object.fromEntries(entries);
        }
        catch {
            return {};
        }
    }
    writeLocalStringRecord(key, values) {
        try {
            localStorage.setItem(`tutor_question_workbench_${key}`, JSON.stringify(values));
        }
        catch {
            return;
        }
    }
    renderRuntimeState() {
        const status = this.store.state.oahStatus;
        if (!status) {
            this.runtimeBadges.innerHTML = '<span class="badge">等待加载</span>';
            this.runtimeSummary.textContent = this.isAuthenticated()
                ? "点击刷新运行时以获取最新状态。"
                : "自动会话初始化中。";
            this.runtimeDiagnosis.textContent = "暂无诊断信息。";
            return;
        }
        const ready = status.run_execution_ready === true;
        const runtimeTone = ready ? "ok" : "warn";
        const workspace = status.workspace && typeof status.workspace === "object" ? status.workspace : {};
        const workspaceName = normalizeString(workspace.name) || "unknown";
        const workspaceRuntime = normalizeString(workspace.runtime) || "unknown";
        this.runtimeBadges.innerHTML = [
            this.renderBadge(ready ? "worker 就绪" : "worker 阻塞", runtimeTone),
            this.renderBadge(normalizeString(status.status) || "unknown", ready ? "ok" : "warn"),
        ].join("");
        this.runtimeSummary.textContent = [
            `workspace=${workspaceName}`,
            `runtime=${workspaceRuntime}`,
            status.details ? translateProgressText(status.details) : "",
            status.error ? translateProgressText(status.error) : "",
        ].filter(Boolean).join("\n");
        const diagnosis = status.diagnosis && typeof status.diagnosis === "object" ? status.diagnosis : {};
        this.runtimeDiagnosis.textContent = JSON.stringify({
            configured_model_ref: diagnosis.configured_model_ref || null,
            configured_model_url: diagnosis.configured_model_url || null,
            fallback_enabled: diagnosis.fallback_enabled ?? null,
            uses_workspace_default_model: diagnosis.uses_workspace_default_model ?? null,
            available_models: diagnosis.available_models || [],
            health: status.health || null,
        }, null, 2);
    }
    syncPortraitPolling() {
        const shouldPoll = this.isAuthenticated() && this.isPortraitAwaitingAssistant();
        if (!shouldPoll) {
            if (this.portraitPollTimerId !== null) {
                window.clearInterval(this.portraitPollTimerId);
                this.portraitPollTimerId = null;
            }
            return;
        }
        if (this.portraitPollTimerId !== null) {
            return;
        }
        this.portraitPollTimerId = window.setInterval(() => {
            void (async () => {
                await this.store.refreshActivePortrait();
                await this.maybeGenerateFromPortraitIntent();
            })().catch(() => undefined);
        }, 2500);
    }
    renderSessionStrip() {
        const portrait = this.store.state.portraitDocument;
        const readyState = getPortraitReadyState(portrait);
        if (!portrait) {
            this.sessionStripTitle.textContent = "当前规范：未开始";
            this.sessionStripMeta.textContent = "还没有活跃规范。";
            return;
        }
        const pendingField = renderPendingFieldLabel(normalizeString(portrait.pending_field));
        this.sessionStripTitle.textContent = `当前规范：${this.formatWorkbenchCopy(normalizeString(portrait.title) || "未命名规范")}`;
        this.sessionStripMeta.textContent = [
            `id=${normalizeString(portrait.portrait_id) || "-"}`,
            `status=${normalizeString(portrait.status) || "draft"}`,
            `待确认=${pendingField}`,
            `spec=${readyState.specReady ? "ready" : "blocked"}`,
            `updated=${formatPortraitTime(normalizeString(portrait.updated_at))}`,
        ].join(" | ");
    }
    renderSessionHistory() {
        const items = this.store.state.portraitList.filter((item) => {
            const portraitId = normalizeString(item.portrait_id);
            if (!portraitId) {
                return false;
            }
            if (!this.sessionSearchQuery) {
                return true;
            }
            const haystack = [
                normalizeString(item.title),
                normalizeString(item.summary),
                normalizeString(item.status),
                normalizeString(item.pending_field),
            ].join(" ").toLowerCase();
            return haystack.includes(this.sessionSearchQuery);
        });
        this.sessionHistory.innerHTML = "";
        this.sessionHistoryEmpty.style.display = items.length > 0 ? "none" : "block";
        this.sessionHistoryEmpty.textContent = this.sessionSearchQuery
            ? "没有匹配当前搜索条件的历史对话。"
            : "当前还没有历史对话。";
        for (const item of items) {
            this.sessionHistory.appendChild(this.createSessionHistoryNode(item));
        }
    }
    createSessionHistoryNode(item) {
        const portraitId = normalizeString(item.portrait_id);
        const title = this.formatWorkbenchCopy(this.historyTitleOverrides[portraitId] || normalizeString(item.title) || "未命名对话");
        const summary = this.formatWorkbenchCopy(normalizeString(item.summary) || title);
        const relativeTime = this.formatHistoryRelativeTime(normalizeString(item.history_updated_at) || normalizeString(item.updated_at));
        const node = document.createElement("div");
        node.className = "session-item";
        node.tabIndex = 0;
        node.setAttribute("role", "button");
        node.dataset.portraitId = portraitId;
        node.dataset.active = normalizeString(this.store.state.portraitDocument?.portrait_id) === portraitId
            ? "true"
            : "false";
        node.innerHTML = `
      <div class="session-folder-icon" aria-hidden="true">▾</div>
      <div class="session-item-copy">
        <div class="session-item-head">
          <strong>${escapeHtml(relativeTime)}</strong>
          <span>${escapeHtml(title)}</span>
        </div>
        <div class="session-item-summary">${escapeHtml(summary)}</div>
      </div>
      <div class="session-item-actions" aria-label="历史操作">
        <button class="session-action-button" type="button" title="删除" aria-label="删除" data-session-action="delete">⌫</button>
        <button class="session-action-button" type="button" title="编辑" aria-label="编辑" data-session-action="edit">✎</button>
      </div>
    `;
        node.addEventListener("click", (event) => {
            const actionButton = event.target instanceof HTMLElement
                ? event.target.closest("[data-session-action]")
                : null;
            if (actionButton) {
                event.preventDefault();
                event.stopPropagation();
                void this.handleSessionListAction(portraitId, normalizeString(actionButton.dataset.sessionAction), title);
                return;
            }
            void this.handleOpenPortrait(portraitId);
        });
        node.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void this.handleOpenPortrait(portraitId);
            }
        });
        return node;
    }
    formatWorkbenchCopy(value) {
        return normalizeString(value)
            .replace(/试题画像归一化助手|画像归一化助手|归一化助手|画像助手/g, "EduQG 虚拟教师")
            .replace(/画像归一化/g, "试题规范整理")
            .replace(/试题画像/g, "试题规范")
            .replace(/画像/g, "规范");
    }
    isRecord(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
    createAttachmentId() {
        return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `attachment_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    formatBytes(value) {
        if (!Number.isFinite(value) || value <= 0) {
            return "0KB";
        }
        if (value >= 1024 * 1024) {
            return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)}MB`;
        }
        return `${Math.max(1, Math.round(value / 1024))}KB`;
    }
    normalizeAttachmentPayloadItem(value) {
        if (!this.isRecord(value)) {
            return null;
        }
        const id = normalizeString(value.id);
        const name = normalizeString(value.name);
        const mimeType = normalizeString(value.mime_type).toLowerCase();
        const dataUrl = normalizeString(value.data_url);
        const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : 0;
        if (!id || !PORTRAIT_ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType) || !dataUrl.startsWith(`data:${mimeType};base64,`)) {
            return null;
        }
        return {
            id,
            name: name || "image",
            mime_type: mimeType,
            size,
            data_url: dataUrl,
        };
    }
    readMessageAttachments(payload) {
        if (!this.isRecord(payload) || !Array.isArray(payload.attachments)) {
            return [];
        }
        return payload.attachments
            .map((item) => this.normalizeAttachmentPayloadItem(item))
            .filter((item) => Boolean(item));
    }
    renderAttachmentImage(attachment, className) {
        return `<img class="${className}" src="${escapeHtml(attachment.data_url)}" alt="${escapeHtml(attachment.name)}">`;
    }
    renderDialogueAttachmentStrip(attachments) {
        if (attachments.length === 0) {
            return "";
        }
        return `
      <div class="dialogue-attachments" aria-label="消息图片附件">
        ${attachments.map((attachment) => `
          <a class="dialogue-attachment" href="${escapeHtml(attachment.data_url)}" target="_blank" rel="noopener" title="${escapeHtml(attachment.name)}">
            ${this.renderAttachmentImage(attachment, "dialogue-attachment-thumb")}
            <span>${escapeHtml(attachment.name)}</span>
          </a>
        `).join("")}
      </div>
    `;
    }
    isPortraitAwaitingAssistant(portrait = this.store.state.portraitDocument) {
        const messages = Array.isArray(portrait?.messages) ? portrait.messages || [] : [];
        if (messages.length === 0) {
            return false;
        }
        const latest = messages[messages.length - 1];
        return normalizeString(latest?.role) === "teacher"
            && this.isRecord(latest.payload)
            && this.readBooleanFlag(latest.payload.reply_pending);
    }
    isPortraitMessageSuperseded(message) {
        return this.isRecord(message.payload) && this.readBooleanFlag(message.payload.superseded);
    }
    readBooleanFlag(value) {
        return value === true || normalizeString(value).toLowerCase() === "true";
    }
    isSpecNormalizeReady(response) {
        return normalizeString(response?.spec?.status) === "ready";
    }
    formatSpecBlockedMessage(response) {
        const errors = Array.isArray(response?.spec?.validation_errors)
            ? response.spec.validation_errors.map((item) => normalizeString(item)).filter(Boolean)
            : [];
        const messages = renderValidationMessages(errors);
        return messages.length > 0
            ? `规范未 ready：${messages.join("；")}`
            : "规范未 ready，请补齐表单后再次提交。";
    }
    messageRequestsSpecForm(message) {
        if (!message || !this.isRecord(message.payload)) {
            return false;
        }
        const uiActions = message.payload.ui_actions;
        if (!this.isRecord(uiActions)) {
            return false;
        }
        return this.readBooleanFlag(uiActions.show_spec_form);
    }
    turnRequestsSpecForm(turn) {
        const messages = Array.isArray(turn.portrait?.messages) ? turn.portrait?.messages || [] : [];
        const latestAssistant = [...messages].reverse().find((message) => normalizeString(message.role) === "assistant");
        if (!latestAssistant || normalizeString(turn.teacher_intent) === "generate_question") {
            return false;
        }
        const kind = normalizeString(latestAssistant.kind) || "text";
        if (kind === "error"
            || kind === "generated_question"
            || this.isDialogueServiceError(this.getDialogueDisplayText(latestAssistant.content), kind)) {
            return false;
        }
        return this.messageRequestsSpecForm(latestAssistant);
    }
    portraitNeedsSpecForm(portrait) {
        if (!portrait) {
            return false;
        }
        if (this.findDisplayGeneratedResult()) {
            return false;
        }
        const readyState = getPortraitReadyState(portrait);
        if (readyState.portraitReady && readyState.specReady) {
            return false;
        }
        const pendingField = normalizeString(portrait.pending_field);
        const missingItems = readPortraitMissingItems(portrait);
        const validationErrors = Array.isArray(portrait.validation_errors) ? portrait.validation_errors || [] : [];
        return pendingField !== "none" || missingItems.length > 0 || validationErrors.length > 0;
    }
    portraitHasGenerationDraft(portrait) {
        if (!portrait || !this.isRecord(portrait.draft)) {
            return false;
        }
        const draft = portrait.draft;
        return Boolean(normalizeString(draft.subject)
            || normalizeString(draft.knowledge_point)
            || normalizeString(draft.difficulty)
            || normalizeString(draft.question_type)
            || normalizeString(draft.content_mode)
            || normalizeString(draft.algorithm)
            || normalizeString(draft.image_placement));
    }
    isDialogueServiceError(content, kind = "") {
        const text = this.formatWorkbenchCopy(content).toLowerCase();
        if (kind === "error") {
            return true;
        }
        return text.includes("规范对话服务暂时")
            || text.includes("eduqg 对话服务暂时")
            || text.includes("bad gateway")
            || text.includes("502")
            || (text.includes("oah") && (text.includes("不可用")
                || text.includes("失败")
                || text.includes("超时")
                || text.includes("failed")
                || text.includes("timed out")));
    }
    renderPortraitState() {
        const portrait = this.store.state.portraitDocument;
        const messages = Array.isArray(portrait?.messages) ? portrait.messages || [] : [];
        const hasVisibleConversation = Boolean(portrait) || this.waitingForAssistant || Boolean(this.pendingTeacherMessage);
        const portraitAwaitingAssistant = this.isPortraitAwaitingAssistant(portrait);
        const hasActiveRequest = this.hasActiveRequest();
        const showSpecForm = this.shouldShowSpecForm();
        const scrollState = this.readDialogueScrollState();
        this.detachSpecFormFromDialogue();
        document.body.classList.toggle("has-portrait", hasVisibleConversation);
        document.body.classList.toggle("has-active-request", hasActiveRequest);
        document.body.classList.toggle("is-waiting-assistant", this.waitingForAssistant || portraitAwaitingAssistant);
        document.body.classList.toggle("is-generating-question", this.isGenerationInProgress());
        document.body.classList.toggle("show-spec-form", showSpecForm);
        this.portraitReplyInput.placeholder = hasVisibleConversation
            ? "补充出题要求，例如：难度先定 3，题型用简答题，暂时不要图片。"
            : hasActiveRequest
                ? "可选补充说明，按 Enter 同步到上方表单。"
                : "输入出题需求，按 Enter 开始对话。";
        if (!portrait) {
            this.portraitSource.textContent = "portrait: -";
            this.portraitBadges.innerHTML = '<span class="badge">等待开始</span>';
            this.portraitChat.innerHTML = `${this.renderLocalTeacherNoticeMarkup()}${this.renderPendingDialogueMarkup()}${this.renderLocalAssistantNoticeMarkup()}`;
            this.portraitChat.scrollTop = 0;
            this.portraitMarkdown.textContent = "暂无规范文档。";
            this.renderPortraitGuidance(null);
            return;
        }
        this.portraitSource.textContent = `portrait: ${normalizeString(portrait.portrait_id)}${portrait.markdown_path ? ` | ${normalizeString(portrait.markdown_path)}` : ""}`;
        this.portraitBadges.innerHTML = [
            this.renderBadge(normalizeString(portrait.status) || "draft", normalizeString(portrait.status) === "ready" ? "ok" : "warn"),
            this.renderBadge(renderPendingFieldLabel(normalizeString(portrait.pending_field)), "neutral"),
        ].join("");
        const messageMarkup = messages.map((message, messageIndex) => {
            if (normalizeString(message.kind) === "generated_question" && this.isGeneratedResultPayload(message.payload)) {
                return this.renderGeneratedQuestionDialogueMarkup(message, messageIndex);
            }
            return this.renderStandardDialogueMarkup(message, messageIndex);
        }).join("");
        this.portraitChat.innerHTML = `${messageMarkup}${this.renderServerWaitingDialogueMarkup()}${this.renderTransientGeneratedQuestionMarkup()}${this.renderTransientGenerationProgressMarkup()}${this.renderLocalTeacherNoticeMarkup()}${this.renderPendingDialogueMarkup()}${this.renderLocalAssistantNoticeMarkup()}` || `
      <div class="dialogue-card dialogue-assistant">
        <div class="dialogue-role">EduQG</div>
        <div class="dialogue-text">规范已创建，等待生成流程更新。</div>
      </div>
    `;
        this.placeSpecFormInDialogue(showSpecForm);
        this.restoreDialogueScrollState(scrollState);
        this.portraitMarkdown.textContent = normalizeString(portrait.markdown) || "暂无规范文档。";
        this.renderPortraitGuidance(portrait);
        void this.typesetMath(this.portraitChat).then(() => this.restoreDialogueScrollState(scrollState));
    }
    detachSpecFormFromDialogue() {
        const formParent = this.chatSpecForm.parentElement;
        if (formParent && this.portraitChat.contains(this.chatSpecForm)) {
            this.portraitChat.insertAdjacentElement("afterend", this.chatSpecForm);
        }
        this.portraitChat.querySelector(".dialogue-form-item")?.remove();
    }
    placeSpecFormInDialogue(showSpecForm) {
        if (!showSpecForm) {
            return;
        }
        const item = document.createElement("div");
        item.className = "dialogue-form-item";
        const card = document.createElement("div");
        card.className = "dialogue-card dialogue-form-card";
        card.append(this.chatSpecForm);
        item.append(card);
        this.portraitChat.append(item);
    }
    renderPortraitGuidance(portrait) {
        const missingItems = readPortraitMissingItems(portrait).map((item) => this.formatWorkbenchCopy(item));
        const checklist = readPortraitChecklist(portrait).map((item) => this.formatWorkbenchCopy(item));
        const statusExplanation = this.formatWorkbenchCopy(readPortraitStatusExplanation(portrait));
        const nextStep = this.formatWorkbenchCopy(readPortraitNextStep(portrait));
        const validationErrors = renderValidationMessages(Array.isArray(portrait?.validation_errors) ? portrait.validation_errors || [] : [])
            .map((item) => this.formatWorkbenchCopy(item));
        if (!portrait) {
            this.portraitErrors.innerHTML = "<strong>缺失信息</strong><p>请在中间表单填写试题规范。</p>";
            this.portraitChecklist.innerHTML = '<div class="insight-empty">暂无已确认项。</div>';
            this.portraitNextStep.textContent = "下一步：填写学科、知识点、难度、题型和内容模式。";
            this.portraitSpecMeta.textContent = "未开始";
            this.portraitMissingMeta.textContent = "未开始";
            this.portraitConfirmedMeta.textContent = "未确认";
            return;
        }
        const listItems = [...missingItems, ...validationErrors];
        const readyState = getPortraitReadyState(portrait);
        this.portraitSpecMeta.textContent = readyState.portraitReady && readyState.specReady ? "完整规范" : "草稿规范";
        this.portraitMissingMeta.textContent = listItems.length > 0 ? `缺 ${listItems.length} 项` : "已补齐";
        this.portraitConfirmedMeta.textContent = listItems.length === 0 && readyState.portraitReady && readyState.specReady
            ? "已补齐"
            : `已确认 ${checklist.length} 项`;
        const listMarkup = listItems.length > 0
            ? `<ol>${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
            : "<p>当前没有缺失项，可以进入生成阶段。</p>";
        const noteMarkup = statusExplanation
            ? `<div class="insight-note">${escapeHtml(statusExplanation)}</div>`
            : "";
        this.portraitErrors.innerHTML = `<strong>缺失信息</strong>${listMarkup}${noteMarkup}`;
        this.portraitChecklist.innerHTML = checklist.length > 0
            ? checklist.map((item) => `<div class="checklist-item">${escapeHtml(item)}</div>`).join("")
            : '<div class="insight-empty">暂无已确认项。</div>';
        this.portraitNextStep.textContent = nextStep || "下一步：继续补齐表单规范。";
    }
    hasActiveRequest() {
        return Boolean(this.requestFormOpened
            || this.store.state.portraitDocument
            || this.store.state.generatedResult
            || this.store.state.currentRequestId
            || this.waitingForAssistant
            || this.pendingTeacherMessage
            || this.localTeacherNotice
            || this.localAssistantNotice);
    }
    isGenerationInProgress() {
        const requestId = normalizeString(this.store.state.currentRequestId);
        if (!requestId || this.findDisplayGeneratedResult()) {
            return false;
        }
        const snapshot = this.store.state.progressSnapshot;
        return !snapshot || !snapshot.finished;
    }
    shouldShowSpecForm() {
        if (this.isGenerationInProgress()) {
            return false;
        }
        const portrait = this.store.state.portraitDocument;
        if (portrait) {
            return this.canShowSpecFormForPortrait(portrait);
        }
        return Boolean(this.requestFormOpened);
    }
    canShowSpecFormForPortrait(portrait) {
        if (this.isGenerationInProgress()) {
            return false;
        }
        if (!portrait || this.waitingForAssistant || this.isPortraitAwaitingAssistant(portrait)) {
            return false;
        }
        if (this.findDisplayGeneratedResult()) {
            return false;
        }
        const messages = Array.isArray(portrait.messages) ? portrait.messages : [];
        const latestAssistant = [...messages].reverse().find((message) => normalizeString(message.role) === "assistant");
        if (!latestAssistant) {
            return Boolean(portrait.draft);
        }
        const kind = normalizeString(latestAssistant.kind) || "text";
        if (kind === "generated_question") {
            return false;
        }
        return this.requestFormOpened
            || this.portraitNeedsSpecForm(portrait)
            || this.messageRequestsSpecForm(latestAssistant)
            || this.portraitHasGenerationDraft(portrait);
    }
    readDialogueScrollState() {
        const scrollTop = this.portraitChat.scrollTop;
        const scrollHeight = this.portraitChat.scrollHeight;
        const clientHeight = this.portraitChat.clientHeight;
        const distanceToBottom = scrollHeight - scrollTop - clientHeight;
        return {
            scrollTop,
            scrollHeight,
            clientHeight,
            nearBottom: scrollHeight <= clientHeight + 1 || distanceToBottom <= 40,
        };
    }
    restoreDialogueScrollState(state) {
        if (state.nearBottom) {
            this.portraitChat.scrollTop = this.portraitChat.scrollHeight;
            return;
        }
        const maxScrollTop = Math.max(0, this.portraitChat.scrollHeight - this.portraitChat.clientHeight);
        this.portraitChat.scrollTop = Math.min(state.scrollTop, maxScrollTop);
    }
    syncRequestFormOpenedFromPortrait() {
        this.requestFormOpened = this.canShowSpecFormForPortrait(this.store.state.portraitDocument);
    }
    formatDialogueTimestamp(value) {
        if (!value) {
            return "";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }
    formatHistoryRelativeTime(value) {
        const parsed = Date.parse(value);
        if (Number.isNaN(parsed)) {
            return "今天";
        }
        const diffMs = Math.max(0, Date.now() - parsed);
        const dayMs = 24 * 60 * 60 * 1000;
        const days = Math.max(0, Math.floor(diffMs / dayMs));
        if (days <= 0) {
            return "今天";
        }
        if (days < 7) {
            return `${days}天前`;
        }
        const weeks = Math.floor(days / 7);
        if (weeks === 1) {
            return "一周前";
        }
        if (weeks < 5) {
            return `${weeks}周前`;
        }
        const months = Math.floor(days / 30);
        return months <= 1 ? "1个月前" : `${months}个月前`;
    }
    async handleSessionListAction(portraitId, action, currentTitle) {
        if (!portraitId) {
            return;
        }
        if (action === "delete") {
            const confirmed = window.confirm("归档这条对话？归档后不会出现在左侧历史列表，数据库会保留记录。");
            if (!confirmed) {
                return;
            }
            this.store.setBusy(true);
            try {
                await this.store.archivePortrait(portraitId);
                this.hiddenHistoryIds.delete(portraitId);
                this.writeLocalStringArray("hidden_history_ids", [...this.hiddenHistoryIds]);
                this.clearLocalDialogueNotices();
                this.setFeedback(this.portraitFeedback, "已归档，对话仍保留在数据库中。", "ok");
            }
            catch (error) {
                this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "归档失败", "error");
            }
            finally {
                this.store.setBusy(false);
            }
            return;
        }
        if (action === "edit") {
            const nextTitle = window.prompt("编辑历史对话标题", currentTitle)?.trim();
            if (!nextTitle) {
                return;
            }
            this.historyTitleOverrides[portraitId] = nextTitle;
            this.writeLocalStringRecord("history_title_overrides", this.historyTitleOverrides);
            this.renderSessionHistory();
            this.setFeedback(this.portraitFeedback, "历史标题已更新。", "ok");
        }
    }
    renderDialogueMeta(input) {
        const time = this.formatDialogueTimestamp(normalizeString(input.createdAt || new Date().toISOString()));
        const targetAttrs = Number.isInteger(input.messageIndex)
            ? `data-message-index="${escapeHtml(String(input.messageIndex))}"`
            : input.localMessage
                ? `data-local-message="${escapeHtml(input.localMessage)}"`
                : "";
        return `
      <div class="dialogue-meta-row">
        <span class="dialogue-time">${escapeHtml(time)}</span>
        <button class="dialogue-icon-button" type="button" title="复制" aria-label="复制" data-message-action="copy" ${targetAttrs}>
          <span aria-hidden="true">⧉</span>
        </button>
        ${input.editable ? `
          <button class="dialogue-icon-button" type="button" title="编辑" aria-label="编辑" data-message-action="edit" ${targetAttrs}>
            <span aria-hidden="true">✎</span>
          </button>
        ` : ""}
      </div>
    `;
    }
    renderStandardDialogueMarkup(message, messageIndex) {
        const role = normalizeString(message.role) || "assistant";
        const kind = normalizeString(message.kind) || "text";
        const displayText = this.getDialogueDisplayText(message.content);
        const serviceError = this.isDialogueServiceError(displayText, kind);
        const superseded = role === "teacher" && this.isPortraitMessageSuperseded(message);
        const roleLabel = serviceError ? "系统" : role === "teacher" ? "用户" : "EduQG";
        const cls = [
            role === "teacher" ? "dialogue-teacher" : "dialogue-assistant",
            superseded ? "dialogue-superseded" : "",
            serviceError ? "dialogue-error" : "",
        ].filter(Boolean).join(" ");
        const actionMarkup = this.renderDialogueMeta({
            createdAt: normalizeString(message.created_at),
            messageIndex,
            editable: role === "teacher",
        });
        const attachmentMarkup = this.renderDialogueAttachmentStrip(this.readMessageAttachments(message.payload));
        return `
      <div class="dialogue-item ${role === "teacher" ? "dialogue-item-teacher" : "dialogue-item-assistant"}">
        <div class="dialogue-card ${cls}" title="${escapeHtml(this.formatDialogueTimestamp(normalizeString(message.created_at)))}">
          <div class="dialogue-role">${escapeHtml(roleLabel)}</div>
          <div class="dialogue-text">${renderMathText(this.formatWorkbenchCopy(displayText))}</div>
          ${attachmentMarkup}
          ${superseded ? '<div class="dialogue-subnote">已由后续消息接管。</div>' : ""}
        </div>
        ${actionMarkup}
      </div>
    `;
    }
    renderGeneratedQuestionDialogueMarkup(message, messageIndex) {
        const requestId = normalizeString(message.request_id) || normalizeString(this.store.state.currentRequestId);
        const result = this.isGeneratedResultPayload(message.payload) ? message.payload : null;
        if (!result) {
            return this.renderStandardDialogueMarkup(message, messageIndex);
        }
        return `
      <div class="dialogue-item dialogue-item-assistant dialogue-item-result">
        <div class="dialogue-card dialogue-assistant dialogue-generated-question" title="${escapeHtml(this.formatDialogueTimestamp(normalizeString(message.created_at)))}">
          <div class="dialogue-role">EduQG</div>
          <div class="dialogue-text">题目已生成。</div>
        </div>
        ${this.renderGeneratedRequestSnapshot(result)}
        ${this.renderGeneratedQuestionCard(result, requestId)}
        ${this.renderSurveyCard(requestId)}
        ${this.renderDialogueMeta({ createdAt: normalizeString(message.created_at), messageIndex })}
      </div>
    `;
    }
    renderTransientGeneratedQuestionMarkup() {
        const result = this.store.state.generatedResult;
        const requestId = normalizeString(this.store.state.currentRequestId);
        if (!result || !requestId || this.store.hasGeneratedQuestionMessage(requestId)) {
            return "";
        }
        return `
      <div class="dialogue-item dialogue-item-assistant dialogue-item-result">
        <div class="dialogue-card dialogue-assistant dialogue-generated-question" title="${escapeHtml(this.formatDialogueTimestamp(new Date().toISOString()))}">
          <div class="dialogue-role">系统</div>
          <div class="dialogue-text">题目已生成。</div>
        </div>
        ${this.renderGeneratedRequestSnapshot(result)}
        ${this.renderGeneratedQuestionCard(result, requestId)}
        ${this.renderSurveyCard(requestId)}
      </div>
    `;
    }
    renderTransientGenerationProgressMarkup() {
        const requestId = normalizeString(this.store.state.currentRequestId);
        const snapshot = this.store.state.progressSnapshot;
        if (!requestId
            || snapshot?.finished
            || this.store.state.generatedResult
            || this.store.hasGeneratedQuestionMessage(requestId)) {
            return "";
        }
        const lastStage = snapshot ? this.resolveLastProgressStage(snapshot.stages) : null;
        const detail = snapshot && lastStage
            ? `${translateProgressText(lastStage.label || lastStage.key)}：${translateProgressText(lastStage.detail || "处理中")}`
            : snapshot
                ? "服务器已接收请求"
                : "正在等待服务器接收请求";
        const updatedAt = snapshot?.updatedAt || new Date().toISOString();
        return `
      <div class="dialogue-item dialogue-item-assistant">
        <div class="dialogue-thinking-line dialogue-generation-progress" title="${escapeHtml(this.formatDialogueTimestamp(updatedAt))}">
          AI 出题进行中，${escapeHtml(detail)}<span class="thinking-dots">...</span>
        </div>
      </div>
    `;
    }
    renderServerWaitingDialogueMarkup() {
        if (!this.isPortraitAwaitingAssistant()) {
            return "";
        }
        return `
      <div class="dialogue-item dialogue-item-assistant">
        <div class="dialogue-thinking-line" title="${escapeHtml(this.formatDialogueTimestamp(new Date().toISOString()))}">
          EduQG 正在处理这条消息<span class="thinking-dots">...</span>
        </div>
      </div>
    `;
    }
    renderPendingDialogueMarkup() {
        return [
            this.pendingTeacherMessage
                ? `
          <div class="dialogue-item dialogue-item-teacher">
            <div class="dialogue-card dialogue-teacher dialogue-pending" title="${escapeHtml(this.formatDialogueTimestamp(new Date().toISOString()))}">
              <div class="dialogue-role">用户</div>
              <div class="dialogue-text">${renderMathText(this.pendingTeacherMessage)}</div>
              ${this.renderDialogueAttachmentStrip(this.pendingTeacherAttachments)}
            </div>
            ${this.renderDialogueMeta({ editable: true, localMessage: "pending-teacher" })}
          </div>
        `
                : "",
            this.waitingForAssistant
                ? `
          <div class="dialogue-item dialogue-item-assistant">
            <div class="dialogue-thinking-line" title="${escapeHtml(this.formatDialogueTimestamp(new Date().toISOString()))}">
              正在思考中<span class="thinking-dots">...</span>
            </div>
          </div>
        `
                : "",
        ].join("");
    }
    renderLocalTeacherNoticeMarkup() {
        if (!this.localTeacherNotice) {
            return "";
        }
        return `
      <div class="dialogue-item dialogue-item-teacher">
        <div class="dialogue-card dialogue-teacher" title="${escapeHtml(this.formatDialogueTimestamp(new Date().toISOString()))}">
          <div class="dialogue-role">用户</div>
          <div class="dialogue-text">${renderMathText(this.localTeacherNotice)}</div>
        </div>
        ${this.renderDialogueMeta({ editable: true, localMessage: "local-teacher" })}
      </div>
    `;
    }
    getDialogueDisplayText(content) {
        const raw = normalizeString(content);
        if (!raw) {
            return "";
        }
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const jsonText = normalizeString(fenced?.[1] || raw);
        if (!jsonText.startsWith("{") || !jsonText.endsWith("}")) {
            return raw;
        }
        try {
            const parsed = JSON.parse(jsonText);
            const assistantMessage = normalizeString(parsed.assistant_message);
            return assistantMessage || raw;
        }
        catch {
            const match = jsonText.match(/"assistant_message"\s*:\s*"([\s\S]*?)"\s*,[\s\S]*?"extracted_fields"\s*:/);
            return normalizeString(match?.[1]) || raw;
        }
    }
    isGeneratedResultPayload(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            return false;
        }
        const record = value;
        return typeof record.question === "string"
            && Array.isArray(record.options)
            && Array.isArray(record.solution_steps)
            && typeof record.ground_truth === "string";
    }
    renderLocalAssistantNoticeMarkup() {
        if (!this.localAssistantNotice) {
            return "";
        }
        const cls = this.localAssistantNoticeTone === "error" ? "dialogue-error" : "";
        const roleLabel = this.localAssistantNoticeTone === "error" ? "系统" : "EduQG";
        return `
      <div class="dialogue-item dialogue-item-assistant">
        <div class="dialogue-card dialogue-assistant ${cls}" title="${escapeHtml(this.formatDialogueTimestamp(new Date().toISOString()))}">
          <div class="dialogue-role">${roleLabel}</div>
          <div class="dialogue-text">${renderMathText(this.formatWorkbenchCopy(this.localAssistantNotice))}</div>
        </div>
        ${this.renderDialogueMeta({ localMessage: "local-assistant" })}
      </div>
    `;
    }
    renderGeneratedRequestSnapshot(result) {
        const request = result.request || result.meta;
        if (!request) {
            return "";
        }
        const labels = this.store.state.clientConfig;
        const row = (label, value) => value
            ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
            : "";
        const contentMode = normalizeString(request.content_mode);
        const rows = [
            row("知识点 / 出题说明", normalizeString(request.knowledge_point)),
            row("学科", normalizeString(request.subject)),
            row("难度", normalizeString(request.difficulty)),
            row("题型", normalizeString(request.question_type_label) || labels.question_type_labels[normalizeString(request.question_type)] || normalizeString(request.question_type)),
            row("内容模式", normalizeString(request.content_mode_label) || labels.content_mode_labels[contentMode] || contentMode),
            row("算法", normalizeString(request.algorithm_label) || labels.algorithm_labels[normalizeString(request.algorithm)] || normalizeString(request.algorithm)),
            contentMode === "image"
                ? row("图片模式", normalizeString(request.image_mode_label) || labels.image_mode_labels[normalizeString(request.image_mode)] || normalizeString(request.image_mode))
                : "",
            contentMode === "image"
                ? row("图片位置", normalizeString(request.image_placement_label) || labels.image_placement_labels[normalizeString(request.image_placement)] || normalizeString(request.image_placement))
                : "",
        ].filter(Boolean).join("");
        if (!rows) {
            return "";
        }
        return `
      <div class="request-snapshot-card">
        <div class="request-snapshot-head">
          <strong>本次出题要求</strong>
          <span>生成时使用的表单快照</span>
        </div>
        <dl>${rows}</dl>
      </div>
    `;
    }
    renderGeneratedQuestionCard(result, requestId = "", portraitId = "", includeActions = true) {
        const stemImage = resolveStemImageSrc(result);
        const explanationImage = resolveExplanationImageSrc(result);
        const optionImageMap = resolveOptionImageMap(result);
        const optionImages = result.options.map((_, index) => {
            const optionKey = String.fromCharCode(65 + index);
            return optionImageMap.get(optionKey) || "";
        });
        const populatedOptionImages = optionImages.filter(Boolean);
        const uniqueOptionImages = [...new Set(populatedOptionImages)];
        const sharedOptionImage = uniqueOptionImages.length === 1 && populatedOptionImages.length > 1
            ? uniqueOptionImages[0]
            : "";
        const visualItems = [];
        if (stemImage) {
            visualItems.push({ src: stemImage, label: "题图", alt: "题干配图" });
        }
        if (sharedOptionImage) {
            visualItems.push({ src: sharedOptionImage, label: "选项图", alt: "选项配图" });
        }
        else {
            optionImages.forEach((imageSrc, index) => {
                if (!imageSrc) {
                    return;
                }
                const optionKey = String.fromCharCode(65 + index);
                visualItems.push({ src: imageSrc, label: `选项 ${optionKey}`, alt: `选项 ${optionKey} 配图` });
            });
        }
        if (explanationImage) {
            visualItems.push({ src: explanationImage, label: "解析图", alt: "解析配图" });
        }
        const optionMarkup = result.options.length > 0
            ? `<ol class="result-options">${result.options.map((option, index) => {
                const optionKey = String.fromCharCode(65 + index);
                const optionText = stripOptionPrefix(option) || optionKey;
                return `<li>${renderMathText(optionText)}</li>`;
            }).join("")}</ol>`
            : "<div>暂无选项</div>";
        const stepsMarkup = result.solution_steps.length > 0
            ? `<ol class="result-steps">${result.solution_steps.map((step) => `<li>${renderMathText(step)}</li>`).join("")}</ol>`
            : "<div>暂无解析</div>";
        const visualMarkup = visualItems.length > 0
            ? `
        <aside class="result-visual-panel result-visual-panel-count-${Math.min(visualItems.length, 4)}" aria-label="题目图片">
          <div class="result-visual-grid">
            ${visualItems.map((item) => `
              <figure class="result-visual-item">
                <figcaption>${escapeHtml(item.label)}</figcaption>
                <div class="result-visual-frame">
                  <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}">
                </div>
              </figure>
            `).join("")}
          </div>
        </aside>
      `
            : "";
        return `
      <div class="result-card result-question-card${visualItems.length > 0 ? " has-visual" : ""}">
        ${visualMarkup}
        <div class="result-content-panel">
          <section class="result-section">
            <h3>题干</h3>
            <div class="math-block">${renderMathText(result.question)}</div>
          </section>
          <section class="result-section">
            <h3>选项</h3>
            ${optionMarkup}
          </section>
          <section class="result-section">
            <h3>解析</h3>
            ${stepsMarkup}
          </section>
          <section class="result-section result-answer-section">
            <h3>正确答案</h3>
            <div class="result-answer">${renderMathText(result.ground_truth)}</div>
          </section>
          ${includeActions ? `<div class="result-actions">
            <button type="button" class="btn btn-secondary btn-compact" data-result-action="copy" data-request-id="${escapeHtml(requestId)}">复制题目</button>
            <button type="button" class="btn btn-secondary btn-compact" data-result-action="edit" data-request-id="${escapeHtml(requestId)}">编辑</button>
            <button type="button" class="btn btn-secondary btn-compact" data-result-action="export" data-format="word" data-request-id="${escapeHtml(requestId)}" data-portrait-id="${escapeHtml(portraitId)}">导出 Word</button>
            <button type="button" class="btn btn-ghost btn-compact" data-result-action="export" data-format="pdf" data-request-id="${escapeHtml(requestId)}" data-portrait-id="${escapeHtml(portraitId)}">PDF</button>
            <button type="button" class="btn btn-ghost btn-compact" data-result-action="export" data-format="excel" data-request-id="${escapeHtml(requestId)}" data-portrait-id="${escapeHtml(portraitId)}">Excel</button>
          </div>` : ""}
        </div>
      </div>
    `;
    }
    renderLibraryQuestionAccordion(result, requestId = "", includeSurvey = false, portraitId = "") {
        const request = result.request || result.meta || {};
        const labels = this.store.state.clientConfig;
        const subject = normalizeString(request.subject) || this.store.buildPayload().subject || "未确认学科";
        const knowledgePoint = normalizeString(request.knowledge_point) || this.store.buildPayload().knowledge_point || "未确认知识点";
        const typeKey = normalizeString(request.question_type) || this.store.buildPayload().question_type;
        const questionType = normalizeString(request.question_type_label)
            || labels.question_type_labels[typeKey]
            || typeKey
            || "未确认题型";
        const preview = normalizeString(result.question).replace(/\s+/g, " ");
        const summary = [
            `学科：${subject}`,
            `知识点：${knowledgePoint}`,
            `题型：${questionType}`,
        ].join(" · ");
        return `
      <details class="library-question-accordion" data-request-id="${escapeHtml(requestId)}"${includeSurvey ? " open" : ""}>
        <summary title="${escapeHtml(preview || "暂无题干")}">
          <span class="library-question-title">${escapeHtml(summary)}</span>
          <span class="library-question-card-actions" aria-label="题目操作">
            <button type="button" class="btn btn-ghost btn-compact" data-result-action="copy" data-request-id="${escapeHtml(requestId)}">复制</button>
            <button type="button" class="btn btn-secondary btn-compact" data-result-action="edit" data-request-id="${escapeHtml(requestId)}">编辑</button>
            <button type="button" class="btn btn-ghost btn-compact" data-result-action="export" data-format="word" data-request-id="${escapeHtml(requestId)}" data-portrait-id="${escapeHtml(portraitId)}">导出</button>
          </span>
        </summary>
        <div class="library-question-body">
          ${this.renderGeneratedQuestionCard(result, requestId, portraitId, false)}
          ${includeSurvey ? this.renderSurveyCard(requestId) : ""}
        </div>
      </details>
    `;
    }
    renderLibrarySearchPanel(resultCount, statusText = "等待搜索", loading = false) {
        const payload = this.store.buildPayload();
        const labels = this.store.state.clientConfig;
        const valueList = (values, current) => ([...new Set([...values, current].map((item) => normalizeString(item)).filter(Boolean))]);
        const difficultyLabels = Object.fromEntries(["1", "2", "3", "4", "5", "6"].map((item) => [item, item]));
        return `
      <div class="library-search-panel" aria-label="题库搜索">
        <div class="library-search-head">
          <strong>筛选条件</strong>
          <div class="library-search-status">
            <span>${escapeHtml(resultCount > 0 ? `匹配 ${resultCount} 题` : statusText)}</span>
            <button class="btn btn-secondary btn-compact" type="button" data-library-search${loading ? " disabled" : ""}>${loading ? "搜索中" : "搜索"}</button>
          </div>
        </div>
        <div class="library-filter-grid">
          ${this.renderLibraryTextFilter("subject", "学科", payload.subject, "全部学科")}
          ${this.renderLibraryTextFilter("knowledge_point", "知识点", payload.knowledge_point, "全部知识点")}
          ${this.renderLibrarySelectFilter("difficulty", "难度", payload.difficulty, ["1", "2", "3", "4", "5", "6"], difficultyLabels)}
          ${this.renderLibrarySelectFilter("question_type", "题型", payload.question_type, valueList(labels.question_types, payload.question_type), labels.question_type_labels)}
          ${this.renderLibrarySelectFilter("content_mode", "内容模式", payload.content_mode, valueList(labels.content_modes, payload.content_mode), labels.content_mode_labels)}
          ${this.renderLibrarySelectFilter("algorithm", "算法", payload.algorithm, valueList(labels.algorithms, payload.algorithm), labels.algorithm_labels)}
        </div>
      </div>
    `;
    }
    renderLibraryTextFilter(field, label, value, placeholder) {
        return `
      <label class="library-filter-field">
        <span>${escapeHtml(label)}</span>
        <input type="text" data-library-filter="${escapeHtml(field)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
      </label>
    `;
    }
    renderLibrarySelectFilter(field, label, value, values, labels) {
        const options = values.map((optionValue) => {
            const selected = optionValue === value ? " selected" : "";
            return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(labels[optionValue] || optionValue)}</option>`;
        }).join("");
        return `
      <label class="library-filter-field">
        <span>${escapeHtml(label)}</span>
        <select data-library-filter="${escapeHtml(field)}">${options}</select>
      </label>
    `;
    }
    async handleLibrarySearchAction(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-library-search]");
        if (!button || !this.resultView.contains(button)) {
            return;
        }
        event.preventDefault();
        this.syncLibraryFiltersFromControls();
        await this.store.searchQuestionLibrary(this.store.buildPayload());
    }
    syncLibraryFiltersFromControls() {
        const patch = {};
        this.resultView.querySelectorAll("[data-library-filter]").forEach((control) => {
            const field = normalizeString(control.dataset.libraryFilter);
            if (field) {
                patch[field] = normalizeString(control.value);
            }
        });
        if (Object.prototype.hasOwnProperty.call(patch, "subject")) {
            this.store.setSubjectDraft(patch.subject, false);
        }
        if (Object.prototype.hasOwnProperty.call(patch, "knowledge_point")) {
            this.store.setKnowledgePointDraft(patch.knowledge_point, false);
        }
        this.store.updateRequestDraft(Object.fromEntries(["difficulty", "question_type", "content_mode", "algorithm"]
            .filter((field) => Object.prototype.hasOwnProperty.call(patch, field))
            .map((field) => [field, patch[field]])), false);
    }
    handleLibraryFilterKeydown(event) {
        if (event.key !== "Enter") {
            return;
        }
        const target = event.target;
        if (target instanceof HTMLInputElement && normalizeString(target.dataset.libraryFilter)) {
            event.preventDefault();
            this.syncLibraryFiltersFromControls();
            void this.store.searchQuestionLibrary(this.store.buildPayload());
        }
    }
    handleLibraryFilterChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
            return;
        }
        const field = normalizeString(target.dataset.libraryFilter);
        if (!field) {
            return;
        }
        const value = normalizeString(target.value);
        if (field === "subject") {
            this.store.setSubjectDraft(value, false);
            this.store.clearQuestionLibrarySearch();
            return;
        }
        if (field === "knowledge_point") {
            this.store.setKnowledgePointDraft(value, false);
            this.store.clearQuestionLibrarySearch();
            return;
        }
        if (field === "difficulty"
            || field === "question_type"
            || field === "content_mode"
            || field === "algorithm") {
            this.store.updateRequestDraft({ [field]: value }, false);
            this.store.clearQuestionLibrarySearch();
        }
    }
    renderSurveyCard(requestId = "") {
        const normalizedRequestId = normalizeString(requestId);
        if (!normalizedRequestId || this.submittedFeedbackRequestIds.has(normalizedRequestId)) {
            return "";
        }
        return `
      <div class="survey-card" data-survey-request-id="${escapeHtml(normalizedRequestId)}">
        <div class="survey-card-head">
          <strong>这道题是否符合预期？</strong>
          <span>给 EduQG 一个快速反馈</span>
        </div>
        <div class="survey-score-row" aria-label="题目评分">
          ${[1, 2, 3, 4, 5].map((score) => `
            <button type="button" class="survey-score" data-survey-score="${score}" title="${score} 分">${score}</button>
          `).join("")}
        </div>
      </div>
    `;
    }
    renderFormFromDraft() {
        const draft = this.store.state.persisted.requestDraft;
        this.setDraftTextControlValue(this.subjectInput, normalizeString(draft.subject));
        this.setDraftTextControlValue(this.knowledgePointInput, normalizeString(draft.knowledge_point));
        this.setDraftTextControlValue(this.portraitReplyInput, this.store.state.persisted.latestPortraitReplyDraft);
        autoResizeTextarea(this.knowledgePointInput);
        autoResizeTextarea(this.portraitReplyInput);
        this.applyClientConfig();
        this.setSelectValue(this.difficultySelect, normalizeString(draft.difficulty) || "2");
        this.setSelectValue(this.algorithmSelect, normalizeString(draft.algorithm) || "direct");
        this.setSelectValue(this.questionTypeSelect, normalizeString(draft.question_type) || "multiple_choice");
        this.setSelectValue(this.contentModeSelect, normalizeString(draft.content_mode) || "text");
        this.setSelectValue(this.imageModeSelect, normalizeString(draft.image_mode) || "none");
        this.setSelectValue(this.imagePlacementSelect, normalizeString(draft.image_placement));
        this.syncImageControls();
        this.updateSpecFormCopy(Boolean(this.findDisplayGeneratedResult()));
    }
    updateSpecFormCopy(afterGeneratedQuestion) {
        const title = this.chatSpecForm.querySelector(".chat-spec-form-head strong");
        const subtitle = this.chatSpecForm.querySelector(".chat-spec-form-head span");
        if (title) {
            title.textContent = afterGeneratedQuestion ? "调整后再次生成" : "请完成以下表单";
        }
        if (subtitle) {
            subtitle.textContent = afterGeneratedQuestion
                ? "不满意当前题目时，修改下面字段后重新生成；也可以直接在输入框里继续和 EduQG 说明需求。"
                : "请完成以下表单，再校验并生成题目。";
        }
    }
    setDraftTextControlValue(control, value) {
        if (document.activeElement === control || control.value === value) {
            return;
        }
        control.value = value;
    }
    renderRequestSummary() {
        const payload = this.store.buildPayload();
        const labels = this.store.state.clientConfig;
        const specReady = normalizeString(this.store.state.specNormalizeResponse?.spec?.status) === "ready";
        const badges = [
            this.renderBadge("表单规范", "neutral"),
            this.renderBadge(`spec ${specReady ? "ready" : "待校验"}`, specReady ? "ok" : "warn"),
            this.renderBadge(payload.subject || "学科待确认", payload.subject ? "neutral" : "warn"),
            this.renderBadge(labels.algorithm_labels[payload.algorithm] || payload.algorithm, "neutral"),
            this.renderBadge(labels.question_type_labels[payload.question_type] || payload.question_type, "neutral"),
            this.renderBadge(labels.content_mode_labels[payload.content_mode] || payload.content_mode, "neutral"),
        ];
        if (payload.content_mode === "image") {
            badges.push(this.renderBadge(labels.image_placement_labels[payload.image_placement] || payload.image_placement || "待确认", "warn"));
        }
        this.requestBadges.innerHTML = badges.join("");
        this.requestSummary.textContent = [
            `学科：${payload.subject || "待确认"}`,
            `知识点：${payload.knowledge_point || "待确认"}`,
            `难度：${payload.difficulty || "待确认"}`,
            `题型：${labels.question_type_labels[payload.question_type] || payload.question_type || "待确认"}`,
            `内容模式：${labels.content_mode_labels[payload.content_mode] || payload.content_mode || "待确认"}`,
            `算法：${labels.algorithm_labels[payload.algorithm] || payload.algorithm || "待确认"}`,
            payload.content_mode === "image"
                ? `图片位置：${labels.image_placement_labels[payload.image_placement] || payload.image_placement || "待确认"}`
                : "",
        ].filter(Boolean).join("\n");
    }
    renderMaterialLibraryState() {
        const payload = this.store.buildPayload();
        const labels = this.store.state.clientConfig;
        const portrait = this.store.state.portraitDocument;
        const readyState = getPortraitReadyState(portrait);
        const generated = this.findDisplayGeneratedResult();
        const snapshot = this.store.state.progressSnapshot;
        const specStatus = normalizeString(this.store.state.specNormalizeResponse?.spec?.status);
        const questionTypeLabel = labels.question_type_labels[payload.question_type] || payload.question_type || "待确认";
        const contentModeLabel = labels.content_mode_labels[payload.content_mode] || payload.content_mode || "待确认";
        this.setMaterialMeta(this.materialSpecMeta, portrait
            ? readyState.portraitReady && readyState.specReady
                ? "ready"
                : "草稿"
            : "未开始");
        this.setMaterialMeta(this.materialSubjectLabel, `学科：${payload.subject || "未确认"}`);
        this.setMaterialMeta(this.materialSubjectMeta, payload.subject || "待确认");
        this.setMaterialMeta(this.materialKnowledgeLabel, `知识点：${payload.knowledge_point || "未确认"}`);
        this.setMaterialMeta(this.materialKnowledgeMeta, payload.knowledge_point || "待确认");
        this.setMaterialMeta(this.materialTypeLabel, `题型：${questionTypeLabel}`);
        this.setMaterialMeta(this.materialTypeMeta, questionTypeLabel);
        this.setMaterialMeta(this.materialQuestionLabel, generated ? "题目：当前题目" : "题目：等待生成");
        this.setMaterialMeta(this.materialModeMeta, generated ? `${contentModeLabel} · 可预览` : contentModeLabel);
        this.setMaterialMeta(this.materialResultMeta, generated ? "已生成 1 题" : "暂无题目");
        this.setMaterialMeta(this.materialProgressMeta, snapshot
            ? snapshot.error
                ? "失败"
                : snapshot.finished
                    ? "已结束"
                    : "运行中"
            : "未开始");
        this.setMaterialMeta(this.materialJsonMeta, specStatus === "ready" ? "ready" : specStatus || (this.store.state.specNormalizeResponse ? "待补齐" : "未校验"));
        this.updateMaterialPreviewState();
    }
    setMaterialMeta(element, value) {
        const text = normalizeString(value);
        element.textContent = text;
        element.title = text;
    }
    updateMaterialPreviewState() {
        const targetId = normalizeString(this.activeMaterialTarget) || "inspector-section-result";
        const section = document.getElementById(targetId);
        if (!(section instanceof HTMLDetailsElement)) {
            this.activeMaterialTarget = "inspector-section-result";
            this.updateMaterialPreviewState();
            return;
        }
        this.inspectorColumn.querySelectorAll(".material-preview-pane > .inspector-section").forEach((item) => {
            const active = item.id === targetId;
            item.classList.toggle("is-active-preview", active);
            item.open = active;
        });
        const previewPane = this.inspectorColumn.querySelector(".material-preview-pane");
        if (previewPane) {
            previewPane.classList.add("is-open");
            previewPane.setAttribute("aria-hidden", "false");
        }
        this.inspectorColumn.querySelectorAll(".material-root, .material-node, .material-import").forEach((item) => {
            const itemTarget = normalizeString(item.dataset.inspectorTarget);
            const active = itemTarget === targetId && (targetId !== "inspector-section-result" || !item.classList.contains("material-import"));
            item.classList.toggle("active", active);
        });
        const generated = this.findDisplayGeneratedResult();
        const specText = normalizeString(this.portraitMarkdown.textContent);
        const hasSpec = Boolean(specText && specText !== "暂无规范文档。");
        const hasGenerated = Boolean(generated);
        const titleMap = {
            "inspector-section-result": {
                title: "题目预览",
                subtitle: hasGenerated ? "个人题库中的当前题目" : "生成完成后会在这里预览题目本身",
                label: hasGenerated ? "当前题目" : "空题目",
            },
            "inspector-section-spec": {
                title: "试题规范说明",
                subtitle: hasSpec ? "当前题目的规范说明文档" : "规范对话完成后会生成说明文档",
                label: "试题规范说明",
            },
            "inspector-section-progress": {
                title: "执行进度",
                subtitle: "本次生成请求的阶段和日志",
                label: "执行进度",
            },
            "inspector-section-preview": {
                title: "规范 JSON",
                subtitle: "当前规范的结构化数据",
                label: "规范 JSON",
            },
            "inspector-section-runtime": {
                title: "运行调试",
                subtitle: "OAH、模型和工作区诊断",
                label: "运行调试",
            },
            "inspector-section-settings": {
                title: "出题设置",
                subtitle: "当前题目的生成参数",
                label: "出题设置",
            },
            "inspector-section-missing": {
                title: "待补充信息",
                subtitle: "当前规范还缺哪些字段",
                label: "待补充信息",
            },
            "inspector-section-confirmed": {
                title: "已确认字段",
                subtitle: "老师已经确认过的规范字段",
                label: "已确认字段",
            },
        };
        const preview = titleMap[targetId] || titleMap["inspector-section-result"];
        this.materialPreviewTitle.textContent = preview.title;
        this.materialPreviewSubtitle.textContent = preview.subtitle;
        this.materialOpenLabel.textContent = preview.label;
        const canCopy = targetId === "inspector-section-result"
            ? hasGenerated
            : targetId === "inspector-section-spec"
                ? hasSpec
                : Boolean(this.readMaterialPreviewText(targetId));
        const canEdit = targetId === "inspector-section-result" ? hasGenerated : targetId === "inspector-section-spec";
        const canExport = targetId === "inspector-section-result" ? hasGenerated : targetId === "inspector-section-spec" && Boolean(this.store.state.portraitDocument);
        this.materialCopyButton.disabled = !canCopy;
        this.materialEditButton.disabled = !canEdit;
        this.materialExportButton.disabled = !canExport;
        this.syncMaterialTreeExpandedState();
    }
    readMaterialPreviewText(targetId) {
        if (targetId === "inspector-section-spec") {
            return normalizeString(this.portraitMarkdown.textContent);
        }
        if (targetId === "inspector-section-preview") {
            return normalizeString(this.specPreview.textContent);
        }
        if (targetId === "inspector-section-progress") {
            return normalizeString(this.progressLogs.textContent);
        }
        if (targetId === "inspector-section-runtime") {
            return [
                normalizeString(this.runtimeSummary.textContent),
                normalizeString(this.runtimeDiagnosis.textContent),
            ].filter(Boolean).join("\n\n");
        }
        if (targetId === "inspector-section-settings") {
            return normalizeString(this.requestSummary.textContent);
        }
        return "";
    }
    async handleMaterialPreviewAction(action) {
        const targetId = normalizeString(this.activeMaterialTarget) || "inspector-section-result";
        if (targetId === "inspector-section-result") {
            const generated = this.findDisplayGeneratedResult();
            if (!generated) {
                this.setFeedback(this.portraitFeedback, "当前还没有可操作的题目。", "warn");
                return;
            }
            if (action === "copy") {
                await this.copyText(this.buildGeneratedQuestionText(generated.result));
                this.setFeedback(this.portraitFeedback, "题目已复制。", "ok");
                return;
            }
            if (action === "edit") {
                this.prepareGeneratedQuestionEdit(generated.result);
                return;
            }
            await this.exportGeneratedQuestion(generated.requestId, this.readExportFormat());
            return;
        }
        if (targetId === "inspector-section-spec") {
            const specText = normalizeString(this.portraitMarkdown.textContent);
            if (action === "copy") {
                if (!specText || specText === "暂无规范文档。") {
                    this.setFeedback(this.portraitFeedback, "当前还没有可复制的规范说明。", "warn");
                    return;
                }
                await this.copyText(specText);
                this.setFeedback(this.portraitFeedback, "规范说明已复制。", "ok");
                return;
            }
            if (action === "edit") {
                this.prepareSpecEdit();
                return;
            }
            await this.exportCurrentPortrait(this.readExportFormat());
            return;
        }
        const text = this.readMaterialPreviewText(targetId);
        if (action === "copy" && text) {
            await this.copyText(text);
            this.setFeedback(this.portraitFeedback, "当前预览内容已复制。", "ok");
            return;
        }
        this.setFeedback(this.portraitFeedback, "当前材料暂不支持这个操作。", "warn");
    }
    renderSpecState() {
        const spec = this.store.state.specNormalizeResponse;
        this.specPreview.textContent = spec ? JSON.stringify(spec, null, 2) : "暂无规范结果。";
    }
    renderContractState() {
        const envelope = this.store.state.contractEnvelope;
        if (!envelope) {
            this.contractSource.textContent = "source: -";
            this.contractBadges.innerHTML = '<span class="badge">等待加载</span>';
            this.contractPreview.textContent = "暂无 contract 数据。";
            return;
        }
        this.contractSource.textContent = `source: ${normalizeString(envelope.source_path) || "-"}`;
        this.contractBadges.innerHTML = [
            this.renderBadge("已加载", "ok"),
            this.renderBadge("前端可见", "neutral"),
        ].join("");
        this.contractPreview.textContent = JSON.stringify(envelope.contract, null, 2);
    }
    renderProgressState() {
        const snapshot = this.store.state.progressSnapshot;
        const requestId = this.store.state.currentRequestId || "-";
        this.progressRequestId.textContent = `request_uuid: ${requestId}`;
        this.renderGenerationFeedbackFromProgress();
        if (!snapshot) {
            this.progressView.innerHTML = `
        <div class="progress-item" data-state="pending">
          <div class="progress-mark">0</div>
          <div>
            <div class="progress-title">等待请求</div>
            <div class="progress-detail">发起生成后，这里会轮询状态接口并显示各阶段进度。</div>
          </div>
        </div>
      `;
            this.progressLogs.textContent = "暂无日志。";
            return;
        }
        this.progressView.innerHTML = snapshot.stages.length > 0
            ? snapshot.stages.map((stage, index) => buildProgressStageMarkup(stage, index)).join("")
            : `
        <div class="progress-item" data-state="pending">
          <div class="progress-mark">0</div>
          <div>
            <div class="progress-title">等待状态</div>
            <div class="progress-detail">服务端还没有返回阶段状态。</div>
          </div>
        </div>
      `;
        const lastStage = this.resolveLastProgressStage(snapshot.stages);
        const summaryLines = [
            `状态：${snapshot.finished ? "已结束" : "运行中"}`,
            lastStage ? `当前/最后阶段：${translateProgressText(lastStage.label || lastStage.key)} - ${translateProgressText(lastStage.detail || "")}` : "",
            lastStage ? `最后更新时间：${formatPortraitTime(lastStage.updatedAt || snapshot.updatedAt)}` : "",
            snapshot.error ? `错误：${translateProgressText(snapshot.error)}` : "",
        ].filter(Boolean);
        const logLines = snapshot.logs.map((line) => translateProgressText(line));
        this.progressLogs.textContent = [...summaryLines, "", ...logLines].filter((line, index, lines) => (line || (index > 0 && index < lines.length - 1))).join("\n") || "暂无日志。";
    }
    renderGenerationFeedbackFromProgress() {
        const generated = this.findDisplayGeneratedResult();
        if (generated) {
            this.setFeedback(this.generateFeedback, "题目生成完成。", "ok");
            return;
        }
        const requestId = normalizeString(this.store.state.currentRequestId);
        if (!requestId) {
            return;
        }
        const snapshot = this.store.state.progressSnapshot;
        if (snapshot?.finished && snapshot.error) {
            this.setFeedback(this.generateFeedback, translateProgressText(snapshot.error), "error");
            return;
        }
        if (snapshot?.finished) {
            this.setFeedback(this.generateFeedback, "生成流程已结束，正在同步题目结果。", "neutral");
            return;
        }
        const lastStage = snapshot ? this.resolveLastProgressStage(snapshot.stages) : null;
        const detail = lastStage
            ? `，${translateProgressText(lastStage.label || lastStage.key)}：${translateProgressText(lastStage.detail || "处理中")}`
            : "";
        this.setFeedback(this.generateFeedback, `规范状态 ready，正在生成题目${detail}。`, "neutral");
    }
    resolveLastProgressStage(stages) {
        const stagesByPriority = [
            stages.filter((stage) => stage.state === "active" || stage.state === "error"),
            stages.filter((stage) => stage.state === "done"),
            stages,
        ];
        for (const group of stagesByPriority) {
            const latest = group
                .filter((stage) => normalizeString(stage.updatedAt))
                .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
            if (latest) {
                return latest;
            }
        }
        return null;
    }
    renderResultState() {
        const generated = this.findDisplayGeneratedResult();
        const libraryResults = this.store.state.questionLibraryResults;
        const searched = this.store.state.questionLibrarySearched;
        const loading = this.store.state.questionLibraryLoading;
        const error = normalizeString(this.store.state.questionLibraryError);
        const statusText = loading
            ? "正在搜索"
            : error
                ? "搜索失败"
                : searched
                    ? "暂无匹配"
                    : "点击搜索";
        if (!loading && !error && generated && libraryResults.length === 0) {
            this.resultView.innerHTML = `
        ${this.renderLibrarySearchPanel(1, statusText, loading)}
        <div class="library-results-stack">
          ${this.renderLibraryQuestionAccordion(generated.result, generated.requestId, true, normalizeString(this.store.state.portraitDocument?.portrait_id))}
        </div>
      `;
            void this.typesetMath(this.resultView);
            return;
        }
        if (loading || error || libraryResults.length === 0) {
            this.resultView.innerHTML = `
        ${this.renderLibrarySearchPanel(0, statusText, loading)}
        <div class="library-results-stack">
          <div class="result-card library-empty-card">${escapeHtml(loading
                ? "正在搜索题库..."
                : error || (searched ? "暂无匹配题目。" : "设置筛选条件后点击搜索。"))}</div>
        </div>
      `;
            return;
        }
        this.resultView.innerHTML = `
      ${this.renderLibrarySearchPanel(libraryResults.length, statusText, loading)}
      <div class="library-results-stack">
        ${libraryResults.map((item) => this.renderLibraryQuestionAccordion(item.result, item.request_id, Boolean(generated?.requestId && item.request_id === generated.requestId), item.portrait_id)).join("")}
      </div>
    `;
        void this.typesetMath(this.resultView);
    }
    updateActionAvailability() {
        const busy = this.store.state.busy;
        const authenticated = this.isAuthenticated();
        this.authSubmitButton.disabled = busy;
        this.authUidInput.disabled = busy;
        this.authEmailInput.disabled = busy;
        this.authPwdInput.disabled = busy;
        this.authPwdToggle.disabled = busy;
        this.authConfirmPwdInput.disabled = busy;
        this.authConfirmPwdToggle.disabled = busy;
        this.tabLogin.disabled = busy;
        this.tabRegister.disabled = busy;
        this.authSwitchLink.disabled = busy;
        this.portraitStartButton.disabled = !authenticated;
        this.portraitSendButton.disabled = !authenticated || this.sendingPortraitReply;
        this.portraitSyncButton.disabled = !authenticated;
        const generationInProgress = this.isGenerationInProgress();
        this.validateButton.disabled = busy || generationInProgress;
        this.generateButton.disabled = busy || generationInProgress;
        this.refreshRuntimeButton.disabled = !authenticated || busy;
        this.sessionRefreshButton.disabled = !authenticated || busy;
        this.sessionOpenLatestButton.disabled = !authenticated || busy || this.store.state.portraitList.length === 0;
        this.sessionSyncButton.disabled = !authenticated || busy || !this.store.state.portraitDocument;
        this.sessionNewButton.disabled = !authenticated || busy;
        this.exportWordButton.disabled = !authenticated || busy || !this.store.state.portraitDocument;
        this.exportFormatSelect.disabled = !authenticated || busy || !this.store.state.portraitDocument;
        this.exportSpecButton.disabled = !authenticated || busy || !this.store.state.portraitDocument;
        this.exportResultButton.disabled = !authenticated || busy || !this.findDisplayGeneratedResult();
        this.portraitSendButton.disabled = !authenticated || this.sendingPortraitReply;
        this.portraitReplyInput.disabled = !authenticated;
        this.portraitFileInput.disabled = !authenticated;
        this.portraitSyncButton.disabled = !authenticated || busy || !this.store.state.portraitDocument;
        [
            this.subjectInput,
            this.knowledgePointInput,
            this.difficultySelect,
            this.algorithmSelect,
            this.questionTypeSelect,
            this.contentModeSelect,
            this.imageModeSelect,
            this.imagePlacementSelect,
        ].forEach((element) => {
            element.disabled = busy || generationInProgress;
        });
    }
    renderLayoutState() {
        const layout = this.store.state.persisted.layout;
        document.body.classList.toggle("is-sidebar-collapsed", layout.sidebarCollapsed);
        document.body.classList.toggle("is-inspector-collapsed", layout.inspectorCollapsed);
        this.workspaceSidebar.style.width = layout.sidebarCollapsed ? "0px" : `${layout.sidebarWidth}px`;
        this.workspaceSidebar.style.padding = layout.sidebarCollapsed ? "0" : "";
        this.workspaceSidebar.style.opacity = layout.sidebarCollapsed ? "0" : "1";
        this.workspaceSidebar.style.pointerEvents = layout.sidebarCollapsed ? "none" : "auto";
        this.inspectorColumn.style.display = layout.inspectorCollapsed ? "none" : "grid";
        this.inspectorResizeHandle.style.display = layout.inspectorCollapsed ? "none" : "block";
        this.inspectorLauncher.style.display = layout.inspectorCollapsed ? "block" : "none";
        this.inspectorRailButton.style.display = "inline-flex";
        this.chatSurface.style.width = "";
        this.studioGrid.style.setProperty("--chat-panel-width", layout.inspectorCollapsed ? "1fr" : `${layout.chatPanelWidth}fr`);
        this.studioGrid.style.setProperty("--inspector-width", `${Math.min(720, Math.max(420, layout.inspectorWidth))}px`);
        this.toggleSidebarButton.textContent = layout.sidebarCollapsed ? "展开左栏" : "折叠左栏";
        this.toggleInspectorButton.textContent = layout.inspectorCollapsed ? "展开右栏" : "折叠右栏";
    }
    bindResizeHandles() {
        this.sidebarResizeHandle.addEventListener("mousedown", (event) => {
            event.preventDefault();
            const onMove = (moveEvent) => {
                const nextWidth = Math.min(340, Math.max(240, moveEvent.clientX - 18));
                this.store.state.persisted.layout.sidebarWidth = nextWidth;
                this.store.state.persisted.layout.sidebarCollapsed = false;
                this.store.commitLayout();
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
        this.inspectorResizeHandle.addEventListener("mousedown", (event) => {
            event.preventDefault();
            const onMove = (moveEvent) => {
                const gridRect = this.studioGrid.getBoundingClientRect();
                const maxWidth = Math.min(760, Math.max(420, gridRect.width - 460));
                const nextWidth = Math.min(maxWidth, Math.max(420, gridRect.right - moveEvent.clientX));
                this.store.state.persisted.layout.inspectorWidth = nextWidth;
                this.store.state.persisted.layout.inspectorCollapsed = false;
                this.store.commitLayout();
            };
            const onUp = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        });
    }
    bindDialogueScrollbar() {
        const hasOverflow = () => this.portraitChat.scrollHeight > this.portraitChat.clientHeight + 1;
        const reveal = () => {
            if (!hasOverflow()) {
                this.portraitChat.classList.remove("is-scrolling");
                return;
            }
            this.portraitChat.classList.add("is-scrolling");
            if (this.dialogueScrollTimerId !== null) {
                window.clearTimeout(this.dialogueScrollTimerId);
            }
            this.dialogueScrollTimerId = window.setTimeout(() => {
                this.portraitChat.classList.remove("is-scrolling");
                this.dialogueScrollTimerId = null;
            }, 900);
        };
        this.portraitChat.addEventListener("wheel", reveal, { passive: true });
        this.portraitChat.addEventListener("mousemove", (event) => {
            const rect = this.portraitChat.getBoundingClientRect();
            if (rect.right - event.clientX <= 24) {
                reveal();
            }
        }, { passive: true });
        this.portraitChat.addEventListener("mouseleave", () => {
            if (this.dialogueScrollTimerId !== null) {
                window.clearTimeout(this.dialogueScrollTimerId);
                this.dialogueScrollTimerId = null;
            }
            this.portraitChat.classList.remove("is-scrolling");
        });
    }
    bindInspectorScrollbar() {
        const getActiveSection = () => (this.inspectorColumn.querySelector(".material-preview-pane > .inspector-section.is-active-preview"));
        const reveal = () => {
            const section = getActiveSection();
            if (!section || section.scrollHeight <= section.clientHeight + 1) {
                section?.classList.remove("is-scrolling");
                return;
            }
            section.classList.add("is-scrolling");
            if (this.inspectorScrollTimerId !== null) {
                window.clearTimeout(this.inspectorScrollTimerId);
            }
            this.inspectorScrollTimerId = window.setTimeout(() => {
                section.classList.remove("is-scrolling");
                this.inspectorScrollTimerId = null;
            }, 900);
        };
        this.inspectorColumn.addEventListener("wheel", reveal, { passive: true });
        this.inspectorColumn.addEventListener("mouseleave", () => {
            const section = getActiveSection();
            if (this.inspectorScrollTimerId !== null) {
                window.clearTimeout(this.inspectorScrollTimerId);
                this.inspectorScrollTimerId = null;
            }
            section?.classList.remove("is-scrolling");
        });
    }
    toggleSidebar() {
        const layout = this.store.state.persisted.layout;
        layout.sidebarCollapsed = !layout.sidebarCollapsed;
        this.store.commitLayout();
    }
    toggleInspector() {
        const layout = this.store.state.persisted.layout;
        layout.inspectorCollapsed = !layout.inspectorCollapsed;
        if (layout.inspectorCollapsed) {
            this.materialPreviewOpen = false;
        }
        this.store.commitLayout();
    }
    setInspectorCollapsed(collapsed) {
        const layout = this.store.state.persisted.layout;
        layout.inspectorCollapsed = collapsed;
        if (collapsed) {
            this.materialPreviewOpen = false;
        }
        this.store.commitLayout();
    }
    applyClientConfig() {
        const config = this.store.state.clientConfig;
        this.fillSelect(this.algorithmSelect, config.algorithms, config.algorithm_labels);
        this.fillSelect(this.questionTypeSelect, config.question_types, config.question_type_labels);
        this.fillSelect(this.contentModeSelect, config.content_modes, config.content_mode_labels);
        this.fillSelect(this.imageModeSelect, config.image_modes, config.image_mode_labels);
        this.fillSelect(this.imagePlacementSelect, ["", ...config.image_placements], {
            "": "请选择图片位置",
            ...config.image_placement_labels,
        });
    }
    fillSelect(select, values, labels) {
        const currentValue = select.value;
        select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value || "请选择")}</option>`).join("");
        if (values.includes(currentValue)) {
            select.value = currentValue;
        }
    }
    setSelectValue(select, value) {
        const candidate = Array.from(select.options).find((option) => option.value === value);
        select.value = candidate ? value : select.options[0]?.value || "";
    }
    syncFormToDraft() {
        const contentMode = this.contentModeSelect.value;
        const imagePlacement = this.imagePlacementSelect.value;
        this.store.updateRequestDraft({
            subject: this.subjectInput.value.trim(),
            knowledge_point: this.knowledgePointInput.value.trim(),
            difficulty: this.difficultySelect.value,
            algorithm: this.algorithmSelect.value,
            question_type: this.questionTypeSelect.value,
            content_mode: contentMode,
            image_mode: contentMode === "image" ? "required" : "none",
            image_placement: imagePlacement,
            image_targets: IMAGE_TARGET_BY_PLACEMENT[imagePlacement] || [],
        });
        this.syncImageControls();
    }
    syncImageControls() {
        const isImageMode = this.contentModeSelect.value === "image";
        this.imageControls.classList.add("hidden");
        this.imagePlacementField.classList.toggle("hidden", !isImageMode);
        if (!isImageMode) {
            this.imageModeSelect.value = "none";
            this.imagePlacementSelect.value = "";
        }
        else {
            this.imageModeSelect.value = "required";
        }
    }
    setAuthMode(mode) {
        this.authMode = mode;
        this.authError.textContent = "";
        const isLogin = mode === "login";
        this.authPanelTitle.textContent = isLogin ? "登录" : "注册";
        this.authButtonText.textContent = isLogin ? "登 录" : "创建账号";
        this.authSwitchLink.textContent = isLogin ? "立即注册" : "返回登录";
        this.authPwdInput.autocomplete = isLogin ? "current-password" : "new-password";
        this.authEmailField.classList.toggle("is-visible", !isLogin);
        this.authConfirmField.classList.toggle("is-visible", !isLogin);
        this.tabLogin.classList.toggle("active", isLogin);
        this.tabRegister.classList.toggle("active", !isLogin);
        this.setPasswordVisibility(this.authPwdInput, this.authPwdToggle, "密码", false);
        this.setPasswordVisibility(this.authConfirmPwdInput, this.authConfirmPwdToggle, "确认密码", false);
    }
    togglePasswordVisibility(input, button, label) {
        this.setPasswordVisibility(input, button, label, input.type === "password");
        input.focus();
    }
    setPasswordVisibility(input, button, label, visible) {
        input.type = visible ? "text" : "password";
        button.dataset.visible = visible ? "true" : "false";
        button.setAttribute("aria-pressed", visible ? "true" : "false");
        button.setAttribute("aria-label", visible ? `隐藏${label}` : `显示${label}`);
        button.title = visible ? `隐藏${label}` : `显示${label}`;
    }
    async handleAuth() {
        const uid = this.authUidInput.value.trim();
        const email = this.authEmailInput.value.trim();
        const password = this.authPwdInput.value;
        const confirmPassword = this.authConfirmPwdInput.value;
        if (!uid || !password) {
            this.authError.textContent = "请输入用户名和密码。";
            return;
        }
        if (this.authMode === "register" && !email) {
            this.authError.textContent = "请输入邮箱。";
            return;
        }
        if (this.authMode === "register" && !this.isStrongRegisterPassword(password)) {
            this.authError.textContent = "密码至少 8 位，并且需要同时包含大写字母、小写字母、数字和特殊符号。";
            return;
        }
        if (this.authMode === "register" && password !== confirmPassword) {
            this.authError.textContent = "两次输入的密码不一致。";
            return;
        }
        this.store.setBusy(true);
        this.authError.textContent = "";
        try {
            await this.store.authenticate(this.authMode, uid, password, email);
            this.authUidInput.value = "";
            this.authEmailInput.value = "";
            this.authPwdInput.value = "";
            this.authConfirmPwdInput.value = "";
            this.setPasswordVisibility(this.authPwdInput, this.authPwdToggle, "密码", false);
            this.setPasswordVisibility(this.authConfirmPwdInput, this.authConfirmPwdToggle, "确认密码", false);
            this.hideLogin();
            this.setFeedback(this.portraitFeedback, this.authMode === "login" ? "登录成功。" : "注册成功。", "ok");
            this.setFeedback(this.generateFeedback, "工作台已连接。", "ok");
        }
        catch (error) {
            this.authError.textContent = error instanceof Error ? error.message : "认证失败。";
        }
        finally {
            this.store.setBusy(false);
            this.render();
        }
    }
    async handleLogout() {
        this.store.setBusy(true);
        try {
            await this.store.logout();
            this.showLogin();
            this.setFeedback(this.generateFeedback, "已退出登录，请重新登录后继续。", "warn");
        }
        catch (error) {
            this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "退出失败。", "error");
        }
        finally {
            this.store.setBusy(false);
            this.render();
        }
    }
    isStrongRegisterPassword(value) {
        return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
    }
    async refreshWorkbench() {
        if (!this.requireAuthenticated()) {
            return;
        }
        this.store.setBusy(true);
        try {
            await this.store.refreshWorkbenchData();
            await this.store.restorePortrait();
            await this.store.restoreActiveGeneration();
            this.syncRequestFormOpenedFromPortrait();
            this.setFeedback(this.generateFeedback, "工作台配置已刷新。", "ok");
        }
        catch (error) {
            this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "刷新失败", "error");
        }
        finally {
            this.store.setBusy(false);
        }
    }
    async handleOpenPortrait(portraitId) {
        if (!portraitId) {
            return;
        }
        this.clearLocalDialogueNotices();
        this.requestFormOpened = false;
        this.store.setBusy(true);
        try {
            await this.store.loadPortrait(portraitId);
            await this.store.restoreActiveGeneration();
            this.syncRequestFormOpenedFromPortrait();
            this.setFeedback(this.portraitFeedback, "已切换到所选规范历史。", "ok");
        }
        catch (error) {
            this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "加载规范失败", "error");
        }
        finally {
            this.store.setBusy(false);
        }
    }
    async handleRefreshCurrentSession() {
        const portraitId = normalizeString(this.store.state.portraitDocument?.portrait_id);
        if (!portraitId) {
            this.setFeedback(this.portraitFeedback, "当前没有活跃规范。", "warn");
            return;
        }
        await this.handleOpenPortrait(portraitId);
    }
    async handleOpenLatestSession() {
        const latestPortraitId = normalizeString(this.store.state.portraitList[0]?.portrait_id);
        if (!latestPortraitId) {
            this.setFeedback(this.portraitFeedback, "当前没有可打开的规范历史。", "warn");
            return;
        }
        await this.handleOpenPortrait(latestPortraitId);
    }
    validateAttachmentFile(file) {
        const mimeType = normalizeString(file.type).toLowerCase();
        if (!PORTRAIT_ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
            return "只支持 PNG、JPEG、WebP 或 GIF 图片。";
        }
        if (file.size > PORTRAIT_ATTACHMENT_MAX_BYTES) {
            return `单张图片不能超过 ${this.formatBytes(PORTRAIT_ATTACHMENT_MAX_BYTES)}。`;
        }
        return "";
    }
    readAttachmentFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("读取图片失败。"));
            reader.onload = () => {
                const dataUrl = normalizeString(reader.result);
                const mimeType = normalizeString(file.type).toLowerCase();
                if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
                    reject(new Error("图片数据格式不正确。"));
                    return;
                }
                resolve({
                    id: this.createAttachmentId(),
                    name: normalizeString(file.name) || `screenshot-${Date.now()}.png`,
                    mime_type: mimeType,
                    size: file.size,
                    data_url: dataUrl,
                });
            };
            reader.readAsDataURL(file);
        });
    }
    async handleAttachmentPaste(event) {
        const clipboard = event.clipboardData;
        if (!clipboard) {
            return;
        }
        const itemFiles = Array.from(clipboard.items || [])
            .filter((item) => item.kind === "file" && normalizeString(item.type).toLowerCase().startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file) => Boolean(file));
        const files = itemFiles.length > 0
            ? itemFiles
            : Array.from(clipboard.files || []).filter((file) => normalizeString(file.type).toLowerCase().startsWith("image/"));
        if (files.length === 0) {
            return;
        }
        event.preventDefault();
        await this.handleAttachmentFiles(files);
    }
    async handleAttachmentFiles(filesInput) {
        const files = Array.from(filesInput || []);
        if (files.length === 0) {
            return;
        }
        const imageFiles = files.filter((file) => normalizeString(file.type).toLowerCase().startsWith("image/"));
        if (imageFiles.length === 0) {
            this.setFeedback(this.portraitFeedback, "请选择图片文件。", "warn");
            this.portraitFileInput.value = "";
            return;
        }
        const availableSlots = PORTRAIT_ATTACHMENT_MAX_COUNT - this.pendingAttachments.length;
        if (availableSlots <= 0) {
            this.setFeedback(this.portraitFeedback, `一次最多添加 ${PORTRAIT_ATTACHMENT_MAX_COUNT} 张图片。`, "warn");
            this.portraitFileInput.value = "";
            return;
        }
        const acceptedFiles = imageFiles.slice(0, availableSlots);
        const errors = [];
        const attachments = [];
        for (const file of acceptedFiles) {
            const validationError = this.validateAttachmentFile(file);
            if (validationError) {
                errors.push(`${normalizeString(file.name) || "图片"}：${validationError}`);
                continue;
            }
            try {
                attachments.push(await this.readAttachmentFile(file));
            }
            catch (error) {
                errors.push(error instanceof Error ? error.message : "读取图片失败。");
            }
        }
        if (attachments.length > 0) {
            this.pendingAttachments = [...this.pendingAttachments, ...attachments];
            this.renderAttachmentComposer();
            this.setFeedback(this.portraitFeedback, `已添加 ${attachments.length} 张图片。`, "ok");
        }
        if (imageFiles.length > acceptedFiles.length) {
            errors.push(`已忽略 ${imageFiles.length - acceptedFiles.length} 张图片，一次最多 ${PORTRAIT_ATTACHMENT_MAX_COUNT} 张。`);
        }
        if (errors.length > 0) {
            this.setFeedback(this.portraitFeedback, errors[0], "warn");
        }
        this.portraitFileInput.value = "";
    }
    handleAttachmentAction(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const removeButton = target.closest("[data-attachment-remove]");
        if (!removeButton) {
            return;
        }
        const attachmentId = normalizeString(removeButton.dataset.attachmentRemove);
        this.pendingAttachments = this.pendingAttachments.filter((attachment) => attachment.id !== attachmentId);
        this.renderAttachmentComposer();
        this.setFeedback(this.portraitFeedback, "已移除图片。", "neutral");
    }
    handleAttachmentKeydown(event) {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.closest("[data-attachment-remove]")) {
            return;
        }
        event.preventDefault();
        this.handleAttachmentAction(event);
    }
    renderAttachmentComposer() {
        const attachments = this.pendingAttachments;
        this.portraitAttachments.hidden = attachments.length === 0;
        this.portraitAttachments.innerHTML = attachments.map((attachment) => `
      <div class="composer-attachment" data-attachment-id="${escapeHtml(attachment.id)}">
        ${this.renderAttachmentImage(attachment, "composer-attachment-thumb")}
        <div class="composer-attachment-meta">
          <strong>${escapeHtml(attachment.name)}</strong>
          <span>${escapeHtml(attachment.mime_type)} · ${escapeHtml(this.formatBytes(attachment.size))}</span>
        </div>
        <button class="composer-attachment-remove" type="button" aria-label="移除 ${escapeHtml(attachment.name)}" title="移除图片" data-attachment-remove="${escapeHtml(attachment.id)}">&times;</button>
      </div>
    `).join("");
    }
    renderQueuedReply() {
        if (!this.queuedTeacherMessage && this.queuedTeacherAttachments.length === 0) {
            this.queuedPortraitReply.classList.add("hidden");
            this.queuedPortraitReply.innerHTML = "";
            return;
        }
        this.queuedPortraitReply.classList.remove("hidden");
        this.queuedPortraitReply.innerHTML = `
      <div class="queued-reply-copy">
        <strong>待处理消息</strong>
        <span>上一条还在处理中，可以删除，或作为新的引导发送。</span>
        <p>${escapeHtml(this.queuedTeacherMessage || "请参考我上传的图片/截图继续处理。")}</p>
        ${this.renderDialogueAttachmentStrip(this.queuedTeacherAttachments)}
      </div>
      <div class="queued-reply-actions">
        <button class="btn btn-secondary btn-compact" type="button" data-queued-action="send">引导发送</button>
        <button class="btn btn-ghost btn-compact" type="button" data-queued-action="delete">删除</button>
      </div>
    `;
    }
    queuePortraitReply(message, attachments) {
        this.queuedTeacherMessage = message || "请参考我上传的图片/截图继续处理。";
        this.queuedTeacherAttachments = attachments;
        this.pendingAttachments = [];
        this.portraitReplyInput.value = "";
        this.store.setPortraitReplyDraft("");
        autoResizeTextarea(this.portraitReplyInput);
        this.renderAttachmentComposer();
        this.renderQueuedReply();
        this.setFeedback(this.portraitFeedback, "上一条仍在处理中，已先放入待处理区。", "neutral");
    }
    async handleQueuedReplyAction(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const button = target.closest("[data-queued-action]");
        if (!button) {
            return;
        }
        const action = normalizeString(button.dataset.queuedAction);
        if (action === "delete") {
            this.queuedTeacherMessage = "";
            this.queuedTeacherAttachments = [];
            this.renderQueuedReply();
            this.setFeedback(this.portraitFeedback, "已删除待处理消息。", "neutral");
            return;
        }
        if (action !== "send" || this.sendingPortraitReply) {
            return;
        }
        const message = this.queuedTeacherMessage || "请参考我上传的图片/截图继续处理。";
        const attachments = [...this.queuedTeacherAttachments];
        this.queuedTeacherMessage = "";
        this.queuedTeacherAttachments = [];
        this.renderQueuedReply();
        await this.submitPortraitMessage(message, !this.store.state.portraitDocument, attachments, true);
    }
    async handleStartPortrait(initialMessage = "") {
        if (!this.requireAuthenticated()) {
            return;
        }
        const message = initialMessage.trim();
        this.clearLocalDialogueNotices();
        this.endAssistantWait();
        this.requestFormOpened = false;
        const attachments = [...this.pendingAttachments];
        if (!message && attachments.length === 0) {
            this.store.startNewRequestDraft();
            this.setFeedback(this.portraitFeedback, "请输入出题需求，开始后再填写试题规范。", "neutral");
            window.setTimeout(() => this.portraitReplyInput.focus(), 0);
            return;
        }
        await this.submitPortraitMessage(message || "请参考我上传的图片/截图继续处理。", true, attachments);
    }
    async handleSendPortraitReply() {
        if (!this.requireAuthenticated()) {
            return;
        }
        if (this.sendingPortraitReply) {
            return;
        }
        const message = this.portraitReplyInput.value.trim();
        const attachments = [...this.pendingAttachments];
        if (!message && attachments.length === 0) {
            if (!this.hasActiveRequest()) {
                this.setFeedback(this.portraitFeedback, "请先输入出题需求。", "warn");
                return;
            }
            this.setFeedback(this.portraitFeedback, "可以直接填写上方试题规范表单。", "warn");
            return;
        }
        const messageForSend = message || "请参考我上传的图片/截图继续处理。";
        if (this.isPortraitAwaitingAssistant()) {
            this.queuePortraitReply(messageForSend, attachments);
            return;
        }
        await this.submitPortraitMessage(messageForSend, !this.store.state.portraitDocument, attachments);
    }
    async submitPortraitMessage(message, startNew, attachments = [], forceWhileWaiting = false) {
        this.sendingPortraitReply = true;
        if (startNew) {
            this.store.startNewRequestDraft();
        }
        this.clearLocalDialogueNotices();
        if (this.isPortraitAwaitingAssistant() && !forceWhileWaiting) {
            this.queuePortraitReply(message, attachments);
            this.sendingPortraitReply = false;
            return;
        }
        this.beginAssistantWait(message, attachments);
        try {
            const turn = startNew
                ? await this.store.startPortraitDialogue(message, attachments)
                : await this.store.sendPortraitReply(message, attachments);
            this.endAssistantWait();
            this.requestFormOpened = this.turnRequestsSpecForm(turn) || this.portraitNeedsSpecForm(turn.portrait || null);
            this.render();
            this.setFeedback(this.portraitFeedback, "已收到 EduQG 回复。", "ok");
            if (this.shouldGenerateFromPortraitTurn(turn)) {
                await this.handleGenerateFromPortraitTurn();
            }
        }
        catch (error) {
            this.endAssistantWait();
            this.requestFormOpened = false;
            const messageText = error instanceof Error ? error.message : "对话服务请求失败";
            this.localAssistantNotice = messageText;
            this.localAssistantNoticeTone = "error";
            this.setFeedback(this.portraitFeedback, messageText, "error");
            this.renderPortraitState();
        }
        finally {
            this.sendingPortraitReply = false;
        }
    }
    beginAssistantWait(message, attachments = []) {
        this.pendingTeacherMessage = message;
        this.pendingTeacherAttachments = attachments;
        this.pendingAttachments = [];
        this.waitingForAssistant = true;
        this.localTeacherNotice = "";
        this.localAssistantNotice = "";
        this.localAssistantNoticeTone = "neutral";
        this.portraitReplyInput.value = "";
        this.store.setPortraitReplyDraft("");
        autoResizeTextarea(this.portraitReplyInput);
        this.renderAttachmentComposer();
        this.renderPortraitState();
    }
    endAssistantWait(clearTeacherMessage = true) {
        if (clearTeacherMessage) {
            this.pendingTeacherMessage = "";
            this.pendingTeacherAttachments = [];
        }
        this.waitingForAssistant = false;
    }
    clearLocalDialogueNotices() {
        this.localTeacherNotice = "";
        this.localAssistantNotice = "";
        this.localAssistantNoticeTone = "neutral";
    }
    readExportFormat() {
        const value = normalizeString(this.exportFormatSelect.value);
        return value === "pdf" || value === "excel" ? value : "word";
    }
    handleExport(format) {
        void this.exportCurrentPortrait(format);
    }
    handleExportResult(format) {
        const generated = this.findDisplayGeneratedResult();
        if (!generated) {
            this.setFeedback(this.portraitFeedback, "当前没有可导出的题目。", "warn");
            return;
        }
        void this.exportGeneratedQuestion(generated.requestId, format);
    }
    markSurveySubmitted(requestId) {
        const normalizedRequestId = normalizeString(requestId);
        if (!normalizedRequestId) {
            return;
        }
        this.submittedFeedbackRequestIds.add(normalizedRequestId);
        this.writeLocalStringArray("submitted_feedback_request_ids", [...this.submittedFeedbackRequestIds].slice(-500));
    }
    async submitSurveyFeedback(surveyCard, surveyButton, scoreRaw) {
        const score = Number.parseInt(scoreRaw, 10);
        const requestId = normalizeString(surveyCard?.dataset.surveyRequestId) || normalizeString(this.store.state.currentRequestId);
        if (!surveyCard || !requestId || !Number.isInteger(score) || score < 1 || score > 5) {
            this.setFeedback(this.portraitFeedback, "反馈数据不完整，暂时无法记录。", "warn");
            return;
        }
        surveyCard.dataset.saving = "true";
        surveyCard.querySelectorAll("[data-survey-score]").forEach((button) => {
            button.disabled = true;
            button.dataset.active = button === surveyButton ? "true" : "false";
        });
        try {
            await this.store.submitQuestionFeedback(requestId, score, this.findGeneratedResult(requestId));
            this.markSurveySubmitted(requestId);
            surveyCard.remove();
            this.renderResultState();
            this.setFeedback(this.portraitFeedback, `已记录 ${score} 分反馈。`, "ok");
        }
        catch (error) {
            surveyCard.dataset.saving = "false";
            surveyCard.querySelectorAll("[data-survey-score]").forEach((button) => {
                button.disabled = false;
            });
            this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "反馈保存失败", "error");
        }
    }
    async handleDialogueAction(event) {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
            return;
        }
        const surveyButton = target.closest("[data-survey-score]");
        if (surveyButton) {
            const score = normalizeString(surveyButton.dataset.surveyScore);
            const surveyCard = surveyButton.closest(".survey-card");
            await this.submitSurveyFeedback(surveyCard, surveyButton, score);
            return;
        }
        const messageButton = target.closest("[data-message-action]");
        if (messageButton) {
            const action = normalizeString(messageButton.dataset.messageAction);
            const localMessage = normalizeString(messageButton.dataset.localMessage);
            let messageText = "";
            let messageRole = "";
            if (localMessage === "pending-teacher") {
                messageText = this.pendingTeacherMessage;
                messageRole = "teacher";
            }
            else if (localMessage === "local-teacher") {
                messageText = this.localTeacherNotice;
                messageRole = "teacher";
            }
            else if (localMessage === "local-assistant") {
                messageText = this.localAssistantNotice;
                messageRole = "assistant";
            }
            else {
                const index = Number.parseInt(normalizeString(messageButton.dataset.messageIndex), 10);
                const message = this.store.state.portraitDocument?.messages?.[index];
                if (message) {
                    messageText = this.getDialogueDisplayText(message.content);
                    messageRole = normalizeString(message.role);
                }
            }
            if (!messageText) {
                return;
            }
            if (action === "copy") {
                await this.copyText(messageText);
                this.setFeedback(this.portraitFeedback, "已复制。", "ok");
            }
            else if (action === "edit" && messageRole === "teacher") {
                this.portraitReplyInput.value = messageText;
                this.store.setPortraitReplyDraft(this.portraitReplyInput.value);
                if (localMessage === "pending-teacher" && !this.waitingForAssistant) {
                    this.pendingAttachments = [...this.pendingTeacherAttachments];
                    this.pendingTeacherMessage = "";
                    this.pendingTeacherAttachments = [];
                    this.renderAttachmentComposer();
                    this.renderPortraitState();
                }
                autoResizeTextarea(this.portraitReplyInput);
                this.portraitReplyInput.focus();
                this.setFeedback(this.portraitFeedback, "已放入输入框，可编辑后重新发送。", "neutral");
            }
            return;
        }
        const resultButton = target.closest("[data-result-action]");
        if (!resultButton) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const action = normalizeString(resultButton.dataset.resultAction);
        const requestId = normalizeString(resultButton.dataset.requestId) || normalizeString(this.store.state.currentRequestId);
        const result = this.findGeneratedResult(requestId);
        if (!result) {
            this.setFeedback(this.portraitFeedback, "未找到可操作的题目。", "warn");
            return;
        }
        if (action === "copy") {
            await this.copyText(this.buildGeneratedQuestionText(result));
            this.setFeedback(this.portraitFeedback, "题目已复制。", "ok");
            return;
        }
        if (action === "edit") {
            this.prepareGeneratedQuestionEdit(result);
            return;
        }
        if (action === "export") {
            await this.exportGeneratedQuestion(requestId, normalizeString(resultButton.dataset.format), normalizeString(resultButton.dataset.portraitId));
        }
    }
    async copyText(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    }
    findGeneratedResult(requestId) {
        const currentRequestId = normalizeString(this.store.state.currentRequestId);
        if (this.store.state.generatedResult && (!requestId || requestId === currentRequestId)) {
            return this.store.state.generatedResult;
        }
        for (const item of this.store.state.questionLibraryResults) {
            if ((!requestId || normalizeString(item.request_id) === requestId || normalizeString(item.question_id) === requestId)
                && this.isGeneratedResultPayload(item.result)) {
                return item.result;
            }
        }
        const messages = this.store.state.portraitDocument?.messages || [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (normalizeString(message.kind) === "generated_question"
                && (!requestId || normalizeString(message.request_id) === requestId)
                && this.isGeneratedResultPayload(message.payload)) {
                return message.payload;
            }
        }
        return null;
    }
    findDisplayGeneratedResult() {
        const currentRequestId = normalizeString(this.store.state.currentRequestId);
        if (this.store.state.generatedResult) {
            return {
                requestId: currentRequestId,
                result: this.store.state.generatedResult,
            };
        }
        const messages = this.store.state.portraitDocument?.messages || [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (normalizeString(message.kind) !== "generated_question" || !this.isGeneratedResultPayload(message.payload)) {
                continue;
            }
            return {
                requestId: normalizeString(message.request_id),
                result: message.payload,
            };
        }
        return null;
    }
    buildGeneratedQuestionText(result) {
        return [
            "题干",
            result.question,
            "",
            "选项",
            ...(result.options.length > 0
                ? result.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${stripOptionPrefix(option)}`)
                : ["暂无选项"]),
            "",
            "正确答案",
            result.ground_truth,
            "",
            "解析",
            ...(result.solution_steps.length > 0
                ? result.solution_steps.map((step, index) => `${index + 1}. ${step}`)
                : ["暂无解析"]),
        ].join("\n");
    }
    prepareGeneratedQuestionEdit(result) {
        this.portraitReplyInput.value = [
            "请基于右侧当前题目继续调整。",
            "",
            this.buildGeneratedQuestionText(result),
            "",
            "我的修改要求：",
        ].join("\n");
        this.store.setPortraitReplyDraft(this.portraitReplyInput.value);
        autoResizeTextarea(this.portraitReplyInput);
        this.portraitReplyInput.focus();
        this.setFeedback(this.portraitFeedback, "题目已放入对话框，请直接说明要怎么改。", "neutral");
    }
    prepareSpecEdit() {
        this.portraitReplyInput.value = "请基于当前试题规范说明继续调整。\n\n我的修改要求：";
        this.store.setPortraitReplyDraft(this.portraitReplyInput.value);
        autoResizeTextarea(this.portraitReplyInput);
        this.portraitReplyInput.focus();
        this.setFeedback(this.portraitFeedback, "已切到对话框，请说明要怎么调整规范。", "neutral");
    }
    async exportGeneratedQuestion(requestId, formatRaw, portraitId = "") {
        const format = formatRaw === "pdf" || formatRaw === "excel" ? formatRaw : "word";
        try {
            const blob = await this.store.downloadQuestionExport(requestId, format, portraitId);
            const extension = format === "pdf" ? "pdf" : format === "excel" ? "xls" : "doc";
            this.downloadBlob(blob, `${requestId || "question"}.${extension}`);
            this.setFeedback(this.portraitFeedback, `题目已导出 ${format === "excel" ? "Excel" : format.toUpperCase()}。`, "ok");
        }
        catch (error) {
            this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "题目导出失败", "error");
        }
    }
    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }
    async exportCurrentPortrait(format) {
        try {
            const blob = await this.store.downloadPortraitExport(format);
            const portraitId = normalizeString(this.store.state.portraitDocument?.portrait_id) || "portrait";
            const extension = format === "pdf" ? "pdf" : format === "excel" ? "xls" : "doc";
            this.downloadBlob(blob, `${portraitId}.${extension}`);
            this.setFeedback(this.portraitFeedback, `已导出 ${format === "excel" ? "Excel" : format.toUpperCase()}。`, "ok");
        }
        catch (error) {
            this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "导出失败", "error");
        }
    }
    shouldGenerateFromPortraitTurn(turn) {
        const readyState = getPortraitReadyState(this.store.state.portraitDocument);
        return normalizeString(turn.teacher_intent) === "generate_question"
            && readyState.portraitReady
            && readyState.specReady;
    }
    getLatestPortraitGenerationIntentKey() {
        const portrait = this.store.state.portraitDocument;
        const readyState = getPortraitReadyState(portrait);
        if (!portrait || !readyState.portraitReady || !readyState.specReady) {
            return "";
        }
        const messages = Array.isArray(portrait.messages) ? portrait.messages : [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index];
            if (normalizeString(message.role) !== "assistant") {
                continue;
            }
            const kind = normalizeString(message.kind) || "text";
            if (kind === "generated_question" || kind === "error") {
                return "";
            }
            if (!this.isRecord(message.payload) || normalizeString(message.payload.teacher_intent) !== "generate_question") {
                return "";
            }
            return [
                normalizeString(portrait.portrait_id),
                normalizeString(message.created_at),
                normalizeString(message.content),
            ].join("|");
        }
        return "";
    }
    async maybeGenerateFromPortraitIntent() {
        if (this.portraitGenerationIntentInFlight
            || this.sendingPortraitReply
            || this.waitingForAssistant
            || this.store.state.busy
            || this.isPortraitAwaitingAssistant()
            || this.isGenerationInProgress()) {
            return;
        }
        const intentKey = this.getLatestPortraitGenerationIntentKey();
        if (!intentKey || this.handledPortraitGenerationIntentKeys.has(intentKey)) {
            return;
        }
        this.handledPortraitGenerationIntentKeys.add(intentKey);
        this.portraitGenerationIntentInFlight = true;
        try {
            await this.handleGenerateFromPortraitTurn();
        }
        finally {
            this.portraitGenerationIntentInFlight = false;
        }
    }
    shouldSubmitOnEnter(event, compositionActive) {
        return (event.key === "Enter" &&
            !event.shiftKey &&
            !compositionActive &&
            !event.isComposing &&
            event.keyCode !== 229);
    }
    async handleGenerateFromPortraitTurn() {
        if (this.store.state.portraitDocument) {
            this.store.syncPortraitToDraft();
        }
        else {
            this.syncFormToDraft();
        }
        const payload = this.store.buildPayload();
        if (!payload.subject) {
            this.localAssistantNotice = "请先确认学科。";
            this.localAssistantNoticeTone = "error";
            this.setFeedback(this.generateFeedback, "请先确认学科。", "warn");
            this.renderPortraitState();
            return;
        }
        if (!payload.knowledge_point) {
            this.localAssistantNotice = "请先填写知识点。";
            this.localAssistantNoticeTone = "error";
            this.setFeedback(this.generateFeedback, "请先填写知识点。", "warn");
            this.renderPortraitState();
            return;
        }
        this.setFeedback(this.generateFeedback, "正在生成题目。", "neutral");
        this.requestFormOpened = false;
        try {
            await this.store.generateQuestion();
            this.localAssistantNotice = "";
            this.setFeedback(this.generateFeedback, "题目生成完成。", "ok");
            this.setFeedback(this.portraitFeedback, "已根据当前表单生成题目。", "ok");
        }
        catch (error) {
            const messageText = error instanceof Error ? error.message : "题目生成失败";
            this.localAssistantNotice = messageText;
            this.localAssistantNoticeTone = "error";
            this.setFeedback(this.generateFeedback, messageText, "error");
            this.setFeedback(this.portraitFeedback, messageText, "error");
        }
        this.renderPortraitState();
    }
    handleSyncPortrait() {
        if (!this.store.state.portraitDocument) {
            this.setFeedback(this.portraitFeedback, "当前没有可同步的规范。", "warn");
            return;
        }
        this.store.syncPortraitToDraft();
        this.setFeedback(this.portraitFeedback, "规范已同步到参数区。", "ok");
    }
    async handleValidate() {
        if (!this.requireAuthenticated()) {
            return;
        }
        this.syncFormToDraft();
        this.store.setBusy(true);
        this.setFeedback(this.generateFeedback, "正在提交并校验规范。", "neutral");
        try {
            const response = await this.store.validateSpec();
            this.setFeedback(this.generateFeedback, this.isSpecNormalizeReady(response) ? "规范已提交，状态 ready。" : this.formatSpecBlockedMessage(response), this.isSpecNormalizeReady(response) ? "ok" : "warn");
        }
        catch (error) {
            this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "规范提交失败", "error");
        }
        finally {
            this.store.setBusy(false);
        }
    }
    async handleGenerate() {
        if (!this.requireAuthenticated()) {
            return;
        }
        this.syncFormToDraft();
        this.store.setBusy(true);
        this.setFeedback(this.generateFeedback, "正在提交并校验规范。", "neutral");
        try {
            const response = await this.store.validateSpec();
            if (!this.isSpecNormalizeReady(response)) {
                this.setFeedback(this.generateFeedback, this.formatSpecBlockedMessage(response), "warn");
                return;
            }
            this.setFeedback(this.generateFeedback, "规范状态 ready，正在生成题目。", "neutral");
            this.requestFormOpened = false;
            await this.store.generateQuestion();
            this.setFeedback(this.generateFeedback, "题目生成完成。", "ok");
        }
        catch (error) {
            this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "题目生成失败", "error");
        }
        finally {
            this.store.setBusy(false);
        }
    }
    showLogin() {
        this.loginMask.classList.add("is-visible");
        this.loginMask.setAttribute("aria-hidden", "false");
        window.setTimeout(() => this.authUidInput.focus(), 0);
    }
    hideLogin() {
        this.loginMask.classList.remove("is-visible");
        this.loginMask.setAttribute("aria-hidden", "true");
    }
    isAuthenticated() {
        return Boolean(this.store.state.sessionToken && this.store.state.currentUser);
    }
    requireAuthenticated() {
        if (this.isAuthenticated()) {
            return true;
        }
        this.showLogin();
        this.setFeedback(this.generateFeedback, "请先登录或注册。", "warn");
        return false;
    }
    renderBadge(text, tone) {
        const cls = tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "error" ? "error" : "";
        return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
    }
    setFeedback(element, message, tone) {
        element.textContent = message;
        if (tone === "neutral") {
            element.removeAttribute("data-tone");
            return;
        }
        element.dataset.tone = tone;
    }
    async typesetMath(container) {
        try {
            const typesetPromise = window.MathJax?.typesetPromise;
            if (typeof typesetPromise !== "function") {
                return;
            }
            await typesetPromise([container]);
        }
        catch {
            return;
        }
    }
}
window.addEventListener("DOMContentLoaded", () => {
    const app = new QuestionAgentWorkbenchApp();
    void app.init();
});
