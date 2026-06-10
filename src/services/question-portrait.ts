import { randomUUID } from "crypto";

import {
  AI_GEN_ALGORITHM_LABELS,
  AI_GEN_CONTENT_MODE_LABELS,
  AI_GEN_IMAGE_MODE_LABELS,
  AI_GEN_IMAGE_PLACEMENT_LABELS,
  AI_GEN_QUESTION_TYPE_LABELS,
} from "../types/ai-generate";
import type {
  AiGenAlgorithm,
  AiGenContentMode,
  AiGenImageMode,
  AiGenImagePlacementOrEmpty,
  AiGenImageTarget,
  AiGenQuestionType,
} from "../types/ai-generate";
import type {
  QuestionPortraitAttachment,
  QuestionPortraitDocument,
  QuestionPortraitDraft,
  QuestionPortraitGuidance,
  QuestionPortraitMessage,
  QuestionPortraitPendingField,
  QuestionPortraitRemoteSession,
  QuestionPortraitTeacherIntent,
  QuestionPortraitTurnResult,
} from "../types/question-portrait";
import { createOahSessionClient, createOahSessionClientForExistingSession } from "./oah-client";
import { getOahCoreConfig, getOahIntentConfig } from "./oah-config";
import { normalizeQuestionGenerationSpec } from "./question-agent-spec";
import { buildQuestionPortraitMemory } from "./question-portrait-memory";

interface RemotePortraitReply {
  assistant_message?: unknown;
  teacher_intent?: unknown;
  extracted_fields?: unknown;
  portrait_state?: unknown;
  ui_actions?: unknown;
}

interface RemotePortraitFields {
  subject?: unknown;
  knowledge_point?: unknown;
  difficulty?: unknown;
  question_type?: unknown;
  content_mode?: unknown;
  algorithm?: unknown;
  image_mode?: unknown;
  image_placement?: unknown;
  image_targets?: unknown;
  teacher_profile?: unknown;
  student_profile?: unknown;
}

interface RemotePortraitState {
  title?: unknown;
  summary?: unknown;
  status?: unknown;
  pending_field?: unknown;
  missing_items?: unknown;
  teacher_checklist?: unknown;
  status_explanation?: unknown;
  next_step?: unknown;
}

interface RemotePortraitUiActions {
  showSpecForm: boolean;
}

interface RemoteIntentRecognitionReply {
  teacher_intent?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
}

interface RemoteIntentRecognitionResult {
  teacherIntent: QuestionPortraitTeacherIntent;
  confidence: number;
  reasoning: string;
}

const DEFAULT_PORTRAIT_DIALOGUE_TIMEOUT_MS = 240_000;

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getPortraitDialogueTimeoutMs(): number {
  const fallbackTimeoutMs = readPositiveInteger(
    process.env.OAH_REQUEST_TIMEOUT_MS,
    DEFAULT_PORTRAIT_DIALOGUE_TIMEOUT_MS,
  );
  return readPositiveInteger(
    process.env.OAH_PORTRAIT_DIALOGUE_TIMEOUT_MS,
    fallbackTimeoutMs,
  );
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function createTeacherMessageEntry(
  content: string,
  createdAt: string,
  payload?: unknown,
): QuestionPortraitMessage {
  const message: QuestionPortraitMessage = {
    role: "teacher",
    content,
    created_at: createdAt,
  };
  if (payload !== undefined) {
    message.payload = payload;
  }
  return message;
}

function buildMessageListWithTeacher(
  messages: QuestionPortraitMessage[],
  content: string,
  createdAt: string,
  payload: unknown,
  teacherAlreadyAppended: boolean,
): QuestionPortraitMessage[] {
  return teacherAlreadyAppended
    ? messages
    : [...messages, createTeacherMessageEntry(content, createdAt, payload)];
}

function readPayloadAttachments(payload: unknown): QuestionPortraitAttachment[] {
  if (!isRecord(payload) || !Array.isArray(payload.attachments)) {
    return [];
  }
  return payload.attachments.filter((item): item is QuestionPortraitAttachment => isRecord(item)
    && typeof item.id === "string"
    && typeof item.name === "string"
    && typeof item.mime_type === "string"
    && typeof item.size === "number"
    && typeof item.data_url === "string");
}

function buildPromptMessageWithAttachments(message: string, payload: unknown): string {
  const attachments = readPayloadAttachments(payload);
  if (attachments.length === 0) {
    return message;
  }
  const attachmentLines = attachments.map((attachment, index) => {
    const name = normalizeString(attachment.name) || `image-${index + 1}`;
    const mime = normalizeString(attachment.mime_type) || "image";
    const sizeKb = Math.max(1, Math.round(attachment.size / 1024));
    return `${index + 1}. ${name} (${mime}, ${sizeKb}KB)`;
  });
  return [
    message,
    "",
    "老师本轮上传了图片/截图附件。当前 OAH 文本对话不直接传入图片二进制，请根据老师文字说明和这些附件摘要继续处理：",
    ...attachmentLines,
  ].filter(Boolean).join("\n");
}

function buildPendingPortraitState(message: string): RemotePortraitState {
  const summary = normalizeWhitespace(message).slice(0, 120);
  return {
    title: summary ? `出题需求：${summary.slice(0, 28)}` : "新的出题对话",
    summary: summary || "老师已提交出题需求，EduQG 正在整理。",
    status: "draft",
    pending_field: "subject",
    missing_items: ["EduQG 正在整理老师的出题需求。"],
    teacher_checklist: [],
    status_explanation: "已收到老师消息，正在整理试题规范。",
    next_step: "等待 EduQG 回复，或继续补充新的要求。",
  };
}

function normalizePortraitStatus(value: unknown): "draft" | "ready" | "" {
  const normalized = normalizeString(value);
  if (normalized === "draft" || normalized === "ready") {
    return normalized;
  }
  return "";
}

function normalizeTeacherIntent(value: unknown): QuestionPortraitTeacherIntent {
  const normalized = normalizeString(value);
  return normalized === "generate_question" ? "generate_question" : "continue_portrait";
}

function normalizeConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number.parseFloat(normalizeString(value));
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (numeric > 1) {
    return Math.max(0, Math.min(1, numeric / 100));
  }
  return Math.max(0, Math.min(1, numeric));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueStrings(value.map((item) => normalizeString(item)));
}

function normalizeBooleanFlag(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  return normalizeString(value).toLowerCase() === "true";
}

function normalizeRemoteUiActions(value: unknown): RemotePortraitUiActions {
  if (!isRecord(value)) {
    return { showSpecForm: false };
  }
  return {
    showSpecForm: normalizeBooleanFlag(value.show_spec_form),
  };
}

function normalizePendingField(value: unknown): QuestionPortraitPendingField | "" {
  const normalized = normalizeString(value);
  if (
    normalized === "subject"
    || normalized === "knowledge_point"
    || normalized === "difficulty"
    || normalized === "question_type"
    || normalized === "content_mode"
    || normalized === "algorithm"
    || normalized === "image_requirement"
    || normalized === "teacher_profile"
    || normalized === "student_profile"
    || normalized === "none"
  ) {
    return normalized;
  }
  return "";
}

function cloneDraft(draft: QuestionPortraitDraft): QuestionPortraitDraft {
  return JSON.parse(JSON.stringify(draft)) as QuestionPortraitDraft;
}

function createEmptyDraft(): QuestionPortraitDraft {
  return {
    subject: "",
    knowledge_point: "",
    difficulty: "",
    algorithm: "direct",
    question_type: "",
    content_mode: "",
    image_mode: "none",
    image_placement: "",
    image_targets: [],
    teacher_profile: {},
    student_profile: {},
  };
}

function parseDifficulty(value: unknown): string {
  const normalized = normalizeString(value);
  if (/^[1-6]$/.test(normalized)) {
    return normalized;
  }
  const matched = normalized.match(/\b([1-6])\b/);
  return matched?.[1] || "";
}

function normalizeAiGenImageMode(value: unknown): AiGenImageMode | "" {
  const normalized = normalizeString(value);
  if (normalized === "none" || normalized === "optional" || normalized === "required") {
    return normalized;
  }
  return "";
}

function normalizeAiGenQuestionType(value: unknown): AiGenQuestionType | "" {
  const normalized = normalizeString(value);
  if (normalized === "multiple_choice" || normalized === "true_false" || normalized === "short_answer") {
    return normalized;
  }
  return "";
}

function normalizeAiGenContentMode(value: unknown): AiGenContentMode | "" {
  const normalized = normalizeString(value);
  if (normalized === "text" || normalized === "image") {
    return normalized;
  }
  return "";
}

function normalizeAiGenAlgorithm(value: unknown): AiGenAlgorithm | "" {
  const normalized = normalizeString(value);
  if (
    normalized === "direct"
    || normalized === "cot"
    || normalized === "react"
    || normalized === "dear"
    || normalized === "eqpr"
    || normalized === "evoq"
  ) {
    return normalized;
  }
  return "";
}

function normalizeAiGenImagePlacement(value: unknown): AiGenImagePlacementOrEmpty {
  const normalized = normalizeString(value);
  if (normalized === "stem_image" || normalized === "explanation_image" || normalized === "option_image") {
    return normalized;
  }
  return "";
}

function normalizeAiGenImageTargets(value: unknown): AiGenImageTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is AiGenImageTarget => item === "stem" || item === "options" || item === "solution");
}

function mapPlacementToTargets(imagePlacement: AiGenImagePlacementOrEmpty): AiGenImageTarget[] {
  if (imagePlacement === "option_image") {
    return ["options"];
  }
  if (imagePlacement === "explanation_image") {
    return ["solution"];
  }
  if (imagePlacement === "stem_image") {
    return ["stem"];
  }
  return [];
}

function mapTargetsToPlacement(imageTargets: AiGenImageTarget[]): AiGenImagePlacementOrEmpty {
  if (imageTargets.length !== 1) {
    return "";
  }
  if (imageTargets[0] === "options") {
    return "option_image";
  }
  if (imageTargets[0] === "solution") {
    return "explanation_image";
  }
  if (imageTargets[0] === "stem") {
    return "stem_image";
  }
  return "";
}

function applyImageDefaults(draft: QuestionPortraitDraft): void {
  if (draft.content_mode !== "image") {
    return;
  }
  if (draft.image_mode === "none") {
    draft.image_mode = "required";
  }
  if (draft.image_targets.length === 0 && draft.image_placement) {
    draft.image_targets = mapPlacementToTargets(draft.image_placement);
  }
  if (!draft.image_placement && draft.image_targets.length === 1) {
    draft.image_placement = mapTargetsToPlacement(draft.image_targets);
  }
  if (!draft.image_placement && draft.image_targets.length === 0) {
    draft.image_placement = "stem_image";
    draft.image_targets = ["stem"];
  }
}

function applyTeacherProfilePatch(target: Partial<QuestionPortraitDraft["teacher_profile"]>, patch: unknown): void {
  if (!isRecord(patch)) {
    return;
  }
  const pedagogicalStyle = normalizeString(patch.pedagogical_style);
  const languagePolicy = normalizeString(patch.language_policy);
  const difficultyPolicy = normalizeString(patch.difficulty_policy);
  const visualPolicy = normalizeString(patch.visual_policy);
  const constraints = normalizeStringArray(patch.constraints);

  if (pedagogicalStyle) {
    target.pedagogical_style = pedagogicalStyle;
  }
  if (languagePolicy) {
    target.language_policy = languagePolicy;
  }
  if (difficultyPolicy) {
    target.difficulty_policy = difficultyPolicy;
  }
  if (visualPolicy) {
    target.visual_policy = visualPolicy;
  }
  if (constraints.length > 0) {
    target.constraints = uniqueStrings([...(target.constraints || []), ...constraints]);
  }
}

function applyStudentProfilePatch(target: Partial<QuestionPortraitDraft["student_profile"]>, patch: unknown): void {
  if (!isRecord(patch)) {
    return;
  }
  const learningPreferences = normalizeStringArray(patch.learning_preferences);
  const misconceptions = normalizeStringArray(patch.misconceptions);
  if (learningPreferences.length > 0) {
    target.learning_preferences = uniqueStrings([...(target.learning_preferences || []), ...learningPreferences]);
  }
  if (misconceptions.length > 0) {
    target.misconceptions = uniqueStrings([...(target.misconceptions || []), ...misconceptions]);
  }
}

function applyRemoteFieldPatch(draft: QuestionPortraitDraft, patch: unknown): void {
  if (!isRecord(patch)) {
    return;
  }
  const fields = patch as RemotePortraitFields;

  const subject = normalizeString(fields.subject);
  if (subject) {
    draft.subject = subject;
    draft.teacher_profile.subject_focus = uniqueStrings([
      subject,
      ...(draft.teacher_profile.subject_focus || []),
    ]);
  }

  const knowledgePoint = normalizeString(fields.knowledge_point);
  if (knowledgePoint) {
    draft.knowledge_point = knowledgePoint;
  }

  const difficulty = parseDifficulty(fields.difficulty);
  if (difficulty) {
    draft.difficulty = difficulty;
  }

  const questionType = normalizeAiGenQuestionType(fields.question_type);
  if (questionType) {
    draft.question_type = questionType;
  }

  const contentMode = normalizeAiGenContentMode(fields.content_mode);
  if (contentMode) {
    draft.content_mode = contentMode;
  }

  const algorithm = normalizeAiGenAlgorithm(fields.algorithm);
  if (algorithm) {
    draft.algorithm = algorithm;
  }

  const imageMode = normalizeAiGenImageMode(fields.image_mode);
  if (imageMode) {
    draft.image_mode = imageMode;
  }

  const imagePlacement = normalizeAiGenImagePlacement(fields.image_placement);
  if (imagePlacement) {
    draft.image_placement = imagePlacement;
    draft.image_targets = mapPlacementToTargets(imagePlacement);
  }

  const imageTargets = normalizeAiGenImageTargets(fields.image_targets);
  if (imageTargets.length > 0) {
    draft.image_targets = imageTargets;
  }

  if (draft.content_mode === "text") {
    draft.image_mode = "none";
    draft.image_placement = "";
    draft.image_targets = [];
  } else {
    applyImageDefaults(draft);
  }

  applyTeacherProfilePatch(draft.teacher_profile, fields.teacher_profile);
  applyStudentProfilePatch(draft.student_profile, fields.student_profile);
}

function resolvePendingFieldFromDraft(draft: QuestionPortraitDraft): QuestionPortraitPendingField {
  if (!draft.subject) {
    return "subject";
  }
  if (!draft.knowledge_point) {
    return "knowledge_point";
  }
  if (!draft.difficulty) {
    return "difficulty";
  }
  if (!draft.question_type) {
    return "question_type";
  }
  if (!draft.content_mode) {
    return "content_mode";
  }
  return "none";
}

function getPendingFieldPrompt(field: QuestionPortraitPendingField): string {
  switch (field) {
    case "subject":
      return "请老师明确这道题所属学科，例如数学、语文、物理、建筑设计原理。";
    case "knowledge_point":
      return "请老师明确这道题围绕哪个知识点或考点。";
    case "difficulty":
      return "请老师明确难度等级，使用 1 到 6。";
    case "question_type":
      return "请老师明确题型：选择题、判断题或简答题。";
    case "content_mode":
      return "请老师明确做纯文本题还是图片题。";
    case "algorithm":
      return "请老师明确使用哪种出题算法。";
    case "image_requirement":
      return "请老师明确图片放在题干、选项还是解析里。";
    case "teacher_profile":
      return "请老师补充教学风格、语言要求或额外约束。";
    case "student_profile":
      return "请补充学生能力、常见误区或学习偏好。";
    default:
      return "试题规范已齐备，可以开始出题。";
  }
}

function buildTeacherChecklist(draft: QuestionPortraitDraft): string[] {
  const checklist: string[] = [];
  if (draft.subject) {
    checklist.push(`学科已确认：${draft.subject}`);
  }
  if (draft.knowledge_point) {
    checklist.push(`知识点已确认：${draft.knowledge_point}`);
  }
  if (draft.difficulty) {
    checklist.push(`难度已确认：${draft.difficulty}`);
  }
  if (draft.question_type) {
    checklist.push(`题型已确认：${AI_GEN_QUESTION_TYPE_LABELS[draft.question_type]}`);
  }
  if (draft.content_mode) {
    checklist.push(`内容模式已确认：${AI_GEN_CONTENT_MODE_LABELS[draft.content_mode]}`);
  }
  if (draft.algorithm) {
    checklist.push(`算法已确认：${AI_GEN_ALGORITHM_LABELS[draft.algorithm]}`);
  }
  if (draft.content_mode === "image" && draft.image_placement) {
    checklist.push(`图片位置已确认：${AI_GEN_IMAGE_PLACEMENT_LABELS[draft.image_placement]}`);
  }
  if ((draft.teacher_profile.constraints || []).length > 0) {
    checklist.push(`老师额外约束：${(draft.teacher_profile.constraints || []).join("；")}`);
  }
  return checklist;
}

function buildFallbackSummary(draft: QuestionPortraitDraft): string {
  const parts = [
    `学科：${draft.subject || "待确认"}`,
    `知识点：${draft.knowledge_point || "待确认"}`,
    `难度：${draft.difficulty || "待确认"}`,
    `题型：${draft.question_type ? AI_GEN_QUESTION_TYPE_LABELS[draft.question_type] : "待确认"}`,
    `内容模式：${draft.content_mode ? AI_GEN_CONTENT_MODE_LABELS[draft.content_mode] : "待确认"}`,
    `算法：${draft.algorithm ? AI_GEN_ALGORITHM_LABELS[draft.algorithm] : "待确认"}`,
  ];
  if (draft.content_mode === "image") {
    parts.push(`图片模式：${AI_GEN_IMAGE_MODE_LABELS[draft.image_mode] || draft.image_mode}`);
    parts.push(`图片位置：${draft.image_placement ? AI_GEN_IMAGE_PLACEMENT_LABELS[draft.image_placement] : "待确认"}`);
  }
  return parts.join(" | ");
}

function buildFallbackGuidance(
  draft: QuestionPortraitDraft,
  validationErrors: string[],
): {
  status: "draft" | "ready";
  pendingField: QuestionPortraitPendingField;
  summary: string;
  guidance: QuestionPortraitGuidance;
} {
  const pendingField = resolvePendingFieldFromDraft(draft);
  const ready = pendingField === "none" && validationErrors.length === 0;
  return {
    status: ready ? "ready" : "draft",
    pendingField,
    summary: buildFallbackSummary(draft),
    guidance: {
      status_explanation: ready
        ? "试题规范已经完整确认，可以进入出题阶段。"
        : `当前还不能开始出题。${getPendingFieldPrompt(pendingField)}`,
      missing_items: ready ? [] : uniqueStrings([getPendingFieldPrompt(pendingField), ...validationErrors]),
      teacher_checklist: buildTeacherChecklist(draft),
      next_step: ready ? "点击“开始生成”进入出题流程。" : getPendingFieldPrompt(pendingField),
    },
  };
}

function normalizeRemotePortraitState(value: unknown): {
  title: string;
  summary: string;
  status: "draft" | "ready" | "";
  pendingField: QuestionPortraitPendingField | "";
  missingItems: string[];
  teacherChecklist: string[];
  statusExplanation: string;
  nextStep: string;
} {
  const state = isRecord(value) ? (value as RemotePortraitState) : {};
  return {
    title: normalizeString(state.title),
    summary: normalizeString(state.summary),
    status: normalizePortraitStatus(state.status),
    pendingField: normalizePendingField(state.pending_field),
    missingItems: normalizeStringArray(state.missing_items),
    teacherChecklist: normalizeStringArray(state.teacher_checklist),
    statusExplanation: normalizeString(state.status_explanation),
    nextStep: normalizeString(state.next_step),
  };
}

function renderPortraitMarkdown(document: QuestionPortraitDocument): string {
  const { draft } = document;
  return [
    "# 试题规范文档",
    "",
    `- portrait_id: ${document.portrait_id}`,
    `- owner_uid: ${document.owner_uid}`,
    `- title: ${document.title}`,
    `- status: ${document.status}`,
    `- pending_field: ${document.pending_field}`,
    `- created_at: ${document.created_at}`,
    `- updated_at: ${document.updated_at}`,
    document.markdown_path ? `- markdown_path: ${document.markdown_path}` : "- markdown_path: (memory)",
    document.remote_session
      ? `- remote_session: ${document.remote_session.workspace_id} / ${document.remote_session.session_id}`
      : "- remote_session: -",
    "",
    "## 规范摘要",
    "",
    document.summary || "暂无摘要",
    "",
    "## 长期记忆",
    "",
    document.session_memory?.summary || "暂无长期记忆",
    "",
    "## 主智能体判断",
    "",
    `- 状态说明: ${document.guidance.status_explanation || "暂无"}`,
    `- 下一步: ${document.guidance.next_step || "暂无"}`,
    `- 缺失项: ${document.guidance.missing_items.length > 0 ? document.guidance.missing_items.join(" | ") : "无"}`,
    `- 已确认清单: ${document.guidance.teacher_checklist.length > 0 ? document.guidance.teacher_checklist.join(" | ") : "无"}`,
    "",
    "## 当前试题规范字段",
    "",
    `- 学科: ${draft.subject || "待确认"}`,
    `- 知识点: ${draft.knowledge_point || "待确认"}`,
    `- 难度: ${draft.difficulty || "待确认"}`,
    `- 题型: ${draft.question_type ? AI_GEN_QUESTION_TYPE_LABELS[draft.question_type] : "待确认"}`,
    `- 内容模式: ${draft.content_mode ? AI_GEN_CONTENT_MODE_LABELS[draft.content_mode] : "待确认"}`,
    `- 算法: ${draft.algorithm ? AI_GEN_ALGORITHM_LABELS[draft.algorithm] : "待确认"}`,
    `- 图片模式: ${AI_GEN_IMAGE_MODE_LABELS[draft.image_mode] || draft.image_mode}`,
    `- 图片位置: ${draft.image_placement ? AI_GEN_IMAGE_PLACEMENT_LABELS[draft.image_placement] : "待确认"}`,
    `- 图片目标: ${draft.image_targets.length > 0 ? draft.image_targets.join(", ") : "无"}`,
    "",
    "## 教师偏好",
    "",
    `- pedagogical_style: ${draft.teacher_profile.pedagogical_style || "未指定"}`,
    `- language_policy: ${draft.teacher_profile.language_policy || "未指定"}`,
    `- difficulty_policy: ${draft.teacher_profile.difficulty_policy || "未指定"}`,
    `- visual_policy: ${draft.teacher_profile.visual_policy || "未指定"}`,
    `- constraints: ${(draft.teacher_profile.constraints || []).join(" | ") || "无"}`,
    "",
    "## 规范状态",
    "",
    `- spec_id: ${document.spec.spec_id}`,
    `- spec_status: ${document.spec.status}`,
    `- validation_errors: ${document.validation_errors.length > 0 ? document.validation_errors.join(" | ") : "无"}`,
  ].join("\n");
}

function buildLatestGeneratedQuestionBlock(document: QuestionPortraitDocument | null): string {
  const generatedMessage = [...(document?.messages || [])]
    .reverse()
    .find((message) => normalizeString(message.kind) === "generated_question" && isRecord(message.payload));
  if (!generatedMessage || !isRecord(generatedMessage.payload)) {
    return "{}";
  }

  const result = generatedMessage.payload;
  const assets = isRecord(result.assets) ? result.assets : {};
  const request = isRecord(result.request)
    ? result.request
    : isRecord(result.meta)
      ? result.meta
      : {};
  const optionImages = isRecord(result.option_images)
    ? result.option_images
    : isRecord(assets.option_images)
      ? assets.option_images
      : {};

  const summary = {
    request_id: normalizeString(generatedMessage.request_id),
    created_at: normalizeString(generatedMessage.created_at),
    question: normalizeString(result.question),
    options: normalizeStringArray(result.options).slice(0, 6),
    ground_truth: normalizeString(result.ground_truth),
    solution_steps: normalizeStringArray(result.solution_steps).slice(0, 6),
    request: {
      subject: normalizeString(request.subject),
      knowledge_point: normalizeString(request.knowledge_point),
      difficulty: normalizeString(request.difficulty),
      question_type: normalizeString(request.question_type),
      content_mode: normalizeString(request.content_mode),
      image_mode: normalizeString(request.image_mode),
      image_placement: normalizeString(request.image_placement),
      image_targets: normalizeStringArray(request.image_targets),
    },
    has_images: {
      stem: Boolean(normalizeString(result.stem_image) || normalizeString(assets.stem_image)),
      explanation: Boolean(normalizeString(result.explanation_image) || normalizeString(assets.explanation_image)),
      options: Object.values(optionImages).some((value) => Boolean(normalizeString(value))),
    },
  };

  return JSON.stringify(summary, null, 2);
}

function buildRemotePrompt(document: QuestionPortraitDocument | null, teacherMessage: string): string {
  const portraitId = document?.portrait_id || "new_portrait";
  const draftBlock = JSON.stringify(document?.draft || createEmptyDraft(), null, 2);
  const guidanceBlock = JSON.stringify(
    document
      ? {
        title: document.title,
        summary: document.summary,
        status: document.status,
        pending_field: document.pending_field,
        ...document.guidance,
      }
      : {
        title: "",
        summary: "",
        status: "draft",
        pending_field: "subject",
        status_explanation: "尚未收集到试题规范信息。",
        missing_items: ["请先确认学科。"],
        teacher_checklist: [],
        next_step: "先追问老师要考哪个学科。",
      },
    null,
    2,
  );
  const specBlock = document
    ? JSON.stringify(
      {
        status: document.spec.status,
        validation_errors: document.validation_errors,
      },
      null,
      2,
    )
    : '{"status":"blocked","validation_errors":["试题规范尚未就绪"]}';
  const latestMessages = (document?.messages || [])
    .filter((message) => !message.kind || message.kind === "text" || message.kind === "notice")
    .map((message) => ({
      role: message.role,
      content: message.content,
      created_at: message.created_at,
    }))
    .slice(-6);
  const messageBlock = latestMessages.length > 0
    ? JSON.stringify(latestMessages, null, 2)
    : "[]";
  const generatedQuestionBlock = buildLatestGeneratedQuestionBlock(document);
  const memoryBlock = document
    ? JSON.stringify(document.session_memory || buildQuestionPortraitMemory(document), null, 2)
    : "{}";

  return [
    "你是 EduQG 虚拟教师，也是 Tutor 出题系统内部的试题规范抽取与出题意图判断助手。",
    "本轮只负责理解老师对话、抽取试题规范字段、判断是否可以进入出题；不要在这一步生成最终试题。",
    "字段名和枚举值必须遵守系统契约；所有面向老师的自然语言内容必须使用简体中文。",
    "",
    "你的职责：",
    "- 从老师当前消息和最近对话中识别出题意图，而不是依赖固定触发词。",
    "- `session_memory` 是跨轮次长期记忆，最近对话是短期上下文；教师/学生画像只是稳定画像信号，不是对话记忆。",
    "- 从自然语言中抽取学科、知识点、难度、题型、内容模式、图片要求、出题算法、教师偏好和学生情况。",
    "- 学科决定出题角色：数学题按数学教师与命题专家处理，物理题按物理教师处理，建筑设计原理题按建筑学教师与课程命题专家处理；其他学科按对应学科教师角色处理。",
    "- 判断哪些必填字段已经确认、哪些仍缺失。",
    "- 给老师返回一句简短、自然、中文的下一步回复。",
    "- 对外介绍自己时只能称为“EduQG 虚拟教师”，可以说明你能帮助生成选择题、判断题、简答题、文本题和图片题，也能继续追问完善出题要求。",
    "- 如果老师只是问候或还没有提供出题要求，先说明你是 EduQG 虚拟教师，能生成选择题、判断题、简答题、文本题和图片题，也能根据自然语言继续完善出题要求；再邀请老师提供学科、知识点、难度和题型。",
    "",
    "处理顺序必须是：",
    "1. 先结合老师当前消息和最近对话抽取或更新 `extracted_fields`。",
    "2. 再用更新后的字段判断 `portrait_state.status`、`pending_field`、缺失项和已确认项。",
    "3. 最后判断 `teacher_intent`；只有更新后的试题规范已经完整可生成，且老师本轮表达的是进入出题流程，才输出 `generate_question`。",
    "",
    "只返回一个 JSON 对象。",
    "不要使用 Markdown 代码块。",
    "不要在 JSON 之外输出任何文字。",
    "{",
    '  "assistant_message": "给老师的一句简短中文回复",',
    '  "teacher_intent": "continue_portrait | generate_question",',
    '  "ui_actions": {',
    '    "show_spec_form": false',
    '  },',
    '  "extracted_fields": {',
    '    "subject": "中文学科名或空字符串",',
    '    "knowledge_point": "中文知识点或空字符串",',
    '    "difficulty": "1-6 的字符串或空字符串",',
    '    "question_type": "multiple_choice | true_false | short_answer | 空字符串",',
    '    "content_mode": "text | image | 空字符串",',
    '    "algorithm": "direct | cot | react | dear | eqpr | evoq | 空字符串",',
    '    "image_mode": "none | optional | required | 空字符串",',
    '    "image_placement": "stem_image | explanation_image | option_image | 空字符串",',
    '    "image_targets": ["stem" | "options" | "solution"],',
    '    "teacher_profile": {',
    '      "pedagogical_style": "中文字符串或省略",',
    '      "language_policy": "中文字符串或省略",',
    '      "difficulty_policy": "中文字符串或省略",',
    '      "visual_policy": "中文字符串或省略",',
    '      "constraints": ["中文约束"]',
    '    },',
    '    "student_profile": {',
    '      "learning_preferences": ["中文学习偏好"],',
    '      "misconceptions": ["中文常见误区"]',
    '    }',
    '  },',
    '  "portrait_state": {',
    '    "title": "中文短标题",',
    '    "summary": "中文短摘要",',
    '    "status": "draft | ready",',
    '    "pending_field": "subject | knowledge_point | difficulty | question_type | content_mode | algorithm | image_requirement | teacher_profile | student_profile | none",',
    '    "missing_items": ["给老师看的中文缺失项"],',
    '    "teacher_checklist": ["给老师看的中文已确认项"],',
    '    "status_explanation": "中文说明为什么可以或不可以开始生成",',
    '    "next_step": "给老师看的中文下一步指令"',
    '  }',
    "}",
    "",
    "规则：",
    "- `teacher_intent` 只能是 `continue_portrait` 或 `generate_question`。",
    "- `ui_actions.show_spec_form` 在本轮回复需要老师补齐任一必填出题规范字段时应为 true；错误说明、字段已完整确认、准备生成题目时必须为 false。",
    "- 如果老师仍在补充、修改或确认试题规范字段，`teacher_intent` 必须是 `continue_portrait`。",
    "- 只有当老师明确表达现在开始出题，且更新后的试题规范已经完整可生成时，才输出 `generate_question`。",
    "- 如果任一必填字段仍缺失，`teacher_intent` 必须保持 `continue_portrait`。",
    "- 不要臆造老师没有确认的信息；不确定就留空并追问。",
    "- `algorithm` 有业务默认值 `direct`；老师没有指定算法、表示无偏好或接受系统安排时，不要追问算法。",
    "- 图片题有业务默认图片位置：题干图 `stem_image` / `image_targets=[\"stem\"]`；老师只要求带图但没有指定位置、或表示任一位置均可时，不要追问图片位置。",
    "- 老师当前轮没有重新指定的字段，优先沿用当前草稿、`session_memory` 和最近对话中的已确认值；不要要求老师重复提供已经存在的学科、知识点、难度、题型或内容模式。",
    "- 如果老师明确说“更难一点”“简单一点”“再难一些”等相对难度，并且当前试题规范已有难度，就在 1-6 范围内上调或下调 1 级；如果当前没有难度，就先询问具体难度。",
    "- 如果老师没有重新指定学科、难度、算法或图片要求，不要静默改动这些已确认字段。",
    "- `portrait_state.status` 只有在试题规范真正可生成时才设为 `ready`。",
    "- 如果 `content_mode` 是 `image`，且老师没有指定图片位置，使用业务默认题干图后即可设为 `ready`；只有图片需求本身不明确时才追问。",
    "- 如果“最近已生成题目 JSON”不是空对象，老师后续普通消息默认是在讨论或修改这道已生成题；不要自动展示旧表单，也不要要求重新填表。",
    "- 只有老师明确要求新建或重填表单，或者你先询问是否需要新表单且老师明确同意，`ui_actions.show_spec_form` 才能为 true；否则保持 false。",
    "- 老师要求改题干、选项、答案、解析、图片、难度或知识点时，优先用对话说明已理解的修改，并更新相关 `extracted_fields`；需要重新生成时等老师明确要求生成再输出 `generate_question`。",
    "- `assistant_message`、`missing_items`、`teacher_checklist`、`status_explanation`、`next_step` 必须是简体中文。",
    "- `assistant_message` 不允许出现“试题画像”“画像归一化”“归一化助手”“画像助手”等内部称呼；面向老师统一使用“出题要求”“试题规范”“EduQG 虚拟教师”。",
    "",
    "few-shot 示例只用于展示抽取方式，不是固定词表，也不是默认值：",
    "示例 1 输入：出一道数学题，关于一次函数图像中斜率与截距符号判断的选择题，难度 1，要图片题，图片放题干，用 direct，然后开始生成。",
    "示例 1 输出要点：subject=数学；knowledge_point=一次函数图像中斜率与截距符号判断；difficulty=1；question_type=multiple_choice；content_mode=image；image_mode=required；image_placement=stem_image；image_targets=[stem]；algorithm=direct；teacher_intent=generate_question。",
    "示例 2 输入：先别生成，改成简答题，考查学生能不能解释实验变量控制，难度 3，不要图片。",
    "示例 2 输出要点：如果上下文已有学科则保留原学科；question_type=short_answer；knowledge_point=实验变量控制的解释；difficulty=3；content_mode=text；image_mode=none；teacher_intent=continue_portrait。",
    "示例 3 输入：就按刚才这些要求出题吧。",
    "示例 3 输出要点：如果当前试题规范已完整，teacher_intent=generate_question；如果仍有缺失字段，teacher_intent=continue_portrait 并追问缺失项。",
    "示例 4 输入：我想要更难一点的。",
    "示例 4 输出要点：如果当前 difficulty=3，则 difficulty=4；assistant_message=已把难度上调一级；不要改动已确认的学科、算法和图片要求。",
    "示例 5 输入：我还需要一道带图题。上下文已有 subject=数学、knowledge_point=一次函数、difficulty=2、question_type=multiple_choice。",
    "示例 5 输出要点：保留上下文已有字段；content_mode=image；image_mode=required；image_placement=stem_image；image_targets=[stem]；algorithm=direct；如果老师本轮要求生成则 teacher_intent=generate_question，否则询问是否现在生成。",
    "",
    `portrait_id: ${portraitId}`,
    "",
    "当前试题规范草稿 JSON：",
    draftBlock,
    "",
    "当前试题规范状态 JSON：",
    guidanceBlock,
    "",
    "当前规范校验快照：",
    specBlock,
    "当前长期记忆 session_memory JSON：",
    memoryBlock,
    "",
    "最近已生成题目 JSON：",
    generatedQuestionBlock,
    "",
    "最近对话：",
    messageBlock,
    "",
    "老师当前消息：",
    teacherMessage || "老师还没有提供消息，请先询问要考查哪个知识点。",
  ].join("\n");
}

function buildIntentPortraitSnapshot(document: QuestionPortraitDocument | null): Record<string, unknown> | null {
  if (!document) {
    return null;
  }
  const messages = (document.messages || [])
    .filter((message) => !message.kind || message.kind === "text" || message.kind === "notice")
    .map((message) => ({
      role: message.role,
      content: message.content,
      created_at: message.created_at,
    }))
    .slice(-8);

  return {
    portrait_id: document.portrait_id,
    status: document.status,
    pending_field: document.pending_field,
    draft: document.draft,
    spec_status: document.spec.status,
    validation_errors: document.validation_errors,
    guidance: document.guidance,
    session_memory: document.session_memory || buildQuestionPortraitMemory(document),
    recent_messages: messages,
  };
}

function buildIntentRecognitionPrompt(input: {
  previousPortrait: QuestionPortraitDocument | null;
  completedPortrait: QuestionPortraitDocument;
  teacherMessage: string;
  dialogueAssistantMessage: string;
  dialogueTeacherIntent: QuestionPortraitTeacherIntent;
}): string {
  const payload = {
    previous_portrait: buildIntentPortraitSnapshot(input.previousPortrait),
    completed_portrait: buildIntentPortraitSnapshot(input.completedPortrait),
    current_teacher_message: input.teacherMessage,
    dialogue_agent_output: {
      assistant_message: input.dialogueAssistantMessage,
      teacher_intent: input.dialogueTeacherIntent,
    },
  };

  return [
    "你是 EduQG 的意图识别子 agent。你的任务不是抽取字段，也不是生成题目，只判断老师当前这一轮是否在语义上授权系统立刻进入出题生成流程。",
    "",
    "必须基于语义、上下文和状态转移判断，不允许用固定触发词、关键词表或正则式思维做判断。",
    "判断时同时看：上一轮试题规范状态、老师当前消息、对话 agent 已抽取后的规范状态、对话 agent 的候选意图。",
    "`session_memory` 是长期记忆，`recent_messages` 是短期上下文；teacher_profile/student_profile 只是画像信号，不等于对话记忆。",
    "",
    "输出 `generate_question` 的必要条件：",
    "- completed_portrait.spec_status 必须是 ready，且没有阻塞性 validation_errors。",
    "- 老师当前轮的语义动作是在请求生成、授权生成、接受上一轮确认并交给系统继续，或在规范已 ready 后追问为什么还没有进入出题结果。",
    "- 老师当前轮没有表达暂停、否定、继续修改、只询问信息、或需要先看表单再决定。",
    "",
    "输出 `continue_portrait` 的条件：",
    "- 规范仍未 ready，或当前轮主要是在新增、修改或澄清出题要求。",
    "- 当前轮语义不确定，或者只是在寒暄、询问能力、要求解释、要求展示表单。",
    "- 老师表达了先不要生成、稍后再说、需要继续调整，或与生成授权相冲突。",
    "",
    "只返回 JSON，不要 Markdown，不要解释 JSON 之外的内容：",
    "{",
    '  "teacher_intent": "continue_portrait | generate_question",',
    '  "confidence": 0.0,',
    '  "reasoning": "一句简短中文理由，说明语义依据"',
    "}",
    "",
    "输入上下文 JSON：",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  throw new Error("远程试题规范回复未包含 JSON 对象");
}

function parseRemotePortraitReply(
  text: string,
): {
  assistantMessage: string;
  teacherIntent: QuestionPortraitTeacherIntent;
  extractedFields: unknown;
  portraitState: unknown;
  uiActions: RemotePortraitUiActions;
} {
  let jsonObject = "";
  try {
    jsonObject = extractJsonObject(text);
  } catch {
    return {
      assistantMessage: sanitizeRemoteAssistantMessage(text.trim()),
      teacherIntent: "continue_portrait",
      extractedFields: {},
      portraitState: {},
      uiActions: { showSpecForm: false },
    };
  }
  try {
    const parsed = JSON.parse(jsonObject) as RemotePortraitReply;
    const assistantMessage = sanitizeRemoteAssistantMessage(normalizeString(parsed.assistant_message) || text.trim());
    return {
      assistantMessage,
      teacherIntent: normalizeTeacherIntent(parsed.teacher_intent),
      extractedFields: parsed.extracted_fields,
      portraitState: parsed.portrait_state,
      uiActions: normalizeRemoteUiActions(parsed.ui_actions),
    };
  } catch {
    const repaired = repairAssistantMessageJson(jsonObject);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as RemotePortraitReply;
        const assistantMessage = sanitizeRemoteAssistantMessage(
          normalizeString(parsed.assistant_message) || extractAssistantMessage(text) || text.trim(),
        );
        return {
          assistantMessage,
          teacherIntent: normalizeTeacherIntent(parsed.teacher_intent),
          extractedFields: parsed.extracted_fields,
          portraitState: parsed.portrait_state,
          uiActions: normalizeRemoteUiActions(parsed.ui_actions),
        };
      } catch {
        // Fall through to the text-only recovery below.
      }
    }
    return {
      assistantMessage: sanitizeRemoteAssistantMessage(extractAssistantMessage(text) || text.trim()),
      teacherIntent: "continue_portrait",
      extractedFields: {},
      portraitState: {},
      uiActions: { showSpecForm: false },
    };
  }
}

function parseRemoteIntentRecognitionReply(text: string): RemoteIntentRecognitionResult {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as RemoteIntentRecognitionReply;
    return {
      teacherIntent: normalizeTeacherIntent(parsed.teacher_intent),
      confidence: normalizeConfidence(parsed.confidence),
      reasoning: normalizeString(parsed.reasoning),
    };
  } catch {
    return {
      teacherIntent: "continue_portrait",
      confidence: 0,
      reasoning: "intent recognizer did not return valid JSON",
    };
  }
}

function extractAssistantMessage(text: string): string {
  let jsonObject = "";
  try {
    jsonObject = extractJsonObject(text);
  } catch {
    return "";
  }
  const match = jsonObject.match(/"assistant_message"\s*:\s*"([\s\S]*?)"\s*,[\s\S]*?"extracted_fields"\s*:/);
  return normalizeString(match?.[1]);
}

function repairAssistantMessageJson(text: string): string | null {
  const match = text.match(/("assistant_message"\s*:\s*")([\s\S]*?)("\s*,[\s\S]*?"extracted_fields"\s*:)/);
  if (!match) {
    return null;
  }
  return `${text.slice(0, match.index)}"assistant_message": ${JSON.stringify(match[2])}${match[3]}${text.slice((match.index || 0) + match[0].length)}`;
}

function extractTeacherFacingReplySection(text: string): string {
  const markers = ["## 给老师的回复", "### 给老师的回复", "给老师的回复"];
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) {
      continue;
    }
    const afterMarker = text.slice(markerIndex + marker.length).replace(/^[\s:：\-—]+/, "").trim();
    const nextHeadingIndex = afterMarker.search(/\n#{1,6}\s+/);
    return normalizeString(nextHeadingIndex >= 0 ? afterMarker.slice(0, nextHeadingIndex) : afterMarker);
  }
  return "";
}

function sanitizeRemoteAssistantMessage(text: string): string {
  const trimmed = normalizeString(text);
  const teacherFacingSection = extractTeacherFacingReplySection(trimmed);
  const visibleText = teacherFacingSection || trimmed;
  return visibleText
    .replace(/EduNex/g, "EduQG")
    .replace(/EduQ(?!G)\s*虚拟教师/g, "EduQG 虚拟教师")
    .replace(/试题画像归一化助手|画像归一化助手|归一化助手|画像助手/g, "EduQG 虚拟教师")
    .replace(/画像归一化/g, "试题规范整理")
    .replace(/试题画像/g, "试题规范")
    .replace(/画像/g, "规范")
    .trim();
}

function annotateLatestAssistantIntent(
  portrait: QuestionPortraitDocument,
  teacherIntent: QuestionPortraitTeacherIntent,
): QuestionPortraitDocument {
  for (let index = portrait.messages.length - 1; index >= 0; index -= 1) {
    const message = portrait.messages[index];
    if (message.role !== "assistant") {
      continue;
    }
    const payload = isRecord(message.payload) ? message.payload : {};
    return {
      ...portrait,
      messages: portrait.messages.map((item, itemIndex) => (
        itemIndex === index
          ? {
              ...item,
              payload: {
                ...payload,
                teacher_intent: teacherIntent,
              },
            }
          : item
      )),
    };
  }
  return portrait;
}

function createDerivedPortrait(
  portraitId: string,
  ownerUid: string,
  draft: QuestionPortraitDraft,
  messages: QuestionPortraitDocument["messages"],
  createdAt: string,
  updatedAt: string,
  markdownPath: string | null,
  remoteSession: QuestionPortraitRemoteSession | null,
  remoteState: unknown,
): QuestionPortraitDocument {
  if (!draft.algorithm) {
    draft.algorithm = "direct";
  }
  if (draft.content_mode === "image") {
    applyImageDefaults(draft);
  } else if (draft.content_mode === "text") {
    draft.image_mode = "none";
    draft.image_placement = "";
    draft.image_targets = [];
  }

  const normalizeInput: Record<string, unknown> = {
    request_uuid: portraitId,
    subject: draft.subject,
    knowledge_point: draft.knowledge_point,
    difficulty: draft.difficulty,
    image_mode: draft.image_mode,
    image_placement: draft.image_placement,
    image_targets: draft.image_targets,
    teacher_profile: draft.teacher_profile,
    student_profile: draft.student_profile,
  };

  if (draft.algorithm) {
    normalizeInput.algorithm = draft.algorithm;
  }
  if (draft.question_type) {
    normalizeInput.question_type = draft.question_type;
  }
  if (draft.content_mode) {
    normalizeInput.content_mode = draft.content_mode;
  }

  const normalized = normalizeQuestionGenerationSpec(normalizeInput);
  const fallback = buildFallbackGuidance(draft, normalized.spec.validation_errors);
  const remote = normalizeRemotePortraitState(remoteState);
  const localReady = fallback.status === "ready"
    && fallback.pendingField === "none"
    && normalized.spec.status === "ready";
  const effectiveStatus = localReady ? fallback.status : (remote.status || fallback.status);
  const effectivePendingField = localReady ? fallback.pendingField : (remote.pendingField || fallback.pendingField);
  const effectiveGuidance = localReady
    ? fallback.guidance
    : {
      status_explanation: remote.statusExplanation || fallback.guidance.status_explanation,
      missing_items: remote.missingItems.length > 0 ? remote.missingItems : fallback.guidance.missing_items,
      teacher_checklist: remote.teacherChecklist.length > 0
        ? remote.teacherChecklist
        : fallback.guidance.teacher_checklist,
      next_step: remote.nextStep || fallback.guidance.next_step,
    };

  const document: QuestionPortraitDocument = {
    portrait_id: portraitId,
    owner_uid: ownerUid,
    title: remote.title || draft.knowledge_point || "未命名试题规范",
    status: effectiveStatus,
    pending_field: effectivePendingField,
    summary: remote.summary || fallback.summary,
    guidance: effectiveGuidance,
    draft,
    spec: normalized.spec,
    plan: normalized.plan,
    validation_errors: normalized.spec.validation_errors,
    messages,
    remote_session: remoteSession,
    markdown: "",
    markdown_path: markdownPath,
    created_at: createdAt,
    updated_at: updatedAt,
  };

  document.session_memory = buildQuestionPortraitMemory(document);
  document.markdown = renderPortraitMarkdown(document);
  return document;
}

function buildCurrentPortraitState(document: QuestionPortraitDocument): RemotePortraitState {
  return {
    title: document.title,
    summary: document.summary,
    status: document.status,
    pending_field: document.pending_field,
    missing_items: document.guidance.missing_items,
    teacher_checklist: document.guidance.teacher_checklist,
    status_explanation: document.guidance.status_explanation,
    next_step: document.guidance.next_step,
  };
}

async function createRemoteSession(portraitId: string): Promise<QuestionPortraitRemoteSession> {
  const config = getOahCoreConfig();
  const requestId = `${portraitId}-session`;
  const dialogueTimeoutMs = getPortraitDialogueTimeoutMs();
  const client = await createOahSessionClient({
    baseUrl: config.baseUrl,
    requestId,
    sessionTitle: `Tutor portrait ${portraitId}`,
    agentName: config.agentName || "question-orchestrator",
    activeSessionAgentName: config.agentName || "question-orchestrator",
    modelRef: config.model || undefined,
    workspaceId: config.workspaceId || undefined,
    workspaceRuntime: config.workspaceRuntime || undefined,
    workspaceName: config.workspaceName || undefined,
    workspaceOwnerId: config.workspaceOwnerId || undefined,
    workspaceServiceName: config.workspaceServiceName || undefined,
    workspaceAutoCreate: config.workspaceAutoCreate,
    requestTimeoutMs: dialogueTimeoutMs,
    runTimeoutMs: dialogueTimeoutMs,
  });
  return {
    workspace_id: client.workspaceId,
    session_id: client.sessionId,
    agent_name: client.agentName || config.agentName || "question-orchestrator",
  };
}

function isStaleRemoteSessionError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes("workspace_not_found")
    || text.includes("session_not_found")
    || (text.includes("OAH request failed (404") && (
      text.includes("/catalog")
      || text.includes("/sessions")
      || text.includes("/messages")
    ));
}

async function runRemoteDialogueTurn(
  remoteSession: QuestionPortraitRemoteSession,
  requestId: string,
  prompt: string,
): Promise<{
  assistantMessage: string;
  teacherIntent: QuestionPortraitTeacherIntent;
  extractedFields: unknown;
  portraitState: unknown;
  uiActions: RemotePortraitUiActions;
}> {
  const config = getOahCoreConfig();
  const dialogueTimeoutMs = getPortraitDialogueTimeoutMs();
  const client = createOahSessionClientForExistingSession({
    baseUrl: config.baseUrl,
    requestId,
    workspaceId: remoteSession.workspace_id,
    sessionId: remoteSession.session_id,
    agentName: remoteSession.agent_name,
    activeSessionAgentName: remoteSession.agent_name,
    modelRef: config.model || undefined,
    workspaceRuntime: config.workspaceRuntime || undefined,
    workspaceName: config.workspaceName || undefined,
    workspaceOwnerId: config.workspaceOwnerId || undefined,
    workspaceServiceName: config.workspaceServiceName || undefined,
    workspaceAutoCreate: config.workspaceAutoCreate,
    requestTimeoutMs: dialogueTimeoutMs,
    runTimeoutMs: dialogueTimeoutMs,
  });
  const result = await client.send(prompt);
  return parseRemotePortraitReply(result.text);
}

async function runRemoteIntentRecognitionTurn(
  remoteSession: QuestionPortraitRemoteSession,
  requestId: string,
  prompt: string,
): Promise<RemoteIntentRecognitionResult> {
  const config = getOahIntentConfig();
  const dialogueTimeoutMs = getPortraitDialogueTimeoutMs();
  const client = await createOahSessionClient({
    baseUrl: config.baseUrl,
    requestId,
    sessionTitle: `Tutor intent recognition ${requestId}`,
    agentName: config.intentAgentName,
    activeSessionAgentName: config.intentAgentName,
    modelRef: config.intentModel || undefined,
    workspaceId: remoteSession.workspace_id,
    workspaceRuntime: config.workspaceRuntime || undefined,
    workspaceName: config.workspaceName || undefined,
    workspaceOwnerId: config.workspaceOwnerId || undefined,
    workspaceServiceName: config.workspaceServiceName || undefined,
    workspaceAutoCreate: config.workspaceAutoCreate,
    requestTimeoutMs: dialogueTimeoutMs,
    runTimeoutMs: dialogueTimeoutMs,
  });
  const result = await client.send(prompt);
  return parseRemoteIntentRecognitionReply(result.text);
}

function resolveTeacherIntent(
  requestedIntent: QuestionPortraitTeacherIntent,
  portrait: QuestionPortraitDocument,
): QuestionPortraitTeacherIntent {
  if (requestedIntent !== "generate_question") {
    return "continue_portrait";
  }
  return portrait.status === "ready" && portrait.spec.status === "ready"
    ? "generate_question"
    : "continue_portrait";
}

async function resolveTeacherIntentForCompletedTurn(
  remoteSession: QuestionPortraitRemoteSession,
  requestedIntent: QuestionPortraitTeacherIntent,
  portrait: QuestionPortraitDocument,
  previousPortrait: QuestionPortraitDocument | null,
  teacherMessage: string,
  dialogueAssistantMessage: string,
): Promise<QuestionPortraitTeacherIntent> {
  const resolvedIntent = resolveTeacherIntent(requestedIntent, portrait);
  if (portrait.status !== "ready" || portrait.spec.status !== "ready") {
    return "continue_portrait";
  }

  try {
    const recognized = await runRemoteIntentRecognitionTurn(
      remoteSession,
      `${portrait.portrait_id}-intent-${Date.now()}`,
      buildIntentRecognitionPrompt({
        previousPortrait,
        completedPortrait: portrait,
        teacherMessage,
        dialogueAssistantMessage,
        dialogueTeacherIntent: requestedIntent,
      }),
    );
    if (recognized.confidence >= 0.55) {
      return resolveTeacherIntent(recognized.teacherIntent, portrait);
    }
  } catch {
    return resolvedIntent;
  }
  return resolvedIntent;
}

export async function createQuestionPortrait(
  ownerUid: string,
  teacherMessage = "",
  markdownPath: string | null = null,
  teacherPayload?: unknown,
): Promise<QuestionPortraitTurnResult> {
  const now = new Date().toISOString();
  const portraitId = `qportrait_${randomUUID().replace(/-/g, "")}`;
  const normalizedMessage = normalizeWhitespace(teacherMessage);
  if (!normalizedMessage) {
    throw new Error("teacherMessage is required to create a question portrait");
  }

  const promptMessage = buildPromptMessageWithAttachments(normalizedMessage, teacherPayload);
  const teacherEntry = createTeacherMessageEntry(normalizedMessage, now, teacherPayload);
  const remoteSession = await createRemoteSession(portraitId);
  const seedPortrait = createDerivedPortrait(
    portraitId,
    ownerUid,
    createEmptyDraft(),
    [teacherEntry],
    now,
    now,
    markdownPath,
    remoteSession,
    null,
  );

  const remoteReply = await runRemoteDialogueTurn(
    remoteSession,
    `${portraitId}-turn-1`,
    buildRemotePrompt(seedPortrait, promptMessage),
  );

  const nextDraft = cloneDraft(seedPortrait.draft);
  applyRemoteFieldPatch(nextDraft, remoteReply.extractedFields);

  const portrait = createDerivedPortrait(
    portraitId,
    ownerUid,
    nextDraft,
    [
      ...seedPortrait.messages,
      {
        role: "assistant",
        content: remoteReply.assistantMessage,
        created_at: now,
        payload: {
          ui_actions: {
            show_spec_form: remoteReply.uiActions.showSpecForm,
          },
        },
      },
    ],
    now,
    now,
    markdownPath,
    remoteSession,
    remoteReply.portraitState,
  );
  const teacherIntent = await resolveTeacherIntentForCompletedTurn(
    remoteSession,
    remoteReply.teacherIntent,
    portrait,
    null,
    normalizedMessage,
    remoteReply.assistantMessage,
  );

  return {
    portrait: annotateLatestAssistantIntent(portrait, teacherIntent),
    assistant_message: remoteReply.assistantMessage,
    teacher_intent: teacherIntent,
  };
}

export function createQuestionPortraitSeed(
  ownerUid: string,
  teacherMessage = "",
  markdownPath: string | null = null,
  teacherPayload?: unknown,
): QuestionPortraitTurnResult {
  const now = new Date().toISOString();
  const portraitId = `qportrait_${randomUUID().replace(/-/g, "")}`;
  const normalizedMessage = normalizeWhitespace(teacherMessage);
  if (!normalizedMessage) {
    throw new Error("teacherMessage is required to create a question portrait");
  }

  const portrait = createDerivedPortrait(
    portraitId,
    ownerUid,
    createEmptyDraft(),
    [createTeacherMessageEntry(normalizedMessage, now, teacherPayload)],
    now,
    now,
    markdownPath,
    null,
    buildPendingPortraitState(normalizedMessage),
  );

  return {
    portrait,
    assistant_message: "",
    teacher_intent: "continue_portrait",
  };
}

export async function completeQuestionPortraitTeacherReply(
  current: QuestionPortraitDocument,
  teacherMessage: string,
  teacherPayload?: unknown,
  teacherAlreadyAppended = false,
): Promise<QuestionPortraitTurnResult> {
  const message = normalizeWhitespace(teacherMessage);
  if (!message) {
    return {
      portrait: current,
      assistant_message: "请先输入老师回复。",
      teacher_intent: "continue_portrait",
    };
  }

  const now = new Date().toISOString();
  const promptMessage = buildPromptMessageWithAttachments(message, teacherPayload);
  let remoteSession = current.remote_session || await createRemoteSession(current.portrait_id);
  const buildCurrentWithTeacher = (session: QuestionPortraitRemoteSession): QuestionPortraitDocument => createDerivedPortrait(
    current.portrait_id,
    current.owner_uid,
    cloneDraft(current.draft),
    buildMessageListWithTeacher(current.messages, message, now, teacherPayload, teacherAlreadyAppended),
    current.created_at,
    now,
    current.markdown_path,
    session,
    buildCurrentPortraitState(current),
  );

  let currentWithTeacher = buildCurrentWithTeacher(remoteSession);
  let remoteReply: Awaited<ReturnType<typeof runRemoteDialogueTurn>>;
  try {
    remoteReply = await runRemoteDialogueTurn(
      remoteSession,
      `${current.portrait_id}-${Date.now()}`,
      buildRemotePrompt(currentWithTeacher, promptMessage),
    );
  } catch (error) {
    if (!current.remote_session || !isStaleRemoteSessionError(error)) {
      throw error;
    }
    remoteSession = await createRemoteSession(current.portrait_id);
    currentWithTeacher = buildCurrentWithTeacher(remoteSession);
    remoteReply = await runRemoteDialogueTurn(
      remoteSession,
      `${current.portrait_id}-${Date.now()}-retry`,
      buildRemotePrompt(currentWithTeacher, promptMessage),
    );
  }

  const nextDraft = cloneDraft(current.draft);
  applyRemoteFieldPatch(nextDraft, remoteReply.extractedFields);

  const portrait = createDerivedPortrait(
    current.portrait_id,
    current.owner_uid,
    nextDraft,
    [
      ...buildMessageListWithTeacher(current.messages, message, now, teacherPayload, teacherAlreadyAppended),
      {
        role: "assistant",
        content: remoteReply.assistantMessage,
        created_at: now,
        payload: {
          ui_actions: {
            show_spec_form: remoteReply.uiActions.showSpecForm,
          },
        },
      },
    ],
    current.created_at,
    now,
    current.markdown_path,
    remoteSession,
    remoteReply.portraitState,
  );
  const teacherIntent = await resolveTeacherIntentForCompletedTurn(
    remoteSession,
    remoteReply.teacherIntent,
    portrait,
    current,
    message,
    remoteReply.assistantMessage,
  );

  return {
    portrait: annotateLatestAssistantIntent(portrait, teacherIntent),
    assistant_message: remoteReply.assistantMessage,
    teacher_intent: teacherIntent,
  };
}

export async function applyQuestionPortraitTeacherReply(
  current: QuestionPortraitDocument,
  teacherMessage: string,
  teacherPayload?: unknown,
): Promise<QuestionPortraitTurnResult> {
  return completeQuestionPortraitTeacherReply(current, teacherMessage, teacherPayload, false);
}
