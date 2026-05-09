import type {
  GeneratedResult,
  PortraitDocumentEnvelope,
  PortraitListItem,
  ProgressStage,
  ProgressState,
  SpecNormalizeResponse,
} from "./question-agent-workbench-types.js";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.payload = payload;
  }
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`missing element #${id}`);
  }
  return element as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMathText(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

export function sanitizeImageSrc(value: unknown): string | null {
  const src = normalizeString(value);
  if (!src) {
    return null;
  }
  if (src.startsWith("data:image/") || src.startsWith("/") || src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(src) && src.length > 128) {
    return `data:image/png;base64,${src.replace(/\s+/g, "")}`;
  }
  return null;
}

export function readStructuredImageSrc(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }
  return sanitizeImageSrc(value.url);
}

export function resolveStemImageSrc(result: GeneratedResult): string | null {
  return sanitizeImageSrc(result.stem_image)
    || sanitizeImageSrc(result.assets?.stem_image)
    || readStructuredImageSrc(result.content?.stem?.image);
}

export function resolveExplanationImageSrc(result: GeneratedResult): string | null {
  return sanitizeImageSrc(result.explanation_image)
    || sanitizeImageSrc(result.assets?.explanation_image)
    || readStructuredImageSrc(result.content?.solution?.image);
}

export function resolveOptionImageMap(result: GeneratedResult): Map<string, string> {
  const resolved = new Map<string, string>();

  const appendFromRecord = (value: unknown): void => {
    if (!isRecord(value)) {
      return;
    }
    for (const [optionKey, optionValue] of Object.entries(value)) {
      const imageSrc = sanitizeImageSrc(optionValue);
      if (imageSrc) {
        resolved.set(optionKey, imageSrc);
      }
    }
  };

  appendFromRecord(result.option_images);
  appendFromRecord(result.assets?.option_images);

  if (Array.isArray(result.content?.options)) {
    for (const option of result.content.options) {
      const optionKey = normalizeString(option?.key);
      const imageSrc = readStructuredImageSrc(option?.image);
      if (optionKey && imageSrc && !resolved.has(optionKey)) {
        resolved.set(optionKey, imageSrc);
      }
    }
  }

  return resolved;
}

export function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function autoResizeTextarea(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.max(textarea.scrollHeight, 84)}px`;
}

const PROGRESS_TEXT_MAP: Record<string, string> = {
  "Request Received": "请求已接收",
  "Generate Draft": "生成草稿",
  "Evaluate Draft": "评估草稿",
  "Assemble Response": "组装响应",
  "Server accepted the generation request.": "服务器已接收本次生成请求。",
  "Waiting for the generator to produce a draft.": "等待生成智能体产出草稿。",
  "Waiting for schema and quality evaluation.": "等待结构与质量评估。",
  "Waiting for final response assembly.": "等待最终响应组装。",
  "Request entered the AI question-generation pipeline.": "请求已进入 AI 出题流程。",
  "Server accepted the AI question-generation request.": "服务器已接收 AI 出题请求。",
  "Teacher specification is not confirmed.": "教师规范尚未确认。",
  "Teacher confirmation is required before generation.": "开始生成前必须先完成教师确认。",
  "Request payload validation failed.": "请求参数校验失败。",
  "Draft generation completed.": "草稿生成已完成。",
  "Evaluation and revision completed.": "评估与修订已完成。",
  "Final response assembly completed.": "最终响应组装已完成。",
  "AI question-generation pipeline completed.": "AI 出题流程已完成。",
  "AI question-generation service is currently unreachable.": "AI 出题服务当前不可达。",
  "AI question-generation worker is currently unavailable.": "AI 出题执行 Worker 当前不可用。",
  "AI question generation failed": "AI 出题失败",
  "portrait not ready": "规范尚未准备完成。",
};

export function translateProgressText(value: string): string {
  const text = normalizeString(value);
  if (!text) {
    return "";
  }

  if (PROGRESS_TEXT_MAP[text]) {
    return PROGRESS_TEXT_MAP[text];
  }

  let translated = text;
  translated = translated.replace(/^request_uuid:/i, "request_uuid:");
  translated = translated.replace(/^Specification confirmed\. Calling generator agent (.+)\.$/, "规范已确认，正在调用生成智能体 $1。");
  translated = translated.replace(/^Calling evaluator agent (.+)\.$/, "正在调用评估智能体 $1。");
  translated = translated.replace(/^Calling generator stage ([\w-]+)\.$/, "正在调用生成阶段 $1。");
  translated = translated.replace(/^Calling revision stage ([\w-]+)\.$/, "正在调用修订阶段 $1。");
  translated = translated.replace(/^Pipeline failed: (.+)$/s, "流程执行失败：$1");
  translated = translated.replace(/^Image render failed: (.+)$/s, "图片渲染失败：$1");
  translated = translated.replace(/Failed after (\d+) attempts\./gi, "重试 $1 次后仍失败。");
  translated = translated.replace(/Last error:/gi, "最后一次错误：");
  translated = translated.replace(/Cannot connect to API:/gi, "无法连接到 API：");
  translated = translated.replace(/getaddrinfo ENOTFOUND/gi, "域名解析失败（ENOTFOUND）");
  translated = translated.replace(/\bmessage is required\b/gi, "消息内容不能为空");
  return translated;
}

export function formatPortraitTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value || "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

export function normalizePortraitList(items: PortraitListItem[] | undefined): PortraitListItem[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.filter((item) => normalizeString(item?.portrait_id));
}

export function getPortraitReadyState(portrait: PortraitDocumentEnvelope | null): {
  portraitReady: boolean;
  specReady: boolean;
} {
  const portraitReady = normalizeString(portrait?.status) === "ready";
  const specReady = isRecord(portrait?.spec)
    ? normalizeString(portrait?.spec?.status) === "ready"
    : false;
  return { portraitReady, specReady };
}

export function readSpecResponseFromError(error: unknown): SpecNormalizeResponse | null {
  if (!(error instanceof ApiRequestError) || !isRecord(error.payload)) {
    return null;
  }
  if (!isRecord(error.payload.spec) || !isRecord(error.payload.plan)) {
    return null;
  }
  return {
    spec: error.payload.spec,
    plan: error.payload.plan,
  };
}

export function buildProgressStageMarkup(stage: ProgressStage, index: number): string {
  return `
    <div class="progress-item" data-state="${escapeHtml(stage.state)}">
      <div class="progress-mark">${index + 1}</div>
      <div>
        <div class="progress-title">${escapeHtml(translateProgressText(stage.label || stage.key))}</div>
        <div class="progress-detail">${escapeHtml(translateProgressText(stage.detail || ""))}</div>
      </div>
    </div>
  `;
}

export function renderValidationMessages(errors: string[]): string[] {
  return errors.map((item) => translateProgressText(item)).filter(Boolean);
}

export function readPortraitChecklist(portrait: PortraitDocumentEnvelope | null): string[] {
  if (!portrait || !isRecord(portrait.guidance)) {
    return [];
  }
  return normalizeStringArray(portrait.guidance.teacher_checklist);
}

export function readPortraitMissingItems(portrait: PortraitDocumentEnvelope | null): string[] {
  if (!portrait || !isRecord(portrait.guidance)) {
    return [];
  }
  return normalizeStringArray(portrait.guidance.missing_items);
}

export function readPortraitNextStep(portrait: PortraitDocumentEnvelope | null): string {
  if (!portrait || !isRecord(portrait.guidance)) {
    return "";
  }
  return normalizeString(portrait.guidance.next_step);
}

export function readPortraitStatusExplanation(portrait: PortraitDocumentEnvelope | null): string {
  if (!portrait || !isRecord(portrait.guidance)) {
    return "";
  }
  return normalizeString(portrait.guidance.status_explanation);
}

const PENDING_FIELD_LABELS: Record<string, string> = {
  knowledge_point: "知识点",
  difficulty: "难度",
  question_type: "题型",
  content_mode: "内容模式",
  algorithm: "算法",
  image_requirement: "图片要求",
  teacher_profile: "教师偏好",
  student_profile: "学生情况",
  none: "无",
};

export function renderPendingFieldLabel(value: string): string {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "无";
  }
  return PENDING_FIELD_LABELS[normalized] || normalized;
}

export function getProgressStateTone(state: ProgressState): "neutral" | "ok" | "warn" | "error" {
  if (state === "done") {
    return "ok";
  }
  if (state === "error") {
    return "error";
  }
  if (state === "active") {
    return "warn";
  }
  return "neutral";
}
