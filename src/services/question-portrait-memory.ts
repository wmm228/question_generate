import {
  AI_GEN_ALGORITHM_LABELS,
  AI_GEN_CONTENT_MODE_LABELS,
  AI_GEN_IMAGE_MODE_LABELS,
  AI_GEN_IMAGE_PLACEMENT_LABELS,
  AI_GEN_QUESTION_TYPE_LABELS,
} from "../types/ai-generate";
import type {
  QuestionPortraitDocument,
  QuestionPortraitMemory,
  QuestionPortraitMessage,
} from "../types/question-portrait";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function truncateMemoryValue(value: string, maxLength = 120): string {
  const normalized = normalizeWhitespace(value);
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function buildFallbackSummary(document: QuestionPortraitDocument): string {
  const { draft } = document;
  const parts = [
    `subject=${draft.subject || "pending"}`,
    `knowledge_point=${draft.knowledge_point || "pending"}`,
    `difficulty=${draft.difficulty || "pending"}`,
    `question_type=${draft.question_type ? AI_GEN_QUESTION_TYPE_LABELS[draft.question_type] : "pending"}`,
    `content_mode=${draft.content_mode ? AI_GEN_CONTENT_MODE_LABELS[draft.content_mode] : "pending"}`,
    `algorithm=${draft.algorithm ? AI_GEN_ALGORITHM_LABELS[draft.algorithm] : "pending"}`,
  ];
  if (draft.content_mode === "image") {
    parts.push(`image_mode=${AI_GEN_IMAGE_MODE_LABELS[draft.image_mode] || draft.image_mode}`);
    parts.push(`image_placement=${draft.image_placement ? AI_GEN_IMAGE_PLACEMENT_LABELS[draft.image_placement] : "pending"}`);
  }
  return parts.join(" | ");
}

function latestMessage(
  messages: QuestionPortraitMessage[],
  predicate: (message: QuestionPortraitMessage) => boolean,
): QuestionPortraitMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (predicate(message)) {
      return message;
    }
  }
  return null;
}

function getLatestMessageCreatedAt(messages: QuestionPortraitMessage[]): string {
  const latest = latestMessage(messages, (message) => Boolean(normalizeString(message.created_at)));
  return normalizeString(latest?.created_at);
}

function summarizeLatestGeneratedQuestion(messages: QuestionPortraitMessage[]): string {
  const latestGenerated = latestMessage(messages, (message) => message.kind === "generated_question" && isRecord(message.payload));
  if (!latestGenerated || !isRecord(latestGenerated.payload)) {
    return "";
  }
  const payload = latestGenerated.payload;
  const question = truncateMemoryValue(normalizeString(payload.question), 100);
  const groundTruth = truncateMemoryValue(normalizeString(payload.ground_truth), 40);
  if (!question && !groundTruth) {
    return "";
  }
  return `latest_generated_question=${[question, groundTruth ? `answer=${groundTruth}` : ""].filter(Boolean).join(" | ")}`;
}

function buildDialogueState(messages: QuestionPortraitMessage[]): string[] {
  const latestTeacher = latestMessage(messages, (message) => message.role === "teacher" && normalizeString(message.content) !== "");
  const latestAssistant = latestMessage(messages, (message) => (
    message.role === "assistant"
    && message.kind !== "generated_question"
    && message.kind !== "error"
    && normalizeString(message.content) !== ""
  ));
  const generatedQuestionCount = messages.filter((message) => message.kind === "generated_question").length;

  return uniqueStrings([
    `message_count=${messages.length}`,
    latestTeacher ? `latest_teacher=${truncateMemoryValue(latestTeacher.content)}` : "",
    latestAssistant ? `latest_assistant=${truncateMemoryValue(latestAssistant.content)}` : "",
    generatedQuestionCount > 0 ? `generated_question_count=${generatedQuestionCount}` : "",
    summarizeLatestGeneratedQuestion(messages),
  ]);
}

export function buildQuestionPortraitMemory(document: QuestionPortraitDocument): QuestionPortraitMemory {
  const { draft } = document;
  const messages = Array.isArray(document.messages) ? document.messages : [];
  const guidance = document.guidance || {
    status_explanation: "",
    missing_items: [],
    teacher_checklist: [],
    next_step: "",
  };
  const stableFacts = uniqueStrings([
    draft.subject ? `subject=${draft.subject}` : "",
    draft.knowledge_point ? `knowledge_point=${draft.knowledge_point}` : "",
    draft.difficulty ? `difficulty=${draft.difficulty}` : "",
    draft.question_type ? `question_type=${draft.question_type}` : "",
    draft.content_mode ? `content_mode=${draft.content_mode}` : "",
    draft.algorithm ? `algorithm=${draft.algorithm}` : "",
    draft.content_mode === "image" ? `image_mode=${draft.image_mode}` : "",
    draft.content_mode === "image" && draft.image_placement ? `image_placement=${draft.image_placement}` : "",
    ...(draft.image_targets || []).map((target) => `image_target=${target}`),
    `status=${document.status}`,
    `pending_field=${document.pending_field}`,
  ]);
  const openItems = uniqueStrings([
    ...((Array.isArray(guidance.missing_items) ? guidance.missing_items : [])),
    ...((Array.isArray(document.validation_errors) ? document.validation_errors : [])),
    guidance.next_step ? `next_step=${guidance.next_step}` : "",
  ]);
  const dialogueState = buildDialogueState(messages);
  const summary = [
    buildFallbackSummary(document),
    `status=${document.status}`,
    `pending_field=${document.pending_field}`,
    openItems.length > 0 ? `open_items=${openItems.join("；")}` : "",
    dialogueState.length > 0 ? `dialogue_state=${dialogueState.join("；")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    version: "question-portrait-memory.v1",
    summary,
    stable_facts: stableFacts,
    open_items: openItems,
    dialogue_state: dialogueState,
    updated_at: getLatestMessageCreatedAt(messages) || document.updated_at,
  };
}
