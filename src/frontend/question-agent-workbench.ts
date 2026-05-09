import type {
  FeedbackTone,
  GeneratedResult,
  PortraitDocumentEnvelope,
  PortraitListItem,
} from "./question-agent-workbench-types";
import { IMAGE_TARGET_BY_PLACEMENT } from "./question-agent-workbench-types.js";
import { WorkbenchSessionStore } from "./question-agent-workbench-state.js";
import {
  autoResizeTextarea,
  buildProgressStageMarkup,
  escapeHtml,
  formatPortraitTime,
  getPortraitReadyState,
  normalizeString,
  readPortraitChecklist,
  readPortraitMissingItems,
  readPortraitNextStep,
  readPortraitStatusExplanation,
  renderMathText,
  renderValidationMessages,
  renderPendingFieldLabel,
  requireElement,
  resolveExplanationImageSrc,
  resolveOptionImageMap,
  resolveStemImageSrc,
  translateProgressText,
} from "./question-agent-workbench-utils.js";

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (elements?: Element[]) => Promise<void>;
    };
  }
}

class QuestionAgentWorkbenchApp {
  private readonly store = new WorkbenchSessionStore();

  private readonly userName = requireElement<HTMLDivElement>("user-name");

  private readonly runtimeBadges = requireElement<HTMLDivElement>("runtime-badges");
  private readonly runtimeSummary = requireElement<HTMLDivElement>("runtime-summary");
  private readonly refreshRuntimeButton = requireElement<HTMLButtonElement>("refresh-runtime-button");
  private readonly runtimeDiagnosis = requireElement<HTMLPreElement>("runtime-diagnosis");

  private readonly portraitStartButton = requireElement<HTMLButtonElement>("portrait-start-button");
  private readonly portraitSyncButton = requireElement<HTMLButtonElement>("portrait-sync-button");
  private readonly portraitSendButton = requireElement<HTMLButtonElement>("portrait-send-button");
  private readonly portraitReplyInput = requireElement<HTMLTextAreaElement>("portrait-reply");
  private readonly portraitChat = requireElement<HTMLDivElement>("portrait-chat");
  private readonly portraitBadges = requireElement<HTMLDivElement>("portrait-badges");
  private readonly portraitSource = requireElement<HTMLDivElement>("portrait-source");
  private readonly portraitFeedback = requireElement<HTMLSpanElement>("portrait-feedback");
  private readonly portraitErrors = requireElement<HTMLDivElement>("portrait-errors");
  private readonly portraitChecklist = requireElement<HTMLDivElement>("portrait-checklist");
  private readonly portraitNextStep = requireElement<HTMLDivElement>("portrait-next-step");
  private readonly portraitMarkdown = requireElement<HTMLPreElement>("portrait-markdown");

  private readonly sessionHistory = requireElement<HTMLDivElement>("session-history");
  private readonly sessionHistoryEmpty = requireElement<HTMLDivElement>("session-history-empty");
  private readonly sessionSearchInput = requireElement<HTMLInputElement>("session-search");
  private readonly sessionStripTitle = requireElement<HTMLDivElement>("session-strip-title");
  private readonly sessionStripMeta = requireElement<HTMLDivElement>("session-strip-meta");
  private readonly sessionRefreshButton = requireElement<HTMLButtonElement>("session-refresh-button");
  private readonly sessionOpenLatestButton = requireElement<HTMLButtonElement>("session-open-latest-button");
  private readonly sessionSyncButton = requireElement<HTMLButtonElement>("session-sync-button");
  private readonly sessionNewButton = requireElement<HTMLButtonElement>("session-new-button");

  private readonly knowledgePointInput = requireElement<HTMLTextAreaElement>("knowledge-point");
  private readonly generateFeedback = requireElement<HTMLSpanElement>("generate-feedback");
  private readonly validateButton = requireElement<HTMLButtonElement>("validate-button");
  private readonly generateButton = requireElement<HTMLButtonElement>("generate-button");

  private readonly difficultySelect = requireElement<HTMLSelectElement>("difficulty");
  private readonly algorithmSelect = requireElement<HTMLSelectElement>("algorithm");
  private readonly questionTypeSelect = requireElement<HTMLSelectElement>("question-type");
  private readonly contentModeSelect = requireElement<HTMLSelectElement>("content-mode");
  private readonly imageModeSelect = requireElement<HTMLSelectElement>("image-mode");
  private readonly imagePlacementSelect = requireElement<HTMLSelectElement>("image-placement");
  private readonly imageControls = requireElement<HTMLDivElement>("image-controls");
  private readonly requestBadges = requireElement<HTMLDivElement>("request-badges");
  private readonly requestSummary = requireElement<HTMLDivElement>("request-summary");

  private readonly specPreview = requireElement<HTMLPreElement>("spec-preview");
  private readonly contractSource = requireElement<HTMLDivElement>("contract-source");
  private readonly contractBadges = requireElement<HTMLDivElement>("contract-badges");
  private readonly contractPreview = requireElement<HTMLPreElement>("contract-preview");

  private readonly progressRequestId = requireElement<HTMLDivElement>("progress-request-id");
  private readonly progressView = requireElement<HTMLDivElement>("progress-view");
  private readonly progressLogs = requireElement<HTMLPreElement>("progress-logs");
  private readonly resultView = requireElement<HTMLDivElement>("result-view");

  private readonly workspaceSidebar = requireElement<HTMLElement>("workspace-sidebar");
  private readonly sidebarResizeHandle = requireElement<HTMLElement>("sidebar-resize-handle");
  private readonly studioGrid = requireElement<HTMLElement>("studio-grid");
  private readonly chatSurface = requireElement<HTMLElement>("chat-surface");
  private readonly inspectorColumn = requireElement<HTMLElement>("inspector-column");
  private readonly inspectorResizeHandle = requireElement<HTMLElement>("inspector-resize-handle");
  private readonly toggleSidebarButton = requireElement<HTMLButtonElement>("toggle-sidebar-button");
  private readonly toggleInspectorButton = requireElement<HTMLButtonElement>("toggle-inspector-button");

  private sessionSearchQuery = "";
  private portraitReplyCompositionActive = false;
  private sendingPortraitReply = false;
  private localTeacherNotice = "";
  private pendingTeacherMessage = "";
  private waitingForAssistant = false;
  private localAssistantNotice = "";
  private localAssistantNoticeTone: "neutral" | "error" = "neutral";

  async init(): Promise<void> {
    this.bindEvents();
    this.hydrateFromQuery();
    this.store.subscribe(() => this.render());
    await this.store.restoreSession();
    this.setFeedback(this.generateFeedback, "工作台已连接。", "ok");
    this.render();
  }

  private bindEvents(): void {
    this.refreshRuntimeButton.addEventListener("click", () => void this.refreshWorkbench());
    this.sessionRefreshButton.addEventListener("click", () => void this.handleRefreshCurrentSession());
    this.sessionOpenLatestButton.addEventListener("click", () => void this.handleOpenLatestSession());
    this.sessionSyncButton.addEventListener("click", () => this.handleSyncPortrait());
    this.sessionNewButton.addEventListener("click", () => void this.handleStartPortrait());
    this.toggleSidebarButton.addEventListener("click", () => this.toggleSidebar());
    this.toggleInspectorButton.addEventListener("click", () => this.toggleInspector());
    this.bindResizeHandles();

    this.sessionSearchInput.addEventListener("input", () => {
      this.sessionSearchQuery = normalizeString(this.sessionSearchInput.value).toLowerCase();
      this.renderSessionHistory();
    });

    this.knowledgePointInput.addEventListener("input", () => {
      this.store.setKnowledgePointDraft(this.knowledgePointInput.value);
      autoResizeTextarea(this.knowledgePointInput);
    });
    this.portraitReplyInput.addEventListener("input", () => {
      this.store.setPortraitReplyDraft(this.portraitReplyInput.value);
      autoResizeTextarea(this.portraitReplyInput);
    });
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
    this.portraitSyncButton.addEventListener("click", () => this.handleSyncPortrait());
    this.validateButton.addEventListener("click", () => void this.handleValidate());
    this.generateButton.addEventListener("click", () => void this.handleGenerate());

    this.difficultySelect.addEventListener("change", () => this.syncFormToDraft());
    this.algorithmSelect.addEventListener("change", () => this.syncFormToDraft());
    this.questionTypeSelect.addEventListener("change", () => this.syncFormToDraft());
    this.contentModeSelect.addEventListener("change", () => this.syncFormToDraft());
    this.imageModeSelect.addEventListener("change", () => this.syncFormToDraft());
    this.imagePlacementSelect.addEventListener("change", () => this.syncFormToDraft());

    document.querySelectorAll<HTMLElement>("[data-workbench-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const dataset = button.dataset;
        this.knowledgePointInput.value = dataset.knowledgePoint || "";
        autoResizeTextarea(this.knowledgePointInput);
        this.store.setKnowledgePointDraft(this.knowledgePointInput.value);
        this.store.updateRequestDraft({
          knowledge_point: dataset.knowledgePoint || "",
          algorithm: dataset.algorithm || "direct",
          question_type: dataset.questionType || "multiple_choice",
          content_mode: dataset.contentMode || "text",
          image_mode: dataset.imageMode || "none",
          image_placement: dataset.imagePlacement || "",
        });
        this.renderFormFromDraft();
        this.setFeedback(this.generateFeedback, "已套用预设。", "ok");
      });
    });
  }

  private hydrateFromQuery(): void {
    const query = new URLSearchParams(window.location.search);
    const knowledgePoint = normalizeString(query.get("knowledge_point"));
    if (knowledgePoint) {
      this.store.setKnowledgePointDraft(knowledgePoint);
    }
    const algorithm = normalizeString(query.get("algorithm"));
    const questionType = normalizeString(query.get("question_type"));
    const contentMode = normalizeString(query.get("content_mode"));
    const imageMode = normalizeString(query.get("image_mode"));
    const imagePlacement = normalizeString(query.get("image_placement"));
    if (algorithm || questionType || contentMode || imageMode || imagePlacement) {
      this.store.updateRequestDraft({
        algorithm,
        question_type: questionType,
        content_mode: contentMode,
        image_mode: imageMode,
        image_placement: imagePlacement,
      });
    }
  }

  private render(): void {
    this.renderAuthState();
    this.renderRuntimeState();
    this.renderSessionHistory();
    this.renderPortraitState();
    this.renderFormFromDraft();
    this.renderRequestSummary();
    this.renderSpecState();
    this.renderContractState();
    this.renderProgressState();
    this.renderResultState();
    this.renderSessionStrip();
    this.renderLayoutState();
    this.updateActionAvailability();
  }

  private renderAuthState(): void {
    const state = this.store.state;
    this.userName.textContent = state.currentUser || "自动会话";
  }

  private renderRuntimeState(): void {
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
    const workspaceName = normalizeString((workspace as Record<string, unknown>).name) || "unknown";
    const workspaceRuntime = normalizeString((workspace as Record<string, unknown>).runtime) || "unknown";

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

    const diagnosis = status.diagnosis && typeof status.diagnosis === "object"
      ? status.diagnosis as Record<string, unknown>
      : {};
    this.runtimeDiagnosis.textContent = JSON.stringify({
      configured_model_ref: diagnosis.configured_model_ref || null,
      configured_model_url: diagnosis.configured_model_url || null,
      fallback_enabled: true,
      uses_workspace_default_model: diagnosis.uses_workspace_default_model ?? null,
      available_models: diagnosis.available_models || [],
      health: status.health || null,
    }, null, 2);
  }

  private renderSessionStrip(): void {
    const portrait = this.store.state.portraitDocument;
    const readyState = getPortraitReadyState(portrait);
    if (!portrait) {
      this.sessionStripTitle.textContent = "当前画像：未开始";
      this.sessionStripMeta.textContent = "还没有活跃画像会话。";
      return;
    }

    const pendingField = renderPendingFieldLabel(normalizeString(portrait.pending_field));
    this.sessionStripTitle.textContent = `当前画像：${normalizeString(portrait.title) || "未命名画像"}`;
    this.sessionStripMeta.textContent = [
      `id=${normalizeString(portrait.portrait_id) || "-"}`,
      `status=${normalizeString(portrait.status) || "draft"}`,
      `待确认=${pendingField}`,
      `spec=${readyState.specReady ? "ready" : "blocked"}`,
      `updated=${formatPortraitTime(normalizeString(portrait.updated_at))}`,
    ].join(" | ");
  }

  private renderSessionHistory(): void {
    const items = this.store.state.portraitList.filter((item) => {
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
      ? "没有匹配当前搜索条件的画像会话。"
      : "当前还没有画像会话。";

    for (const item of items) {
      this.sessionHistory.appendChild(this.createSessionHistoryNode(item));
    }
  }

  private createSessionHistoryNode(item: PortraitListItem): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-item";
    button.dataset.active = normalizeString(this.store.state.portraitDocument?.portrait_id) === normalizeString(item.portrait_id)
      ? "true"
      : "false";
    button.innerHTML = `
      <div class="session-item-head">
        <strong>${escapeHtml(normalizeString(item.title) || "未命名画像")}</strong>
        <span>${escapeHtml(formatPortraitTime(normalizeString(item.updated_at)))}</span>
      </div>
      <div class="session-item-meta">
        <span class="session-item-status">${escapeHtml(normalizeString(item.status) || "draft")}</span>
        <span>${escapeHtml(renderPendingFieldLabel(normalizeString(item.pending_field)))}</span>
      </div>
      <div class="session-item-summary">${escapeHtml(normalizeString(item.summary) || "暂无摘要")}</div>
    `;
    button.addEventListener("click", () => void this.handleOpenPortrait(normalizeString(item.portrait_id)));
    return button;
  }

  private renderPortraitState(): void {
    const portrait = this.store.state.portraitDocument;
    const messages = Array.isArray(portrait?.messages) ? portrait.messages || [] : [];
    const hasVisibleConversation = Boolean(portrait) || this.waitingForAssistant || Boolean(this.pendingTeacherMessage);
    document.body.classList.toggle("has-portrait", hasVisibleConversation);
    this.portraitReplyInput.placeholder = hasVisibleConversation
      ? "继续补充老师要求，例如：难度先定 3，题型用简答题，暂时不要图片。"
      : "输入出题需求，按 Enter 开始对话。";
    if (!portrait) {
      this.portraitSource.textContent = "portrait: -";
      this.portraitBadges.innerHTML = '<span class="badge">等待开始</span>';
      this.portraitChat.innerHTML = this.renderPendingDialogueMarkup();
      this.portraitChat.scrollTop = this.portraitChat.scrollHeight;
      this.portraitMarkdown.textContent = "暂无画像文档。";
      this.renderPortraitGuidance(null);
      return;
    }

    this.portraitSource.textContent = `portrait: ${normalizeString(portrait.portrait_id)}${portrait.markdown_path ? ` | ${normalizeString(portrait.markdown_path)}` : ""}`;
    this.portraitBadges.innerHTML = [
      this.renderBadge(normalizeString(portrait.status) || "draft", normalizeString(portrait.status) === "ready" ? "ok" : "warn"),
      this.renderBadge(renderPendingFieldLabel(normalizeString(portrait.pending_field)), "neutral"),
    ].join("");

    const messageMarkup = messages.map((message) => {
      const role = normalizeString(message.role) || "assistant";
      const cls = role === "teacher" ? "dialogue-teacher" : "dialogue-assistant";
      return `
        <div class="dialogue-card ${cls}">
          <div class="dialogue-role">${escapeHtml(role)}</div>
          <div class="dialogue-text">${renderMathText(this.getDialogueDisplayText(message.content))}</div>
        </div>
      `;
    }).join("");
    this.portraitChat.innerHTML = `${messageMarkup}${this.renderLocalTeacherNoticeMarkup()}${this.renderGeneratedDialogueMarkup()}${this.renderLocalAssistantNoticeMarkup()}${this.renderPendingDialogueMarkup()}` || `
      <div class="dialogue-card dialogue-assistant">
        <div class="dialogue-role">assistant</div>
        <div class="dialogue-text">画像会话已创建，等待主智能体回复。</div>
      </div>
    `;
    this.portraitChat.scrollTop = this.portraitChat.scrollHeight;

    this.portraitMarkdown.textContent = normalizeString(portrait.markdown) || "暂无画像文档。";
    this.renderPortraitGuidance(portrait);
    void this.typesetMath(this.portraitChat);
  }

  private renderPortraitGuidance(portrait: PortraitDocumentEnvelope | null): void {
    const missingItems = readPortraitMissingItems(portrait);
    const checklist = readPortraitChecklist(portrait);
    const statusExplanation = readPortraitStatusExplanation(portrait);
    const nextStep = readPortraitNextStep(portrait);
    const validationErrors = renderValidationMessages(Array.isArray(portrait?.validation_errors) ? portrait.validation_errors || [] : []);

    if (!portrait) {
      this.portraitErrors.innerHTML = "<strong>缺失信息</strong><p>还没有启动画像对话。</p>";
      this.portraitChecklist.innerHTML = '<div class="insight-empty">暂无已确认项。</div>';
      this.portraitNextStep.textContent = "下一步：等待主智能体开始追问。";
      return;
    }

    const listItems = [...missingItems, ...validationErrors];
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

    this.portraitNextStep.textContent = nextStep || "下一步：继续和主智能体对话。";
  }

  private renderPendingDialogueMarkup(): string {
    return [
      this.pendingTeacherMessage
        ? `
          <div class="dialogue-card dialogue-teacher dialogue-pending">
            <div class="dialogue-role">teacher</div>
            <div class="dialogue-text">${renderMathText(this.pendingTeacherMessage)}</div>
          </div>
        `
        : "",
      this.waitingForAssistant
        ? `
          <div class="dialogue-card dialogue-assistant dialogue-thinking">
            <div class="dialogue-role">assistant</div>
            <div class="dialogue-text">AI 正在思考中<span class="thinking-dots">...</span></div>
          </div>
        `
        : "",
    ].join("");
  }

  private renderLocalTeacherNoticeMarkup(): string {
    if (!this.localTeacherNotice) {
      return "";
    }
    return `
      <div class="dialogue-card dialogue-teacher">
        <div class="dialogue-role">teacher</div>
        <div class="dialogue-text">${renderMathText(this.localTeacherNotice)}</div>
      </div>
    `;
  }

  private getDialogueDisplayText(content: unknown): string {
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
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const assistantMessage = normalizeString(parsed.assistant_message);
      return assistantMessage || raw;
    } catch {
      const match = jsonText.match(/"assistant_message"\s*:\s*"([\s\S]*?)"\s*,\s*"extracted_fields"\s*:/);
      return normalizeString(match?.[1]) || raw;
    }
  }

  private renderGeneratedDialogueMarkup(): string {
    const result = this.store.state.generatedResult;
    if (!result) {
      return "";
    }
    return `
      <div class="dialogue-card dialogue-assistant dialogue-result">
        <div class="dialogue-role">assistant</div>
        <div class="dialogue-text">${this.renderGeneratedQuestionCard(result)}</div>
      </div>
    `;
  }

  private renderLocalAssistantNoticeMarkup(): string {
    if (!this.localAssistantNotice) {
      return "";
    }
    const cls = this.localAssistantNoticeTone === "error" ? "dialogue-error" : "";
    return `
      <div class="dialogue-card dialogue-assistant ${cls}">
        <div class="dialogue-role">assistant</div>
        <div class="dialogue-text">${renderMathText(this.localAssistantNotice)}</div>
      </div>
    `;
  }

  private renderGeneratedQuestionCard(result: GeneratedResult): string {
    const stemImage = resolveStemImageSrc(result);
    const explanationImage = resolveExplanationImageSrc(result);
    const optionImageMap = resolveOptionImageMap(result);
    const optionMarkup = result.options.length > 0
      ? `<ol class="result-options">${result.options.map((option, index) => {
        const optionKey = String.fromCharCode(65 + index);
        const imageSrc = optionImageMap.get(optionKey);
        return `<li>${renderMathText(option)}${imageSrc ? `<div class="option-image"><img src="${escapeHtml(imageSrc)}" alt="option-${optionKey}"></div>` : ""}</li>`;
      }).join("")}</ol>`
      : "<div>暂无选项</div>";
    const stepsMarkup = result.solution_steps.length > 0
      ? `<ol class="result-steps">${result.solution_steps.map((step) => `<li>${renderMathText(step)}</li>`).join("")}</ol>`
      : "<div>暂无解析</div>";
    const assetsMarkup = [stemImage, explanationImage, ...optionImageMap.values()].some(Boolean)
      ? `
        <div class="asset-grid">
          ${stemImage ? `<div class="asset-card"><strong>题干配图</strong><img src="${escapeHtml(stemImage)}" alt="stem-image"></div>` : ""}
          ${explanationImage ? `<div class="asset-card"><strong>解析配图</strong><img src="${escapeHtml(explanationImage)}" alt="solution-image"></div>` : ""}
        </div>
      `
      : "";
    return `
      <div class="result-card">
        <h3>题干</h3>
        <div class="math-block">${renderMathText(result.question)}</div>
      </div>
      <div class="result-card">
        <h3>选项</h3>
        ${optionMarkup}
      </div>
      <div class="result-card">
        <h3>解析</h3>
        ${stepsMarkup}
      </div>
      <div class="result-card">
        <h3>正确答案</h3>
        <div>${renderMathText(result.ground_truth)}</div>
      </div>
      ${assetsMarkup}
    `;
  }

  private renderFormFromDraft(): void {
    const draft = this.store.state.persisted.requestDraft;
    this.knowledgePointInput.value = normalizeString(draft.knowledge_point);
    this.portraitReplyInput.value = this.store.state.persisted.latestPortraitReplyDraft;
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
  }

  private renderRequestSummary(): void {
    const payload = this.store.buildPayload();
    const labels = this.store.state.clientConfig;
    const readyState = getPortraitReadyState(this.store.state.portraitDocument);

    const badges = [
      this.renderBadge(`画像 ${readyState.portraitReady ? "ready" : "draft"}`, readyState.portraitReady ? "ok" : "warn"),
      this.renderBadge(`spec ${readyState.specReady ? "ready" : "blocked"}`, readyState.specReady ? "ok" : "warn"),
      this.renderBadge(labels.algorithm_labels[payload.algorithm] || payload.algorithm, "neutral"),
      this.renderBadge(labels.question_type_labels[payload.question_type] || payload.question_type, "neutral"),
      this.renderBadge(labels.content_mode_labels[payload.content_mode] || payload.content_mode, "neutral"),
    ];
    if (payload.content_mode === "image") {
      badges.push(this.renderBadge(labels.image_placement_labels[payload.image_placement] || payload.image_placement || "待确认", "warn"));
    }
    this.requestBadges.innerHTML = badges.join("");

    this.requestSummary.textContent = [
      `知识点：${payload.knowledge_point || "待确认"}`,
      `难度：${payload.difficulty || "待确认"}`,
      `题型：${labels.question_type_labels[payload.question_type] || payload.question_type || "待确认"}`,
      `内容模式：${labels.content_mode_labels[payload.content_mode] || payload.content_mode || "待确认"}`,
      `算法：${labels.algorithm_labels[payload.algorithm] || payload.algorithm || "待确认"}`,
      payload.content_mode === "image"
        ? `图片设置：${labels.image_mode_labels[payload.image_mode] || payload.image_mode} / ${labels.image_placement_labels[payload.image_placement] || payload.image_placement || "待确认"}`
        : "",
    ].filter(Boolean).join("\n");
  }

  private renderSpecState(): void {
    const spec = this.store.state.specNormalizeResponse;
    this.specPreview.textContent = spec ? JSON.stringify(spec, null, 2) : "暂无规范结果。";
  }

  private renderContractState(): void {
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

  private renderProgressState(): void {
    const snapshot = this.store.state.progressSnapshot;
    const requestId = this.store.state.currentRequestId || "-";
    this.progressRequestId.textContent = `request_uuid: ${requestId}`;
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
    this.progressLogs.textContent = snapshot.logs.length > 0
      ? snapshot.logs.map((line) => translateProgressText(line)).join("\n")
      : "暂无日志。";
  }

  private renderResultState(): void {
    const result = this.store.state.generatedResult;
    if (!result) {
      this.resultView.innerHTML = '<div class="result-card">暂无结果。生成成功后，这里会显示题干、选项、解析和图片资产。</div>';
      return;
    }
    this.resultView.innerHTML = this.renderGeneratedQuestionCard(result);
    void this.typesetMath(this.resultView);
  }

  private updateActionAvailability(): void {
    const busy = this.store.state.busy;
    const authenticated = this.isAuthenticated();
    const availability = this.store.getGenerateAvailability();
    this.portraitStartButton.disabled = !authenticated || busy;
    this.portraitSendButton.disabled = !authenticated || busy;
    this.portraitSyncButton.disabled = !authenticated || busy;
    this.validateButton.disabled = !authenticated || busy;
    this.generateButton.disabled = !availability.canGenerate;
    this.refreshRuntimeButton.disabled = !authenticated || busy;
    this.sessionRefreshButton.disabled = !authenticated || busy;
    this.sessionOpenLatestButton.disabled = !authenticated || busy || this.store.state.portraitList.length === 0;
    this.sessionSyncButton.disabled = !authenticated || busy || !this.store.state.portraitDocument;
    this.sessionNewButton.disabled = !authenticated || busy;
    this.portraitSendButton.disabled = !authenticated || busy;
    this.portraitReplyInput.disabled = !authenticated || busy;
    this.portraitSyncButton.disabled = !authenticated || busy || !this.store.state.portraitDocument;

    [
      this.knowledgePointInput,
      this.portraitReplyInput,
      this.difficultySelect,
      this.algorithmSelect,
      this.questionTypeSelect,
      this.contentModeSelect,
      this.imageModeSelect,
      this.imagePlacementSelect,
    ].forEach((element) => {
      element.disabled = busy;
    });
  }

  private renderLayoutState(): void {
    const layout = this.store.state.persisted.layout;
    this.workspaceSidebar.style.width = layout.sidebarCollapsed ? "0px" : `${layout.sidebarWidth}px`;
    this.workspaceSidebar.style.padding = layout.sidebarCollapsed ? "0" : "";
    this.workspaceSidebar.style.opacity = layout.sidebarCollapsed ? "0" : "1";
    this.workspaceSidebar.style.pointerEvents = layout.sidebarCollapsed ? "none" : "auto";

    this.inspectorColumn.style.display = layout.inspectorCollapsed ? "none" : "grid";
    this.inspectorResizeHandle.style.display = layout.inspectorCollapsed ? "none" : "block";
    this.chatSurface.style.width = "";
    this.studioGrid.style.setProperty("--chat-panel-width", layout.inspectorCollapsed ? "1fr" : `${layout.chatPanelWidth}fr`);

    this.toggleSidebarButton.textContent = layout.sidebarCollapsed ? "展开左栏" : "折叠左栏";
    this.toggleInspectorButton.textContent = layout.inspectorCollapsed ? "展开右栏" : "折叠右栏";
  }

  private bindResizeHandles(): void {
    this.sidebarResizeHandle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const onMove = (moveEvent: MouseEvent): void => {
        const nextWidth = Math.min(340, Math.max(240, moveEvent.clientX - 18));
        this.store.state.persisted.layout.sidebarWidth = nextWidth;
        this.store.state.persisted.layout.sidebarCollapsed = false;
        this.store.commitLayout();
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    this.inspectorResizeHandle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const gridRect = this.studioGrid.getBoundingClientRect();
      const onMove = (moveEvent: MouseEvent): void => {
        const relative = (moveEvent.clientX - gridRect.left) / gridRect.width;
        const nextRatio = Math.min(1.8, Math.max(1.25, relative * 2));
        this.store.state.persisted.layout.chatPanelWidth = nextRatio;
        this.store.state.persisted.layout.inspectorCollapsed = false;
        this.store.commitLayout();
      };
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  private toggleSidebar(): void {
    const layout = this.store.state.persisted.layout;
    layout.sidebarCollapsed = !layout.sidebarCollapsed;
    this.store.commitLayout();
  }

  private toggleInspector(): void {
    const layout = this.store.state.persisted.layout;
    layout.inspectorCollapsed = !layout.inspectorCollapsed;
    this.store.commitLayout();
  }

  private applyClientConfig(): void {
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

  private fillSelect(select: HTMLSelectElement, values: string[], labels: Record<string, string>): void {
    const currentValue = select.value;
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value || "请选择")}</option>`).join("");
    if (values.includes(currentValue)) {
      select.value = currentValue;
    }
  }

  private setSelectValue(select: HTMLSelectElement, value: string): void {
    const candidate = Array.from(select.options).find((option) => option.value === value);
    select.value = candidate ? value : select.options[0]?.value || "";
  }

  private syncFormToDraft(): void {
    const contentMode = this.contentModeSelect.value;
    const imagePlacement = this.imagePlacementSelect.value;
    this.store.updateRequestDraft({
      knowledge_point: this.knowledgePointInput.value.trim(),
      difficulty: this.difficultySelect.value,
      algorithm: this.algorithmSelect.value,
      question_type: this.questionTypeSelect.value,
      content_mode: contentMode,
      image_mode: this.imageModeSelect.value,
      image_placement: imagePlacement,
      image_targets: IMAGE_TARGET_BY_PLACEMENT[imagePlacement] || [],
    });
    this.syncImageControls();
  }

  private syncImageControls(): void {
    const isImageMode = this.contentModeSelect.value === "image";
    this.imageControls.classList.toggle("hidden", !isImageMode);
    if (!isImageMode) {
      this.imageModeSelect.value = "none";
      this.imagePlacementSelect.value = "";
    }
  }

  private async handleAuth(): Promise<void> {}

  private async handleLogout(): Promise<void> {}

  private async refreshWorkbench(): Promise<void> {
    if (!this.isAuthenticated()) {
      this.showLogin();
      this.setFeedback(this.generateFeedback, "请先登录。", "warn");
      return;
    }
    this.store.setBusy(true);
    try {
      await this.store.refreshWorkbenchData();
      await this.store.restorePortrait();
      this.setFeedback(this.generateFeedback, "工作台配置已刷新。", "ok");
    } catch (error) {
      this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "刷新失败", "error");
    } finally {
      this.store.setBusy(false);
    }
  }

  private async handleOpenPortrait(portraitId: string): Promise<void> {
    if (!portraitId) {
      return;
    }
    this.clearLocalDialogueNotices();
    this.store.setBusy(true);
    try {
      await this.store.loadPortrait(portraitId);
      this.setFeedback(this.portraitFeedback, "已切换到所选画像会话。", "ok");
    } catch (error) {
      this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "加载画像失败", "error");
    } finally {
      this.store.setBusy(false);
    }
  }

  private async handleRefreshCurrentSession(): Promise<void> {
    const portraitId = normalizeString(this.store.state.portraitDocument?.portrait_id);
    if (!portraitId) {
      this.setFeedback(this.portraitFeedback, "当前没有活跃画像会话。", "warn");
      return;
    }
    await this.handleOpenPortrait(portraitId);
  }

  private async handleOpenLatestSession(): Promise<void> {
    const latestPortraitId = normalizeString(this.store.state.portraitList[0]?.portrait_id);
    if (!latestPortraitId) {
      this.setFeedback(this.portraitFeedback, "当前没有可打开的画像历史。", "warn");
      return;
    }
    await this.handleOpenPortrait(latestPortraitId);
  }

  private async handleStartPortrait(initialMessage = ""): Promise<void> {
    if (!this.isAuthenticated()) {
      this.showLogin();
      this.setFeedback(this.portraitFeedback, "请先登录，再开始画像对话。", "warn");
      return;
    }
    const message = initialMessage.trim();
    if (!message) {
      this.endAssistantWait();
      this.clearLocalDialogueNotices();
      this.store.startNewPortraitDraft();
      this.setFeedback(this.portraitFeedback, "已新建空白对话，请输入需求后按 Enter。", "neutral");
      window.setTimeout(() => this.portraitReplyInput.focus(), 0);
      return;
    }
    this.beginAssistantWait(message);
    this.store.setBusy(true);
    this.setFeedback(this.portraitFeedback, "正在创建画像文档。", "neutral");
    try {
      await this.store.startPortraitDialogue(message);
      this.setFeedback(this.portraitFeedback, "画像会话已开始。", "ok");
    } catch (error) {
      this.setFeedback(this.portraitFeedback, error instanceof Error ? error.message : "画像启动失败", "error");
    } finally {
      this.endAssistantWait();
      this.store.setBusy(false);
    }
  }

  private async handleSendPortraitReply(): Promise<void> {
    if (!this.isAuthenticated()) {
      this.showLogin();
      this.setFeedback(this.portraitFeedback, "请先登录，再发送回复。", "warn");
      return;
    }
    if (this.sendingPortraitReply || this.store.state.busy) {
      return;
    }
    const message = this.portraitReplyInput.value.trim();
    if (!message) {
      this.setFeedback(this.portraitFeedback, "请输入老师回复。", "warn");
      return;
    }
    this.sendingPortraitReply = true;
    try {
      if (!this.store.state.portraitDocument) {
        await this.handleStartPortrait(message);
        return;
      }
      this.beginAssistantWait(message);
      if (this.shouldGenerateFromTeacherMessage(message)) {
        await this.handleGenerateFromChat();
        return;
      }
      this.localTeacherNotice = "";
      this.store.setBusy(true);
      this.setFeedback(this.portraitFeedback, "正在更新画像文档。", "neutral");
      try {
        await this.store.sendPortraitReply(message);
        const portraitReady = normalizeString(this.store.state.portraitDocument?.status) === "ready";
        this.setFeedback(this.portraitFeedback, portraitReady ? "画像已补齐，可以开始出题。" : "画像已更新。", "ok");
      } catch (error) {
        const messageText = error instanceof Error ? error.message : "画像更新失败";
        this.localAssistantNotice = messageText;
        this.localAssistantNoticeTone = "error";
        this.setFeedback(this.portraitFeedback, messageText, "error");
      } finally {
        this.endAssistantWait();
        this.store.setBusy(false);
      }
    } finally {
      this.sendingPortraitReply = false;
    }
  }

  private beginAssistantWait(message: string): void {
    this.pendingTeacherMessage = message;
    this.waitingForAssistant = true;
    this.localTeacherNotice = "";
    this.localAssistantNotice = "";
    this.localAssistantNoticeTone = "neutral";
    this.portraitReplyInput.value = "";
    this.store.setPortraitReplyDraft("");
    autoResizeTextarea(this.portraitReplyInput);
    this.renderPortraitState();
  }

  private endAssistantWait(clearTeacherMessage = true): void {
    if (clearTeacherMessage) {
      this.pendingTeacherMessage = "";
    }
    this.waitingForAssistant = false;
  }

  private clearLocalDialogueNotices(): void {
    this.localTeacherNotice = "";
    this.localAssistantNotice = "";
    this.localAssistantNoticeTone = "neutral";
  }

  private shouldGenerateFromTeacherMessage(message: string): boolean {
    const text = normalizeString(message).replace(/\s+/g, "");
    if (!text) {
      return false;
    }
    const readyState = getPortraitReadyState(this.store.state.portraitDocument);
    if (!readyState.portraitReady || !readyState.specReady) {
      return false;
    }
    return /^(出呀|出题|出题呀|生成|开始生成|快生成|可以生成|马上生成|开始出题|生成吧|出吧|来题|开始吧)[。！!？?呀啊]*$/.test(text);
  }

  private shouldSubmitOnEnter(event: KeyboardEvent, compositionActive: boolean): boolean {
    return (
      event.key === "Enter" &&
      !event.shiftKey &&
      !compositionActive &&
      !event.isComposing &&
      event.keyCode !== 229
    );
  }

  private async handleGenerateFromChat(): Promise<void> {
    const teacherMessage = this.pendingTeacherMessage;
    if (this.store.state.portraitDocument) {
      this.store.syncPortraitToDraft();
    } else {
      this.syncFormToDraft();
    }
    const payload = this.store.buildPayload();
    if (!payload.knowledge_point) {
      this.localTeacherNotice = teacherMessage;
      this.localAssistantNotice = "请先填写知识点。";
      this.localAssistantNoticeTone = "error";
      this.setFeedback(this.generateFeedback, "请先填写知识点。", "warn");
      this.endAssistantWait();
      this.renderPortraitState();
      return;
    }
    this.store.setBusy(true);
    this.setFeedback(this.generateFeedback, "正在生成题目。", "neutral");
    try {
      await this.store.generateQuestion();
      this.localAssistantNotice = "";
      this.setFeedback(this.generateFeedback, "题目生成完成。", "ok");
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "题目生成失败";
      this.localAssistantNotice = messageText;
      this.localAssistantNoticeTone = "error";
      this.setFeedback(this.generateFeedback, messageText, "error");
    } finally {
      this.localTeacherNotice = teacherMessage;
      this.endAssistantWait();
      this.store.setBusy(false);
      this.renderPortraitState();
    }
  }

  private handleSyncPortrait(): void {
    if (!this.store.state.portraitDocument) {
      this.setFeedback(this.portraitFeedback, "当前没有可同步的画像。", "warn");
      return;
    }
    this.store.syncPortraitToDraft();
    this.setFeedback(this.portraitFeedback, "画像已同步到参数区。", "ok");
  }

  private async handleValidate(): Promise<void> {
    if (!this.isAuthenticated()) {
      this.showLogin();
      this.setFeedback(this.generateFeedback, "请先登录，再校验规范。", "warn");
      return;
    }
    this.syncFormToDraft();
    const payload = this.store.buildPayload();
    if (!payload.knowledge_point) {
      this.setFeedback(this.generateFeedback, "请先填写知识点。", "warn");
      return;
    }
    this.store.setBusy(true);
    this.setFeedback(this.generateFeedback, "正在校验规范。", "neutral");
    try {
      await this.store.validateSpec();
      this.setFeedback(this.generateFeedback, "规范校验完成。", "ok");
    } catch (error) {
      this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "规范校验失败", "error");
    } finally {
      this.store.setBusy(false);
    }
  }

  private async handleGenerate(): Promise<void> {
    if (!this.isAuthenticated()) {
      this.showLogin();
      this.setFeedback(this.generateFeedback, "请先登录，再开始生成。", "warn");
      return;
    }
    this.syncFormToDraft();
    const payload = this.store.buildPayload();
    if (!payload.knowledge_point) {
      this.setFeedback(this.generateFeedback, "请先填写知识点。", "warn");
      return;
    }

    const readyState = getPortraitReadyState(this.store.state.portraitDocument);
    const nextStep = readPortraitNextStep(this.store.state.portraitDocument);
    if (!readyState.portraitReady) {
      this.setFeedback(this.generateFeedback, nextStep || "画像还未完成，请先继续和主智能体对话。", "warn");
      return;
    }
    if (!readyState.specReady) {
      this.setFeedback(this.generateFeedback, "画像已就绪，但规范校验还没有通过，请先处理规范提示。", "warn");
      return;
    }

    this.store.setBusy(true);
    this.setFeedback(this.generateFeedback, "正在生成题目。", "neutral");
    try {
      await this.store.generateQuestion();
      this.setFeedback(this.generateFeedback, "题目生成完成。", "ok");
    } catch (error) {
      this.setFeedback(this.generateFeedback, error instanceof Error ? error.message : "题目生成失败", "error");
    } finally {
      this.store.setBusy(false);
    }
  }

  private showLogin(): void {}

  private hideLogin(): void {}

  private isAuthenticated(): boolean {
    return Boolean(this.store.state.sessionToken);
  }

  private renderBadge(text: string, tone: "neutral" | "ok" | "warn" | "error"): string {
    const cls = tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "error" ? "error" : "";
    return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
  }

  private setFeedback(element: HTMLElement, message: string, tone: FeedbackTone): void {
    element.textContent = message;
    if (tone === "neutral") {
      element.removeAttribute("data-tone");
      return;
    }
    element.dataset.tone = tone;
  }

  private async typesetMath(container: Element): Promise<void> {
    try {
      const typesetPromise = window.MathJax?.typesetPromise;
      if (typeof typesetPromise !== "function") {
        return;
      }
      await typesetPromise([container]);
    } catch {
      return;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const app = new QuestionAgentWorkbenchApp();
  void app.init();
});

export {};
