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
  QuestionPortraitDocument,
  QuestionPortraitDraft,
  QuestionPortraitGuidance,
  QuestionPortraitPendingField,
  QuestionPortraitRemoteSession,
  QuestionPortraitTurnResult,
} from "../types/question-portrait";
import { createOahSessionClient, createOahSessionClientForExistingSession } from "./oah-client";
import { getOahCoreConfig } from "./oah-config";
import { normalizeQuestionGenerationSpec } from "./question-agent-spec";

interface RemotePortraitReply {
  assistant_message?: unknown;
  extracted_fields?: unknown;
  portrait_state?: unknown;
}

interface RemotePortraitFields {
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

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePortraitStatus(value: unknown): "draft" | "ready" | "" {
  const normalized = normalizeString(value);
  if (normalized === "draft" || normalized === "ready") {
    return normalized;
  }
  return "";
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

function normalizePendingField(value: unknown): QuestionPortraitPendingField | "" {
  const normalized = normalizeString(value);
  if (
    normalized === "knowledge_point"
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
    knowledge_point: "",
    difficulty: "",
    algorithm: "",
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
  } else if (draft.content_mode === "image" && draft.image_mode === "none") {
    draft.image_mode = "required";
  }

  applyTeacherProfilePatch(draft.teacher_profile, fields.teacher_profile);
  applyStudentProfilePatch(draft.student_profile, fields.student_profile);
}

function resolvePendingFieldFromDraft(draft: QuestionPortraitDraft): QuestionPortraitPendingField {
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
  if (draft.content_mode === "image" && !draft.image_placement) {
    return "image_requirement";
  }
  if (!draft.algorithm) {
    return "algorithm";
  }
  return "none";
}

function getPendingFieldPrompt(field: QuestionPortraitPendingField): string {
  switch (field) {
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
      return "画像已齐备，可以开始出题。";
  }
}

function buildTeacherChecklist(draft: QuestionPortraitDraft): string[] {
  const checklist: string[] = [];
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
        ? "画像字段已经完整确认，可以进入出题阶段。"
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
    "# 试题画像文档",
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
    "## 画像摘要",
    "",
    document.summary || "暂无摘要",
    "",
    "## 主智能体判断",
    "",
    `- 状态说明: ${document.guidance.status_explanation || "暂无"}`,
    `- 下一步: ${document.guidance.next_step || "暂无"}`,
    `- 缺失项: ${document.guidance.missing_items.length > 0 ? document.guidance.missing_items.join(" | ") : "无"}`,
    `- 已确认清单: ${document.guidance.teacher_checklist.length > 0 ? document.guidance.teacher_checklist.join(" | ") : "无"}`,
    "",
    "## 当前画像字段",
    "",
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
    "",
    "## 最近对话",
    "",
    ...document.messages.slice(-10).map((message) => `- ${message.role}: ${message.content}`),
  ].join("\n");
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
        pending_field: "knowledge_point",
        status_explanation: "尚未收集到画像信息。",
        missing_items: ["请先确认知识点。"],
        teacher_checklist: [],
        next_step: "先追问老师要考哪个知识点。",
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
    : '{"status":"blocked","validation_errors":["portrait not ready"]}';
  const markdownBlock = document?.markdown || "(no portrait markdown yet)";

  return [
    "You are the remote Tutor question-orchestrator.",
    "This turn is only for building the question portrait with the teacher.",
    "Do not generate the actual question yet.",
    "",
    "You must decide by yourself:",
    "- which teacher-controlled fields are still missing",
    "- whether the portrait is ready for generation",
    "- what the next teacher-facing question should be",
    "",
    "Return exactly one JSON object. No markdown fences. No prose outside JSON.",
    "{",
    '  "assistant_message": "one concise teacher-facing Chinese reply",',
    '  "extracted_fields": {',
    '    "knowledge_point": "string or empty",',
    '    "difficulty": "1-6 string or empty",',
    '    "question_type": "multiple_choice | true_false | short_answer | empty",',
    '    "content_mode": "text | image | empty",',
    '    "algorithm": "direct | cot | react | dear | eqpr | evoq | empty",',
    '    "image_mode": "none | optional | required | empty",',
    '    "image_placement": "stem_image | explanation_image | option_image | empty",',
    '    "image_targets": ["stem" | "options" | "solution"],',
    '    "teacher_profile": {',
    '      "pedagogical_style": "string or omit",',
    '      "language_policy": "string or omit",',
    '      "difficulty_policy": "string or omit",',
    '      "visual_policy": "string or omit",',
    '      "constraints": ["string"]',
    "    },",
    '    "student_profile": {',
    '      "learning_preferences": ["string"],',
    '      "misconceptions": ["string"]',
    "    }",
    "  },",
    '  "portrait_state": {',
    '    "title": "short Chinese title",',
    '    "summary": "short Chinese portrait summary",',
    '    "status": "draft | ready",',
    '    "pending_field": "knowledge_point | difficulty | question_type | content_mode | algorithm | image_requirement | teacher_profile | student_profile | none",',
    '    "missing_items": ["Chinese missing item for the teacher"],',
    '    "teacher_checklist": ["Chinese confirmed item"],',
    '    "status_explanation": "Chinese explanation of why the portrait is or is not ready",',
    '    "next_step": "Chinese instruction for what the teacher should confirm next"',
    "  }",
    "}",
    "",
    "Rules:",
    "- assistant_message must be teacher-facing Chinese, concise, and conversational.",
    "- assistant_message must not contain unescaped double quotes; use Chinese quotation marks like “二次函数” for examples.",
    "- portrait_state.missing_items must be teacher-facing Chinese, not internal codes.",
    "- If a field is not explicitly confirmed by the teacher, keep it empty in extracted_fields.",
    "- Only set status to ready when the portrait can directly enter generation.",
    "- If content_mode is image, make sure image placement/targets are explicitly settled before status=ready.",
    "- Keep the portrait_state aligned with the extracted_fields and current portrait context.",
    "",
    `portrait_id: ${portraitId}`,
    "",
    "Current draft JSON:",
    draftBlock,
    "",
    "Current portrait state JSON:",
    guidanceBlock,
    "",
    "Current spec validation snapshot:",
    specBlock,
    "",
    "Current portrait markdown:",
    markdownBlock,
    "",
    "Teacher message for this turn:",
    teacherMessage || "(teacher has not provided any message yet; open the dialogue by asking for the knowledge point first)",
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
  throw new Error("Remote portrait reply did not contain a JSON object");
}

function parseRemotePortraitReply(
  text: string,
): { assistantMessage: string; extractedFields: unknown; portraitState: unknown } {
  let jsonObject = "";
  try {
    jsonObject = extractJsonObject(text);
  } catch {
    return {
      assistantMessage: text.trim(),
      extractedFields: {},
      portraitState: {},
    };
  }
  try {
    const parsed = JSON.parse(jsonObject) as RemotePortraitReply;
    const assistantMessage = normalizeString(parsed.assistant_message) || text.trim();
    return {
      assistantMessage,
      extractedFields: parsed.extracted_fields,
      portraitState: parsed.portrait_state,
    };
  } catch {
    const repaired = repairAssistantMessageJson(jsonObject);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired) as RemotePortraitReply;
        const assistantMessage = normalizeString(parsed.assistant_message) || extractAssistantMessage(text) || text.trim();
        return {
          assistantMessage,
          extractedFields: parsed.extracted_fields,
          portraitState: parsed.portrait_state,
        };
      } catch {
        // Fall through to the text-only recovery below.
      }
    }
    return {
      assistantMessage: extractAssistantMessage(text) || text.trim(),
      extractedFields: {},
      portraitState: {},
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
  const match = jsonObject.match(/"assistant_message"\s*:\s*"([\s\S]*?)"\s*,\s*"extracted_fields"\s*:/);
  return normalizeString(match?.[1]);
}

function repairAssistantMessageJson(text: string): string | null {
  const match = text.match(/("assistant_message"\s*:\s*")([\s\S]*?)("\s*,\s*"extracted_fields"\s*:)/);
  if (!match) {
    return null;
  }
  return `${text.slice(0, match.index)}"assistant_message": ${JSON.stringify(match[2])}, "extracted_fields":${text.slice((match.index || 0) + match[0].length)}`;
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
  const normalizeInput: Record<string, unknown> = {
    request_uuid: portraitId,
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

  const document: QuestionPortraitDocument = {
    portrait_id: portraitId,
    owner_uid: ownerUid,
    title: remote.title || draft.knowledge_point || "未命名试题画像",
    status: remote.status || fallback.status,
    pending_field: remote.pendingField || fallback.pendingField,
    summary: remote.summary || fallback.summary,
    guidance: {
      status_explanation: remote.statusExplanation || fallback.guidance.status_explanation,
      missing_items: remote.missingItems.length > 0 ? remote.missingItems : fallback.guidance.missing_items,
      teacher_checklist: remote.teacherChecklist.length > 0
        ? remote.teacherChecklist
        : fallback.guidance.teacher_checklist,
      next_step: remote.nextStep || fallback.guidance.next_step,
    },
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
  });
  return {
    workspace_id: client.workspaceId,
    session_id: client.sessionId,
    agent_name: client.agentName || config.agentName || "question-orchestrator",
  };
}

async function runRemoteDialogueTurn(
  remoteSession: QuestionPortraitRemoteSession,
  requestId: string,
  prompt: string,
): Promise<{ assistantMessage: string; extractedFields: unknown; portraitState: unknown }> {
  const config = getOahCoreConfig();
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
  });
  const result = await client.send(prompt);
  return parseRemotePortraitReply(result.text);
}

export async function createQuestionPortrait(
  ownerUid: string,
  teacherMessage = "",
  markdownPath: string | null = null,
): Promise<QuestionPortraitTurnResult> {
  const now = new Date().toISOString();
  const portraitId = `qportrait_${randomUUID().replace(/-/g, "")}`;
  const remoteSession = await createRemoteSession(portraitId);
  const normalizedMessage = normalizeWhitespace(teacherMessage);
  const seedPortrait = createDerivedPortrait(
    portraitId,
    ownerUid,
    createEmptyDraft(),
    normalizedMessage ? [{ role: "teacher", content: normalizedMessage, created_at: now }] : [],
    now,
    now,
    markdownPath,
    remoteSession,
    null,
  );

  const remoteReply = await runRemoteDialogueTurn(
    remoteSession,
    `${portraitId}-turn-1`,
    buildRemotePrompt(seedPortrait, normalizedMessage),
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
      },
    ],
    now,
    now,
    markdownPath,
    remoteSession,
    remoteReply.portraitState,
  );

  return {
    portrait,
    assistant_message: remoteReply.assistantMessage,
  };
}

export async function applyQuestionPortraitTeacherReply(
  current: QuestionPortraitDocument,
  teacherMessage: string,
): Promise<QuestionPortraitTurnResult> {
  const message = normalizeWhitespace(teacherMessage);
  if (!message) {
    return {
      portrait: current,
      assistant_message: "请先输入老师回复。",
    };
  }

  const now = new Date().toISOString();
  const remoteSession = current.remote_session || await createRemoteSession(current.portrait_id);
  const currentWithTeacher = createDerivedPortrait(
    current.portrait_id,
    current.owner_uid,
    cloneDraft(current.draft),
    [
      ...current.messages,
      {
        role: "teacher",
        content: message,
        created_at: now,
      },
    ],
    current.created_at,
    now,
    current.markdown_path,
    remoteSession,
    buildCurrentPortraitState(current),
  );

  const remoteReply = await runRemoteDialogueTurn(
    remoteSession,
    `${current.portrait_id}-${Date.now()}`,
    buildRemotePrompt(currentWithTeacher, message),
  );

  const nextDraft = cloneDraft(current.draft);
  applyRemoteFieldPatch(nextDraft, remoteReply.extractedFields);

  const portrait = createDerivedPortrait(
    current.portrait_id,
    current.owner_uid,
    nextDraft,
    [
      ...current.messages,
      {
        role: "teacher",
        content: message,
        created_at: now,
      },
      {
        role: "assistant",
        content: remoteReply.assistantMessage,
        created_at: now,
      },
    ],
    current.created_at,
    now,
    current.markdown_path,
    remoteSession,
    remoteReply.portraitState,
  );

  return {
    portrait,
    assistant_message: remoteReply.assistantMessage,
  };
}
