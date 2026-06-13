import fs from "fs";
import path from "path";
import zlib from "zlib";
import { randomUUID } from "crypto";

import { Router, type Request, type RequestHandler, type Response } from "express";

import { attachAiGenerateRoutes, type AiGenerateRouterDependencies } from "./ai-generate";
import type { UidResolver } from "./auth";
import {
  AI_GEN_ALGORITHMS,
  AI_GEN_ALGORITHM_LABELS,
  AI_GEN_CONTENT_MODES,
  AI_GEN_CONTENT_MODE_LABELS,
  AI_GEN_IMAGE_MODES,
  AI_GEN_IMAGE_MODE_LABELS,
  AI_GEN_IMAGE_PLACEMENTS,
  AI_GEN_IMAGE_PLACEMENT_LABELS,
  AI_GEN_IMAGE_TARGETS,
  AI_GEN_IMAGE_TARGET_LABELS,
  AI_GEN_QUESTION_TYPES,
  AI_GEN_QUESTION_TYPE_LABELS,
  normalizeAiGenPayload,
  type AiGenerateApiResponse,
  type AiGenPayload,
} from "../types/ai-generate";
import {
  buildQuestionAgentDesign,
  normalizeQuestionGenerationSpec,
  normalizeStudentProfileResponse,
  normalizeTeacherProfileResponse,
} from "../services/question-agent-spec";
import { getQuestionAgentContract, getQuestionAgentContractSourcePath } from "../services/question-agent-contract";
import { getOahCoreConfig } from "../services/oah-config";
import { resolveOahWorkspace } from "../services/oah-client";
import { getQuestionRuntimeCheck } from "../services/oah-question-runtime";
import {
  completeQuestionPortraitTeacherReply,
  createQuestionPortraitSeed,
} from "../services/question-portrait";
import { normalizeQuestionFeedbackScore, type QuestionFeedbackStore } from "../services/question-feedback-store";
import type { GeneratedQuestionSearchFilters, QuestionPortraitStore } from "../services/question-portrait-store";
import type {
  QuestionPortraitAttachment,
  QuestionPortraitDocument,
  QuestionPortraitMessageKind,
  QuestionPortraitRole,
} from "../types/question-portrait";
import { getRequestId, logEvent, serializeError } from "../utils/request";

export type AuthMiddleware = RequestHandler;

export interface QuestionAgentRouterDependencies extends AiGenerateRouterDependencies {
  getUidFromReq: UidResolver;
  portraitStore: QuestionPortraitStore;
  feedbackStore: QuestionFeedbackStore;
  staticDirectory: string;
  appRoot: string;
  workspaceRoot: string;
}

interface CatalogModelSummary {
  ref: string | null;
  name: string | null;
  provider: string | null;
  model_name: string | null;
  url: string | null;
}

const PORTRAIT_ATTACHMENT_MAX_COUNT = 4;
const PORTRAIT_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const PORTRAIT_ATTACHMENT_ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

class PortraitAttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortraitAttachmentValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequestBody(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

function normalizeStatusString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeComparableStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((item) => normalizeStatusString(item)).filter(Boolean))).sort();
}

function compareGenerationField(
  mismatches: string[],
  field: string,
  expected: unknown,
  actual: unknown,
): void {
  if (normalizeStatusString(expected) !== normalizeStatusString(actual)) {
    mismatches.push(field);
  }
}

function compareGenerationListField(
  mismatches: string[],
  field: string,
  expected: unknown,
  actual: unknown,
): void {
  const expectedList = normalizeComparableStrings(expected);
  const actualList = normalizeComparableStrings(actual);
  if (JSON.stringify(expectedList) !== JSON.stringify(actualList)) {
    mismatches.push(field);
  }
}

function readPortraitGenerationFieldMismatches(
  portrait: QuestionPortraitDocument,
  payload: AiGenPayload,
): string[] {
  const mismatches: string[] = [];
  compareGenerationField(mismatches, "subject", portrait.draft.subject || portrait.spec.subject, payload.subject);
  compareGenerationField(
    mismatches,
    "knowledge_point",
    portrait.draft.knowledge_point || portrait.spec.knowledge_point,
    payload.knowledge_point,
  );
  compareGenerationField(
    mismatches,
    "difficulty",
    portrait.draft.difficulty || String(portrait.spec.difficulty_level || ""),
    payload.difficulty,
  );
  compareGenerationField(mismatches, "algorithm", portrait.draft.algorithm || portrait.spec.algorithm, payload.algorithm);
  compareGenerationField(
    mismatches,
    "question_type",
    portrait.draft.question_type || portrait.spec.question_type,
    payload.question_type,
  );
  compareGenerationField(
    mismatches,
    "content_mode",
    portrait.draft.content_mode || portrait.spec.content_mode,
    payload.content_mode,
  );
  compareGenerationField(
    mismatches,
    "image_mode",
    portrait.draft.image_mode || portrait.spec.image_requirement.mode,
    payload.image_mode,
  );
  compareGenerationListField(
    mismatches,
    "image_targets",
    portrait.draft.image_targets.length > 0 ? portrait.draft.image_targets : portrait.spec.image_requirement.targets,
    payload.image_targets,
  );
  if (portrait.draft.content_mode === "image" && portrait.draft.image_placement) {
    compareGenerationField(mismatches, "image_placement", portrait.draft.image_placement, payload.image_placement);
  }
  return mismatches;
}

function readQueryString(req: Request, key: string): string {
  const value = req.query[key];
  if (Array.isArray(value)) {
    return normalizeStatusString(value[0]);
  }
  return normalizeStatusString(value);
}

function readQuestionLibraryFilters(req: Request): GeneratedQuestionSearchFilters {
  const limit = Number.parseInt(readQueryString(req, "limit"), 10);
  return {
    subject: readQueryString(req, "subject"),
    knowledge_point: readQueryString(req, "knowledge_point"),
    difficulty: readQueryString(req, "difficulty"),
    question_type: readQueryString(req, "question_type"),
    content_mode: readQueryString(req, "content_mode"),
    algorithm: readQueryString(req, "algorithm"),
    limit: Number.isFinite(limit) ? limit : 50,
  };
}

function createPortraitTurnId(): string {
  return `turn_${randomUUID().replace(/-/g, "")}`;
}

function estimateBase64DataUrlBytes(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(",");
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function normalizePortraitAttachments(value: unknown): QuestionPortraitAttachment[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new PortraitAttachmentValidationError("attachments must be an array");
  }
  if (value.length > PORTRAIT_ATTACHMENT_MAX_COUNT) {
    throw new PortraitAttachmentValidationError(`一次最多上传 ${PORTRAIT_ATTACHMENT_MAX_COUNT} 张图片`);
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new PortraitAttachmentValidationError("图片附件格式不正确");
    }
    const mimeType = normalizeStatusString(item.mime_type).toLowerCase();
    if (!PORTRAIT_ATTACHMENT_ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new PortraitAttachmentValidationError("只支持 PNG、JPEG、WebP 或 GIF 图片");
    }
    const dataUrl = normalizeStatusString(item.data_url);
    if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
      throw new PortraitAttachmentValidationError("图片附件 data_url 格式不正确");
    }
    const byteSize = estimateBase64DataUrlBytes(dataUrl);
    if (byteSize <= 0 || byteSize > PORTRAIT_ATTACHMENT_MAX_BYTES) {
      throw new PortraitAttachmentValidationError("单张图片不能超过 4MB");
    }
    const declaredSize = typeof item.size === "number" && Number.isFinite(item.size) && item.size > 0
      ? Math.min(Math.round(item.size), byteSize)
      : byteSize;
    return {
      id: normalizeStatusString(item.id) || `attachment_${index + 1}`,
      name: normalizeStatusString(item.name) || `image-${index + 1}`,
      mime_type: mimeType,
      size: declaredSize,
      data_url: dataUrl,
    };
  });
}

function buildPortraitTeacherPayload(
  attachments: QuestionPortraitAttachment[],
  waitingForReply = false,
): { attachments?: QuestionPortraitAttachment[]; reply_pending?: boolean; submitted_at?: string; turn_id?: string } | undefined {
  if (attachments.length === 0 && !waitingForReply) {
    return undefined;
  }
  return {
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(waitingForReply ? { reply_pending: true, submitted_at: new Date().toISOString(), turn_id: createPortraitTurnId() } : {}),
  };
}

function defaultTeacherMessageForAttachments(attachments: QuestionPortraitAttachment[]): string {
  return attachments.length > 0 ? "请参考我上传的图片/截图继续处理。" : "";
}

function createTeacherHistoryMessage(
  content: string,
  payload: { attachments?: QuestionPortraitAttachment[]; reply_pending?: boolean; submitted_at?: string; turn_id?: string } | undefined,
) {
  return {
    role: "teacher" as const,
    content,
    created_at: new Date().toISOString(),
    ...(payload ? { payload } : {}),
  };
}

function createTeacherSafeErrorMessage(actionLabel: string): string {
  return `${actionLabel}失败，请稍后重试。`;
}

function createAssistantErrorHistoryMessage(content: string, turnId = "") {
  return {
    role: "assistant" as const,
    kind: "error" as const,
    content,
    created_at: new Date().toISOString(),
    ...(turnId ? { payload: { error_for_turn_id: turnId, requires_latest_pending_turn_id: turnId } } : {}),
  };
}

function readPortraitTurnId(payload: unknown): string {
  return isRecord(payload) ? normalizeStatusString(payload.turn_id) : "";
}

function clearPortraitTeacherPendingPayload(payload: unknown, turnId: string): unknown {
  if (!isRecord(payload) || readPortraitTurnId(payload) !== turnId) {
    return payload;
  }
  return {
    ...payload,
    reply_pending: false,
    completed_at: new Date().toISOString(),
  };
}

function clearCompletedPortraitTurnPending(
  portrait: QuestionPortraitDocument,
  turnId: string,
): QuestionPortraitDocument {
  return {
    ...portrait,
    messages: (Array.isArray(portrait.messages) ? portrait.messages : []).map((message) => (
      message.role === "teacher"
        ? { ...message, payload: clearPortraitTeacherPendingPayload(message.payload, turnId) }
        : message
    )),
  };
}

async function completePortraitReplyInBackground(
  deps: QuestionAgentRouterDependencies,
  req: Request,
  ownerUid: string,
  sourcePortrait: QuestionPortraitDocument,
  teacherMessage: string,
  teacherPayload: { attachments?: QuestionPortraitAttachment[]; reply_pending?: boolean; submitted_at?: string; turn_id?: string } | undefined,
): Promise<void> {
  const turnId = readPortraitTurnId(teacherPayload);
  try {
    const turn = await completeQuestionPortraitTeacherReply(sourcePortrait, teacherMessage, teacherPayload, true);
    const saved = await deps.portraitStore.saveIfLatestPendingTurn(
      ownerUid,
      sourcePortrait.portrait_id,
      turnId,
      clearCompletedPortraitTurnPending(turn.portrait, turnId),
    );
    if (!saved) {
      logEvent("info", req, "question_agent.portrait.background_reply_ignored_stale", {
        portrait_id: sourcePortrait.portrait_id,
        owner_uid: ownerUid,
        turn_id: turnId,
      });
      return;
    }
    logEvent("info", req, "question_agent.portrait.background_reply_completed", {
      portrait_id: saved.portrait_id,
      owner_uid: ownerUid,
      turn_id: turnId,
      spec_status: saved.spec.status,
      pending_field: saved.pending_field,
    });
  } catch (error) {
    logEvent("error", req, "question_agent.portrait.background_reply_failed", {
      portrait_id: sourcePortrait.portrait_id,
      owner_uid: ownerUid,
      error: serializeError(error),
    });
    if (turnId) {
      await deps.portraitStore.appendMessage(ownerUid, sourcePortrait.portrait_id, createAssistantErrorHistoryMessage(
        createTeacherSafeErrorMessage("处理出题回复"),
        turnId,
      )).catch((historyError: unknown) => {
        logEvent("error", req, "question_agent.portrait.background_failure_history_failed", {
          portrait_id: sourcePortrait.portrait_id,
          owner_uid: ownerUid,
          error: serializeError(historyError),
        });
      });
    }
  }
}

function normalizePortraitHistoryRole(value: unknown): QuestionPortraitRole {
  return normalizeStatusString(value) === "teacher" ? "teacher" : "assistant";
}

function normalizePortraitHistoryKind(value: unknown): QuestionPortraitMessageKind {
  const normalized = normalizeStatusString(value);
  if (
    normalized === "generated_question"
    || normalized === "notice"
    || normalized === "error"
    || normalized === "text"
  ) {
    return normalized;
  }
  return "text";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type PortraitExportFormat = "word" | "pdf" | "excel";

function normalizePortraitExportFormat(value: unknown): PortraitExportFormat {
  const normalized = normalizeStatusString(value).toLowerCase();
  if (normalized === "pdf" || normalized === "excel" || normalized === "xlsx" || normalized === "xls") {
    return normalized === "pdf" ? "pdf" : "excel";
  }
  return "word";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function removeInvalidXmlControlCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d || codePoint >= 0x20;
  }).join("");
}

function escapeXml(value: string): string {
  return removeInvalidXmlControlCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPortraitExportLines(portrait: QuestionPortraitDocument): string[] {
  const lines = [
    `试题描述规范：${portrait.title}`,
    `portrait_id: ${portrait.portrait_id}`,
    `status: ${portrait.status}`,
    `spec_status: ${portrait.spec.status}`,
    "",
    "【当前规范】",
    portrait.markdown || "暂无规范文档。",
    "",
    "【历史对话】",
  ];
  if (portrait.messages.length === 0) {
    lines.push("暂无历史对话。");
  }
  for (const message of portrait.messages) {
    if (message.kind === "generated_question") {
      lines.push(`${message.role}: 已生成题目，请在出题结果区域导出。`);
      continue;
    }
    lines.push(`${message.role}: ${message.content || ""}`);
  }
  return lines;
}

function buildWordExport(portrait: QuestionPortraitDocument): Buffer {
  const body = buildPortraitExportLines(portrait)
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : "<p>&nbsp;</p>")
    .join("\n");
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(portrait.title)}</title></head><body>${body}</body></html>`, "utf-8");
}

function buildExcelExport(portrait: QuestionPortraitDocument): Buffer {
  const rows = buildPortraitExportLines(portrait)
    .map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line)}</td></tr>`)
    .join("\n");
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"></head><body><table>${rows}</table></body></html>`, "utf-8");
}

function utf16BeHex(value: string): string {
  const source = Buffer.from(value, "utf16le");
  for (let index = 0; index + 1 < source.length; index += 2) {
    const left = source[index];
    source[index] = source[index + 1];
    source[index + 1] = left;
  }
  return source.toString("hex").toUpperCase();
}

function wrapPdfLine(line: string, width = 38): string[] {
  if (!line) {
    return [""];
  }
  const chunks: string[] = [];
  for (let index = 0; index < line.length; index += width) {
    chunks.push(line.slice(index, index + width));
  }
  return chunks;
}

function buildPdfExport(portrait: QuestionPortraitDocument): Buffer {
  const lines = buildPortraitExportLines(portrait).flatMap((line) => wrapPdfLine(line));
  const linesPerPage = 48;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push(["暂无内容。"]);
  }

  const objects: string[] = [];
  const addObject = (body: string): number => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("pending");
  const pagesId = addObject("pending");
  const fontId = addObject("pending");
  const cidFontId = addObject("pending");
  const pageIds: number[] = [];
  const contentIds: number[] = [];

  for (const pageLines of pages) {
    const content = [
      "BT",
      "/F1 10 Tf",
      "50 780 Td",
      "14 TL",
      ...pageLines.map((line) => `<${utf16BeHex(line)}> Tj T*`),
      "ET",
    ].join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    const pageId = addObject("pending");
    contentIds.push(contentId);
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[fontId - 1] = `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontId} 0 R] >>`;
  objects[cidFontId - 1] = "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> >>";
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function sendPortraitExport(res: Response, portrait: QuestionPortraitDocument, format: PortraitExportFormat): void {
  const extension = format === "pdf" ? "pdf" : format === "excel" ? "xls" : "doc";
  const contentType = format === "pdf"
    ? "application/pdf"
    : format === "excel"
      ? "application/vnd.ms-excel; charset=utf-8"
      : "application/msword; charset=utf-8";
  const buffer = format === "pdf"
    ? buildPdfExport(portrait)
    : format === "excel"
      ? buildExcelExport(portrait)
      : buildWordExport(portrait);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${portrait.portrait_id}.${extension}"`);
  res.send(buffer);
}

interface EmbeddedQuestionImage {
  label: string;
  dataUri: string;
}

interface PdfImageData {
  width: number;
  height: number;
  colorSpace: "/DeviceRGB";
  filter: "/FlateDecode" | "/DCTDecode";
  data: Buffer;
}

interface DocxImageData {
  relId: string;
  fileName: string;
  contentType: string;
  data: Buffer;
  label: string;
  width: number;
  height: number;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  compress?: boolean;
}

const GENERATED_VISUALS_ROUTE_PREFIX = "/output/ai-generated-visuals/";
const EMBEDDED_IMAGE_DATA_URI_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[\s\S]+$/i;

function isGeneratedQuestionPayload(value: unknown): value is AiGenerateApiResponse {
  return isRecord(value)
    && typeof value.question === "string"
    && Array.isArray(value.options)
    && Array.isArray(value.solution_steps)
    && typeof value.ground_truth === "string";
}

function latestGeneratedQuestion(
  portrait: QuestionPortraitDocument,
  requestId: string,
): { requestId: string; result: AiGenerateApiResponse } | null {
  for (let index = portrait.messages.length - 1; index >= 0; index -= 1) {
    const message = portrait.messages[index];
    if (message.kind !== "generated_question" || !isGeneratedQuestionPayload(message.payload)) {
      continue;
    }
    const messageRequestId = normalizeStatusString(message.request_id);
    if (requestId && messageRequestId !== requestId) {
      continue;
    }
    return {
      requestId: messageRequestId || requestId || `generated-${index + 1}`,
      result: message.payload,
    };
  }
  return null;
}

function readGeneratedImageSrc(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const src = value.trim();
  if (!src) {
    return "";
  }
  if (EMBEDDED_IMAGE_DATA_URI_PATTERN.test(src)) {
    return src;
  }
  if (src.startsWith(GENERATED_VISUALS_ROUTE_PREFIX)) {
    return src;
  }
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(src) && src.length > 128) {
    return `data:image/png;base64,${src.replace(/\s+/g, "")}`;
  }
  return "";
}

function readStructuredImageUrl(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return readGeneratedImageSrc(value.url)
    || readGeneratedImageSrc(value.src)
    || readGeneratedImageSrc(value.href)
    || readGeneratedImageSrc(value.data_uri)
    || readGeneratedImageSrc(value.dataUrl)
    || readGeneratedImageSrc(value.base64)
    || readGeneratedImageSrc(value.path)
    || readGeneratedImageSrc(value.image_url)
    || readGeneratedImageSrc(value.imageUrl)
    || readGeneratedImageSrc(value.image_path)
    || readGeneratedImageSrc(value.imagePath);
}

function readOptionImageMap(result: AiGenerateApiResponse): Map<string, string> {
  const resolved = new Map<string, string>();
  const appendRecord = (value: unknown): void => {
    if (!isRecord(value)) {
      return;
    }
    for (const [key, imageValue] of Object.entries(value)) {
      const src = readGeneratedImageSrc(imageValue);
      if (src) {
        resolved.set(key, src);
      }
    }
  };
  appendRecord(result.option_images);
  appendRecord(result.assets?.option_images);
  if (Array.isArray(result.content?.options)) {
    for (const option of result.content.options) {
      const key = normalizeStatusString(option?.key);
      const src = readStructuredImageUrl(option?.image);
      if (key && src && !resolved.has(key)) {
        resolved.set(key, src);
      }
    }
  }
  return resolved;
}

function collectQuestionImages(result: AiGenerateApiResponse): Array<{ label: string; src: string }> {
  const images: Array<{ label: string; src: string }> = [];
  const stemImage = readGeneratedImageSrc(result.stem_image)
    || readGeneratedImageSrc(result.assets?.stem_image)
    || readStructuredImageUrl(result.content?.stem?.image);
  const explanationImage = readGeneratedImageSrc(result.explanation_image)
    || readGeneratedImageSrc(result.assets?.explanation_image)
    || readStructuredImageUrl(result.content?.solution?.image);
  if (stemImage) {
    images.push({ label: "题干配图", src: stemImage });
  }
  if (explanationImage) {
    images.push({ label: "解析配图", src: explanationImage });
  }
  for (const [key, src] of readOptionImageMap(result)) {
    images.push({ label: `选项 ${key} 配图`, src });
  }
  return images;
}

function stripOptionPrefix(value: string): string {
  const normalized = normalizeStatusString(value);
  return normalized.replace(/^[A-D]\s*[.、:：)]\s*/, "").trim() || normalized;
}

function buildQuestionExportLines(result: AiGenerateApiResponse): string[] {
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
  ];
}

function dataUriFromBuffer(mime: string, buffer: Buffer): string {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

function decodeDataUri(src: string): { mime: string; data: Buffer } | null {
  const match = src.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) {
    return null;
  }
  return {
    mime: match[1],
    data: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
  };
}

function contentTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".svg") {
    return "image/svg+xml";
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveLocalImagePath(
  src: string,
  deps: Pick<QuestionAgentRouterDependencies, "staticDirectory" | "appRoot" | "workspaceRoot">,
): string | null {
  const normalized = src.split(/[?#]/)[0];
  if (!normalized.startsWith(GENERATED_VISUALS_ROUTE_PREFIX)) {
    return null;
  }
  let routePath: string;
  try {
    routePath = decodeURIComponent(normalized);
  } catch {
    return null;
  }
  if (!routePath.startsWith(GENERATED_VISUALS_ROUTE_PREFIX)) {
    return null;
  }
  const relativeVisualPath = routePath.slice(GENERATED_VISUALS_ROUTE_PREFIX.length);
  const roots = [
    path.resolve(deps.appRoot, "output", "ai-generated-visuals"),
    path.resolve(deps.workspaceRoot, "output", "ai-generated-visuals"),
  ];
  for (const rawRoot of roots) {
    const root = fs.existsSync(rawRoot) ? fs.realpathSync(rawRoot) : rawRoot;
    const candidate = path.resolve(root, relativeVisualPath);
    if (!isPathInside(root, candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      continue;
    }
    const realCandidate = fs.realpathSync(candidate);
    if (!isPathInside(root, realCandidate)) {
      continue;
    }
    return realCandidate;
  }
  return null;
}

function embedImageSrc(
  src: string,
  deps: Pick<QuestionAgentRouterDependencies, "staticDirectory" | "appRoot" | "workspaceRoot">,
): string | null {
  const dataUri = decodeDataUri(src);
  if (dataUri) {
    return src;
  }
  const localPath = resolveLocalImagePath(src, deps);
  if (localPath) {
    return dataUriFromBuffer(contentTypeFromPath(localPath), fs.readFileSync(localPath));
  }
  return null;
}

function collectEmbeddedQuestionImages(
  result: AiGenerateApiResponse,
  deps: Pick<QuestionAgentRouterDependencies, "staticDirectory" | "appRoot" | "workspaceRoot">,
): EmbeddedQuestionImage[] {
  const images = collectQuestionImages(result).map((image) => ({
    label: image.label,
    dataUri: embedImageSrc(image.src, deps),
  }));
  return images.filter((image): image is EmbeddedQuestionImage => Boolean(image.dataUri));
}

function buildQuestionExcelExport(result: AiGenerateApiResponse, images: EmbeddedQuestionImage[]): Buffer {
  const rows = buildQuestionExportLines(result)
    .map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line)}</td></tr>`)
    .join("\n");
  const imageRows = images.map((image) => `
    <tr><td>${escapeHtml(image.label)}</td><td><img src="${image.dataUri}" style="max-width:480px;height:auto"></td></tr>
  `).join("\n");
  return Buffer.from(`<!doctype html><html><head><meta charset="utf-8"></head><body><table>${rows}${imageRows}</table></body></html>`, "utf-8");
}

function parseJpegDimensions(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    const length = data.readUInt16BE(offset + 2);
    if (marker >= 0xC0 && marker <= 0xC3) {
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) {
    return left;
  }
  return pb <= pc ? up : upLeft;
}

function parsePngImage(data: Buffer): PdfImageData | null {
  if (data.length < 33 || data.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString("ascii", offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === "IDAT") {
      idatChunks.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset += length + 12;
  }
  if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    return null;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgb = Buffer.alloc(width * height * 3);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let inputOffset = 0;
  let outputOffset = 0;
  const bpp = channels;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    inflated.copy(current, 0, inputOffset, inputOffset + stride);
    inputOffset += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? current[x - bpp] : 0;
      const up = previous[x] || 0;
      const upLeft = x >= bpp ? previous[x - bpp] : 0;
      if (filter === 1) {
        current[x] = (current[x] + left) & 0xFF;
      } else if (filter === 2) {
        current[x] = (current[x] + up) & 0xFF;
      } else if (filter === 3) {
        current[x] = (current[x] + Math.floor((left + up) / 2)) & 0xFF;
      } else if (filter === 4) {
        current[x] = (current[x] + paethPredictor(left, up, upLeft)) & 0xFF;
      }
    }
    for (let x = 0; x < width; x += 1) {
      const pixel = x * channels;
      rgb[outputOffset] = current[pixel];
      rgb[outputOffset + 1] = current[pixel + 1];
      rgb[outputOffset + 2] = current[pixel + 2];
      outputOffset += 3;
    }
    current.copy(previous);
  }
  return {
    width,
    height,
    colorSpace: "/DeviceRGB",
    filter: "/FlateDecode",
    data: zlib.deflateSync(rgb),
  };
}

function parsePdfImage(dataUri: string): PdfImageData | null {
  const decoded = decodeDataUri(dataUri);
  if (!decoded) {
    return null;
  }
  if (decoded.mime === "image/jpeg" || decoded.mime === "image/jpg") {
    const dimensions = parseJpegDimensions(decoded.data);
    return dimensions
      ? {
        ...dimensions,
        colorSpace: "/DeviceRGB",
        filter: "/DCTDecode",
        data: decoded.data,
      }
      : null;
  }
  if (decoded.mime === "image/png") {
    return parsePngImage(decoded.data);
  }
  return null;
}

let crc32Table: number[] | null = null;

function getCrc32Table(): number[] {
  if (crc32Table) {
    return crc32Table;
  }
  crc32Table = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
  });
  return crc32Table;
}

function crc32(data: Buffer): number {
  const table = getCrc32Table();
  let crc = 0xFFFFFFFF;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function getZipDosTime(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function buildZip(entries: ZipEntry[]): Buffer {
  const fileChunks: Buffer[] = [];
  const centralDirectoryChunks: Buffer[] = [];
  let offset = 0;
  const { dosDate, dosTime } = getZipDosTime(new Date());

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const compressed = entry.compress === false ? data : zlib.deflateRawSync(data);
    const compressionMethod = entry.compress === false ? 0 : 8;
    const checksum = crc32(data);
    const localHeaderOffset = offset;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    fileChunks.push(localHeader, name, compressed);
    offset += localHeader.length + name.length + compressed.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localHeaderOffset, 42);
    centralDirectoryChunks.push(centralHeader, name);
  }

  const centralDirectory = Buffer.concat(centralDirectoryChunks);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054B50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...fileChunks, centralDirectory, endOfCentralDirectory]);
}

function normalizeDocxImageContentType(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function docxImageExtension(contentType: string): string {
  if (contentType === "image/jpeg") {
    return "jpg";
  }
  if (contentType === "image/gif") {
    return "gif";
  }
  if (contentType === "image/webp") {
    return "webp";
  }
  if (contentType === "image/svg+xml") {
    return "svg";
  }
  return "png";
}

function readPngDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

function readGifDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 10 || (data.toString("ascii", 0, 6) !== "GIF87a" && data.toString("ascii", 0, 6) !== "GIF89a")) {
    return null;
  }
  return {
    width: data.readUInt16LE(6),
    height: data.readUInt16LE(8),
  };
}

function readWebpDimensions(data: Buffer): { width: number; height: number } | null {
  if (data.length < 30 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const format = data.toString("ascii", 12, 16);
  if (format === "VP8X") {
    return {
      width: data.readUIntLE(24, 3) + 1,
      height: data.readUIntLE(27, 3) + 1,
    };
  }
  if (format === "VP8 ") {
    return {
      width: data.readUInt16LE(26) & 0x3FFF,
      height: data.readUInt16LE(28) & 0x3FFF,
    };
  }
  if (format === "VP8L" && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return {
      width: (bits & 0x3FFF) + 1,
      height: ((bits >> 14) & 0x3FFF) + 1,
    };
  }
  return null;
}

function readSvgDimensions(data: Buffer): { width: number; height: number } | null {
  const svg = data.toString("utf8", 0, Math.min(data.length, 4096));
  const width = Number.parseFloat(svg.match(/\bwidth=["']([0-9.]+)/i)?.[1] || "");
  const height = Number.parseFloat(svg.match(/\bheight=["']([0-9.]+)/i)?.[1] || "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  const viewBox = svg.match(/\bviewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)/i);
  const viewBoxWidth = Number.parseFloat(viewBox?.[1] || "");
  const viewBoxHeight = Number.parseFloat(viewBox?.[2] || "");
  if (Number.isFinite(viewBoxWidth) && Number.isFinite(viewBoxHeight) && viewBoxWidth > 0 && viewBoxHeight > 0) {
    return { width: viewBoxWidth, height: viewBoxHeight };
  }
  return null;
}

function readDocxImageDimensions(contentType: string, data: Buffer): { width: number; height: number } {
  const dimensions = contentType === "image/png"
    ? readPngDimensions(data)
    : contentType === "image/jpeg"
      ? parseJpegDimensions(data)
      : contentType === "image/gif"
        ? readGifDimensions(data)
        : contentType === "image/webp"
          ? readWebpDimensions(data)
          : contentType === "image/svg+xml"
            ? readSvgDimensions(data)
            : null;
  return dimensions || { width: 640, height: 360 };
}

function buildDocxImages(images: EmbeddedQuestionImage[]): DocxImageData[] {
  const docxImages: DocxImageData[] = [];
  images.forEach((image) => {
    const decoded = decodeDataUri(image.dataUri);
    if (!decoded) {
      return;
    }
    const contentType = normalizeDocxImageContentType(decoded.mime);
    const extension = docxImageExtension(contentType);
    const dimensions = readDocxImageDimensions(contentType, decoded.data);
    const index = docxImages.length + 1;
    docxImages.push({
      relId: `rId${index}`,
      fileName: `image${index}.${extension}`,
      contentType,
      data: decoded.data,
      label: image.label,
      width: dimensions.width,
      height: dimensions.height,
    });
  });
  return docxImages;
}

function docxParagraph(value: string): string {
  if (!value) {
    return "<w:p/>";
  }
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;
}

function docxImageSize(width: number, height: number): { cx: number; cy: number } {
  const emuPerPixel = 9525;
  const sourceWidth = Math.max(1, width);
  const sourceHeight = Math.max(1, height);
  const rawCx = sourceWidth * emuPerPixel;
  const rawCy = sourceHeight * emuPerPixel;
  const maxCx = 5_700_000;
  const maxCy = 5_900_000;
  const scale = Math.min(maxCx / rawCx, maxCy / rawCy, 1);
  return {
    cx: Math.max(1, Math.floor(rawCx * scale)),
    cy: Math.max(1, Math.floor(rawCy * scale)),
  };
}

function docxImageParagraph(image: DocxImageData, index: number): string {
  const { cx, cy } = docxImageSize(image.width, image.height);
  const docPrId = index + 1;
  return `
<w:p>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="${cx}" cy="${cy}"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="${docPrId}" name="${escapeXml(image.fileName)}" descr="${escapeXml(image.label)}"/>
        <wp:cNvGraphicFramePr>
          <a:graphicFrameLocks noChangeAspect="1"/>
        </wp:cNvGraphicFramePr>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr>
                <pic:cNvPr id="${docPrId}" name="${escapeXml(image.fileName)}"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${escapeXml(image.relId)}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="${cx}" cy="${cy}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`;
}

function docxXmlEntry(name: string, xml: string): ZipEntry {
  return {
    name,
    data: Buffer.from(xml, "utf8"),
  };
}

function buildDocxContentTypes(images: DocxImageData[]): string {
  const imageDefaults = new Map<string, string>();
  images.forEach((image) => {
    imageDefaults.set(docxImageExtension(image.contentType), image.contentType);
  });
  const imageDefaultXml = Array.from(imageDefaults.entries())
    .map(([extension, contentType]) => `<Default Extension="${escapeXml(extension)}" ContentType="${escapeXml(contentType)}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${imageDefaultXml}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function buildQuestionDocxExport(result: AiGenerateApiResponse, images: EmbeddedQuestionImage[]): Buffer {
  const docxImages = buildDocxImages(images);
  const textParagraphs = buildQuestionExportLines(result)
    .flatMap((line) => line.split(/\r?\n/))
    .map((line) => docxParagraph(line))
    .join("\n");
  const imageParagraphs = docxImages
    .map((image, index) => `${docxParagraph(image.label)}${docxImageParagraph(image, index)}`)
    .join("\n");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${textParagraphs}
    ${imageParagraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  const relationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const documentRelationshipsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${docxImages.map((image) => `<Relationship Id="${escapeXml(image.relId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escapeXml(image.fileName)}"/>`).join("\n  ")}
</Relationships>`;
  const now = new Date().toISOString();
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Question Export</dc:title>
  <dc:creator>Tutor</dc:creator>
  <cp:lastModifiedBy>Tutor</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
  const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Tutor</Application>
</Properties>`;
  return buildZip([
    docxXmlEntry("[Content_Types].xml", buildDocxContentTypes(docxImages)),
    docxXmlEntry("_rels/.rels", relationshipsXml),
    docxXmlEntry("docProps/core.xml", coreXml),
    docxXmlEntry("docProps/app.xml", appXml),
    docxXmlEntry("word/document.xml", documentXml),
    docxXmlEntry("word/_rels/document.xml.rels", documentRelationshipsXml),
    ...docxImages.map((image): ZipEntry => ({
      name: `word/media/${image.fileName}`,
      data: image.data,
      compress: false,
    })),
  ]);
}

function buildQuestionPdfExport(result: AiGenerateApiResponse, images: EmbeddedQuestionImage[]): Buffer {
  const lines = buildQuestionExportLines(result).flatMap((line) => wrapPdfLine(line));
  const objects: Buffer[] = [];
  const addObject = (body: string | Buffer): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return objects.length;
  };
  const catalogId = addObject("pending");
  const pagesId = addObject("pending");
  const fontId = addObject("pending");
  const cidFontId = addObject("pending");
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  const imageObjectIds: Array<{ name: string; id: number; width: number; height: number; label: string }> = [];
  images.forEach((image, index) => {
    const parsed = parsePdfImage(image.dataUri);
    if (!parsed) {
      return;
    }
    const imageId = addObject(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${parsed.width} /Height ${parsed.height} /ColorSpace ${parsed.colorSpace} /BitsPerComponent 8 /Filter ${parsed.filter} /Length ${parsed.data.length} >>\nstream\n`, "latin1"),
      parsed.data,
      Buffer.from("\nendstream", "latin1"),
    ]));
    imageObjectIds.push({ name: `Im${index + 1}`, id: imageId, width: parsed.width, height: parsed.height, label: image.label });
  });

  const textContent = [
    "BT",
    "/F1 10 Tf",
    "50 780 Td",
    "14 TL",
    ...lines.slice(0, 48).map((line) => `<${utf16BeHex(line)}> Tj T*`),
    "ET",
  ].join("\n");
  const textContentId = addObject(`<< /Length ${Buffer.byteLength(textContent, "latin1")} >>\nstream\n${textContent}\nendstream`);
  const textPageId = addObject("pending");
  pageIds.push(textPageId);
  contentIds.push(textContentId);

  imageObjectIds.forEach((image) => {
    const maxWidth = 495;
    const maxHeight = 650;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
    const drawWidth = Math.max(1, Math.floor(image.width * scale));
    const drawHeight = Math.max(1, Math.floor(image.height * scale));
    const content = [
      "BT",
      "/F1 12 Tf",
      "50 800 Td",
      `<${utf16BeHex(image.label)}> Tj`,
      "ET",
      "q",
      `${drawWidth} 0 0 ${drawHeight} 50 ${760 - drawHeight} cm`,
      `/${image.name} Do`,
      "Q",
    ].join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    const pageId = addObject("pending");
    pageIds.push(pageId);
    contentIds.push(contentId);
  });

  objects[catalogId - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "latin1");
  objects[pagesId - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "latin1");
  objects[fontId - 1] = Buffer.from(`<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFontId} 0 R] >>`, "latin1");
  objects[cidFontId - 1] = Buffer.from("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> >>", "latin1");
  pageIds.forEach((pageId, index) => {
    const imageResources = imageObjectIds.map((image) => `/${image.name} ${image.id} 0 R`).join(" ");
    objects[pageId - 1] = Buffer.from(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> /XObject << ${imageResources} >> >> /Contents ${contentIds[index]} 0 R >>`, "latin1");
  });

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1"));
  });
  const beforeXref = Buffer.concat(chunks);
  const xrefOffset = beforeXref.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.concat([beforeXref, Buffer.from(xref, "latin1")]);
}

function sendQuestionExport(
  res: Response,
  result: AiGenerateApiResponse,
  requestId: string,
  format: PortraitExportFormat,
  deps: Pick<QuestionAgentRouterDependencies, "staticDirectory" | "appRoot" | "workspaceRoot">,
): void {
  const images = collectEmbeddedQuestionImages(result, deps);
  const extension = format === "pdf" ? "pdf" : format === "excel" ? "xls" : "docx";
  const contentType = format === "pdf"
    ? "application/pdf"
    : format === "excel"
      ? "application/vnd.ms-excel; charset=utf-8"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const buffer = format === "pdf"
    ? buildQuestionPdfExport(result, images)
    : format === "excel"
      ? buildQuestionExcelExport(result, images)
      : buildQuestionDocxExport(result, images);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${requestId || "question"}.${extension}"`);
  res.send(buffer);
}

function isOahWorkerUnavailableError(error: unknown): boolean {
  return getErrorMessage(error).includes("no execution worker is available for runs");
}

function sendPortraitDialogueError(res: Response, error: unknown, fallbackMessage: string): void {
  if (isOahWorkerUnavailableError(error)) {
    res.status(503).json({
      error: "AI 出题执行 Worker 当前不可用",
      code: "AI_GENERATE_WORKER_UNAVAILABLE",
      details: getErrorMessage(error),
      hint: "OAH API 可以访问，但当前没有可执行 run 的 Worker。请先启动或恢复 OAH Worker，再重新发送出题请求。",
    });
    return;
  }

  res.status(500).json({
    error: fallbackMessage,
    details: getErrorMessage(error),
  });
}

function readRequiredUid(req: Request, res: Response, deps: QuestionAgentRouterDependencies): string | null {
  const uid = deps.getUidFromReq(req);
  if (!uid) {
    res.status(401).json({ error: "Authentication required or session expired" });
    return null;
  }
  return uid;
}

function summarizeCatalogModels(models: unknown): CatalogModelSummary[] {
  if (!Array.isArray(models)) {
    return [];
  }

  return models
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      return {
        ref: normalizeStatusString(entry.ref) || null,
        name: normalizeStatusString(entry.name) || null,
        provider: normalizeStatusString(entry.provider) || null,
        model_name: normalizeStatusString(entry.modelName) || null,
        url: normalizeStatusString(entry.url) || null,
      };
    })
    .filter((entry): entry is CatalogModelSummary => entry !== null);
}

function buildOahStatusDiagnosis(
  config: ReturnType<typeof getOahCoreConfig>,
  catalogModels: CatalogModelSummary[],
): {
  configured_model_ref: string | null;
  uses_workspace_default_model: boolean;
  configured_model_url: string | null;
  fallback_enabled: boolean;
  available_models: CatalogModelSummary[];
  summary: string;
  hint: string;
} {
  const configuredModelRef = config.model || null;
  const usesWorkspaceDefaultModel = !configuredModelRef;
  const configuredModel = configuredModelRef
    ? catalogModels.find((entry) => entry.ref === configuredModelRef) || null
    : null;

  return {
    configured_model_ref: configuredModelRef,
    uses_workspace_default_model: usesWorkspaceDefaultModel,
    configured_model_url: configuredModel?.url || null,
    fallback_enabled: normalizeStatusString(process.env.OAH_MODEL_FALLBACK_ENABLED).toLowerCase() === "true",
    available_models: catalogModels,
    summary: usesWorkspaceDefaultModel
      ? "当前 Tutor 没有显式配置 OAH_MODEL_NAME，实际运行会使用 OAH workspace 的默认模型。"
      : `当前 Tutor 显式配置的 modelRef 为 ${configuredModelRef}。`,
    hint: usesWorkspaceDefaultModel
      ? "如果默认模型不可用，请先查看 available_models，再把可用的 modelRef 写入 Tutor .env 的 OAH_MODEL_NAME。"
      : "如果当前模型不可用，请确认该 modelRef 存在于 OAH catalog 中，并且其上游模型 API 可连通。",
  };
}

export function createQuestionAgentRouter(deps: QuestionAgentRouterDependencies): Router {
  const router = Router();

  router.get("/client-config", deps.requireAuth, (req: Request, res: Response) => {
    logEvent("info", req, "question_agent.client_config.requested");
    res.json({
      algorithms: AI_GEN_ALGORITHMS,
      algorithm_labels: AI_GEN_ALGORITHM_LABELS,
      question_types: AI_GEN_QUESTION_TYPES,
      question_type_labels: AI_GEN_QUESTION_TYPE_LABELS,
      content_modes: AI_GEN_CONTENT_MODES,
      content_mode_labels: AI_GEN_CONTENT_MODE_LABELS,
      image_modes: AI_GEN_IMAGE_MODES,
      image_mode_labels: AI_GEN_IMAGE_MODE_LABELS,
      image_placements: AI_GEN_IMAGE_PLACEMENTS,
      image_placement_labels: AI_GEN_IMAGE_PLACEMENT_LABELS,
      image_targets: AI_GEN_IMAGE_TARGETS,
      image_target_labels: AI_GEN_IMAGE_TARGET_LABELS,
    });
  });

  router.get("/library/questions", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = deps.getUidFromReq(req);
    if (!ownerUid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const filters = readQuestionLibraryFilters(req);
    try {
      const questions = (await deps.portraitStore.searchGeneratedQuestions(ownerUid, filters))
        .filter((item) => isGeneratedQuestionPayload(item.result))
        .map((item) => ({
          question_id: item.question_id,
          portrait_id: item.portrait_id,
          request_id: item.request_id,
          subject: item.subject,
          knowledge_point: item.knowledge_point,
          difficulty: item.difficulty,
          question_type: item.question_type,
          content_mode: item.content_mode,
          algorithm: item.algorithm,
          created_at: item.created_at,
          updated_at: item.updated_at,
          result: item.result,
        }));
      logEvent("info", req, "question_agent.library.questions_searched", {
        question_count: questions.length,
        filters,
      });
      res.json({ questions });
    } catch (error) {
      logEvent("error", req, "question_agent.library.questions_search_failed", {
        error: serializeError(error),
      });
      res.status(500).json({ error: "question library search failed" });
    }
  });

  router.get("/agent-design", deps.requireAuth, (req: Request, res: Response) => {
    logEvent("info", req, "question_agent.design.requested");
    res.json(buildQuestionAgentDesign());
  });

  router.get("/contract", deps.requireAuth, (req: Request, res: Response) => {
    logEvent("info", req, "question_agent.contract.requested", {
      contract_source_path: getQuestionAgentContractSourcePath(),
    });
    res.json({
      source_path: getQuestionAgentContractSourcePath(),
      contract: getQuestionAgentContract(),
    });
  });

  router.get("/oah-status", deps.requireAuth, async (req: Request, res: Response) => {
    const reqStart = Date.now();
    const config = getOahCoreConfig();

    try {
      const resolution = await resolveOahWorkspace({
        baseUrl: config.baseUrl,
        requestId: getRequestId(req),
        content: "OAH 状态检查",
        agentName: config.agentName || undefined,
        modelRef: config.model || undefined,
        workspaceId: config.workspaceId || undefined,
        workspaceRuntime: config.workspaceRuntime || undefined,
        workspaceName: config.workspaceName || undefined,
        workspaceOwnerId: config.workspaceOwnerId || undefined,
        workspaceServiceName: config.workspaceServiceName || undefined,
        workspaceAutoCreate: config.workspaceAutoCreate,
      });

      const catalogModels = summarizeCatalogModels(resolution.catalog.models);
      const diagnosis = buildOahStatusDiagnosis(config, catalogModels);

      logEvent("info", req, "question_agent.oah_status.ready", {
        duration_ms: Date.now() - reqStart,
        workspace_id: resolution.workspaceId,
        runtime: resolution.workspace.runtime,
        agent_count: resolution.catalog.agents.length,
        tool_count: resolution.catalog.tools.length,
        model_count: catalogModels.length,
        run_execution_ready: resolution.runExecutionReady,
      });

      res.json({
        ok: resolution.runExecutionReady,
        status: resolution.runExecutionReady ? "ready" : "api_ready_worker_not_ready",
        config: {
          base_url: config.baseUrl,
          agent_name: config.agentName || null,
          model_ref: config.model || null,
          workspace_runtime: config.workspaceRuntime || null,
          workspace_name: config.workspaceName || null,
          workspace_owner_id: config.workspaceOwnerId || null,
          workspace_service_name: config.workspaceServiceName || null,
          workspace_auto_create: config.workspaceAutoCreate,
        },
        workspace: resolution.workspace,
        catalog: resolution.catalog,
        diagnosis,
        health: resolution.health,
        run_execution_ready: resolution.runExecutionReady,
        runtime_template: getQuestionRuntimeCheck(),
      });
    } catch (error) {
      logEvent("error", req, "question_agent.oah_status.failed", {
        duration_ms: Date.now() - reqStart,
        error: serializeError(error),
      });

      res.status(500).json({
        ok: false,
        error: "OAH 出题运行时尚未就绪",
        details: error instanceof Error ? error.message : String(error),
        config: {
          base_url: config.baseUrl,
          agent_name: config.agentName || null,
          model_ref: config.model || null,
          workspace_runtime: config.workspaceRuntime || null,
          workspace_name: config.workspaceName || null,
          workspace_owner_id: config.workspaceOwnerId || null,
          workspace_service_name: config.workspaceServiceName || null,
          workspace_auto_create: config.workspaceAutoCreate,
        },
        runtime_template: getQuestionRuntimeCheck(),
      });
    }
  });

  router.post("/spec/normalize", deps.requireAuth, (req: Request, res: Response) => {
    const reqStart = Date.now();
    const body = readRequestBody(req);
    const requestId = getRequestId(req);

    try {
      const result = normalizeQuestionGenerationSpec({
        ...body,
        request_uuid: body.request_uuid ?? requestId,
      });

      logEvent("info", req, "question_agent.spec.normalized", {
        duration_ms: Date.now() - reqStart,
        spec_id: result.spec.spec_id,
        spec_status: result.spec.status,
        content_mode: result.spec.content_mode,
        algorithm: result.spec.algorithm,
      });

      res.json(result);
    } catch (error) {
      logEvent("error", req, "question_agent.spec.failed", {
        duration_ms: Date.now() - reqStart,
        error: serializeError(error),
      });

      res.status(500).json({
        error: "试题规范归一化失败",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/portrait/:portraitId/spec", deps.requireAuth, async (req: Request, res: Response) => {
    const reqStart = Date.now();
    const ownerUid = deps.getUidFromReq(req);
    const portraitId = normalizeStatusString(req.params.portraitId);
    const body = readRequestBody(req);
    const requestId = getRequestId(req);
    if (!ownerUid || !portraitId) {
      res.status(400).json({ error: "missing portraitId" });
      return;
    }

    try {
      const portrait = await deps.portraitStore.load(ownerUid, portraitId);
      if (!portrait) {
        res.status(404).json({ error: "portrait not found" });
        return;
      }

      const result = normalizeQuestionGenerationSpec({
        ...body,
        request_uuid: body.request_uuid ?? requestId,
      });
      const payload = normalizeAiGenPayload(body);
      const ready = result.spec.status === "ready";
      const now = new Date().toISOString();
      const saved = await deps.portraitStore.save({
        ...portrait,
        status: ready ? "ready" : "draft",
        pending_field: ready ? "none" : portrait.pending_field,
        summary: [
          `subject: ${payload.subject || "pending"}`,
          `knowledge_point: ${payload.knowledge_point || "pending"}`,
          `difficulty: ${payload.difficulty || "pending"}`,
          `question_type: ${payload.question_type || "pending"}`,
          `content_mode: ${payload.content_mode || "pending"}`,
          `algorithm: ${payload.algorithm || "pending"}`,
        ].join(" | "),
        draft: {
          ...portrait.draft,
          subject: payload.subject,
          knowledge_point: payload.knowledge_point,
          difficulty: payload.difficulty,
          algorithm: payload.algorithm,
          question_type: payload.question_type,
          content_mode: payload.content_mode,
          image_mode: payload.image_mode,
          image_placement: payload.image_placement,
          image_targets: payload.image_targets,
        },
        spec: result.spec,
        plan: result.plan,
        validation_errors: result.spec.validation_errors,
        guidance: {
          status_explanation: ready
            ? "出题规格已提交并标记为可生成。"
            : "出题规格已提交，但仍存在校验错误。",
          missing_items: result.spec.validation_errors,
          teacher_checklist: [
            payload.subject ? `已确认学科：${payload.subject}` : "",
            payload.knowledge_point ? `已确认知识点：${payload.knowledge_point}` : "",
            payload.difficulty ? `已确认难度：${payload.difficulty}` : "",
            payload.question_type ? `已确认题型：${payload.question_type}` : "",
            payload.content_mode ? `已确认内容模式：${payload.content_mode}` : "",
            payload.algorithm ? `已确认算法：${payload.algorithm}` : "",
          ].filter(Boolean),
          next_step: ready ? "可以生成题目。" : "请修正校验错误后重新提交。",
        },
        updated_at: now,
      });

      logEvent("info", req, "question_agent.portrait.spec_committed", {
        duration_ms: Date.now() - reqStart,
        portrait_id: portraitId,
        owner_uid: ownerUid,
        spec_id: result.spec.spec_id,
        spec_status: result.spec.status,
      });

      res.json({
        portrait: saved,
        spec: result.spec,
        plan: result.plan,
      });
    } catch (error) {
      logEvent("error", req, "question_agent.portrait.spec_commit_failed", {
        duration_ms: Date.now() - reqStart,
        portrait_id: portraitId,
        owner_uid: ownerUid,
        error: serializeError(error),
      });
      res.status(500).json({
        error: "spec commit failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/profiles/teacher/normalize", deps.requireAuth, (req: Request, res: Response) => {
    logEvent("info", req, "question_agent.teacher_profile.normalized");
    res.json(normalizeTeacherProfileResponse(req.body));
  });

  router.post("/profiles/student/normalize", deps.requireAuth, (req: Request, res: Response) => {
    logEvent("info", req, "question_agent.student_profile.normalized");
    res.json(normalizeStudentProfileResponse(req.body));
  });

  router.post("/portrait/start", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    try {
      const body = readRequestBody(req);
      const attachments = normalizePortraitAttachments(body.attachments);
      const teacherMessage = normalizeStatusString(body.message) || defaultTeacherMessageForAttachments(attachments);
      if (!teacherMessage) {
        res.status(400).json({ error: "新建出题对话需要先输入出题需求" });
        return;
      }
      const teacherPayload = buildPortraitTeacherPayload(attachments, true);
      const turn = createQuestionPortraitSeed(ownerUid, teacherMessage, null, teacherPayload);
      const saved = await deps.portraitStore.save(turn.portrait);
      void completePortraitReplyInBackground(deps, req, ownerUid, saved, teacherMessage, teacherPayload);

      logEvent("info", req, "question_agent.portrait.started", {
        portrait_id: saved.portrait_id,
        owner_uid: ownerUid,
        spec_status: saved.spec.status,
        pending_field: saved.pending_field,
      });

      res.json({
        portrait: saved,
        assistant_message: turn.assistant_message,
        teacher_intent: turn.teacher_intent,
        processing: true,
      });
    } catch (error) {
      if (error instanceof PortraitAttachmentValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logEvent("error", req, "question_agent.portrait.start_failed", {
        owner_uid: ownerUid,
        error: serializeError(error),
      });

      sendPortraitDialogueError(res, error, "启动出题对话失败");
    }
  });

  router.get("/portrait/:portraitId", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const portrait = await deps.portraitStore.load(ownerUid, portraitId);
    if (!portrait) {
      res.status(404).json({ error: "出题对话不存在" });
      return;
    }

    logEvent("info", req, "question_agent.portrait.loaded", {
      portrait_id: portrait.portrait_id,
      owner_uid: ownerUid,
    });

    res.json({ portrait });
  });

  router.get("/portrait/:portraitId/history", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const portrait = await deps.portraitStore.load(ownerUid, portraitId);
    if (!portrait) {
      res.status(404).json({ error: "出题对话不存在" });
      return;
    }

    res.json({
      portrait_id: portrait.portrait_id,
      messages: portrait.messages,
    });
  });

  router.delete("/portrait/:portraitId", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const archived = await deps.portraitStore.archive(ownerUid, portraitId);
    if (!archived) {
      res.status(404).json({ error: "question portrait not found" });
      return;
    }

    logEvent("info", req, "question_agent.portrait.archived", {
      portrait_id: portraitId,
      owner_uid: ownerUid,
    });

    res.json({ archived: true, portrait_id: portraitId });
  });

  router.get("/portrait/:portraitId/export", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const portrait = await deps.portraitStore.load(ownerUid, portraitId);
    if (!portrait) {
      res.status(404).json({ error: "出题对话不存在" });
      return;
    }

    const format = normalizePortraitExportFormat(req.query.format);
    logEvent("info", req, "question_agent.portrait.exported", {
      portrait_id: portrait.portrait_id,
      owner_uid: ownerUid,
      format,
    });
    sendPortraitExport(res, portrait, format);
  });

  router.get("/portrait/:portraitId/question-export", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const portrait = await deps.portraitStore.load(ownerUid, portraitId);
    if (!portrait) {
      res.status(404).json({ error: "出题对话不存在" });
      return;
    }
    const requestId = normalizeStatusString(req.query.request_id);
    const generated = latestGeneratedQuestion(portrait, requestId);
    if (!generated) {
      res.status(404).json({ error: "未找到可导出的题目" });
      return;
    }

    const format = normalizePortraitExportFormat(req.query.format);
    logEvent("info", req, "question_agent.portrait.question_exported", {
      portrait_id: portrait.portrait_id,
      owner_uid: ownerUid,
      request_id: generated.requestId,
      format,
    });
    sendQuestionExport(res, generated.result, generated.requestId, format, deps);
  });

  router.post("/feedback", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const body = readRequestBody(req);
    const requestId = normalizeStatusString(body.request_id);
    const portraitId = normalizeStatusString(body.portrait_id);
    const score = normalizeQuestionFeedbackScore(body.score);
    if (!requestId || score === null) {
      res.status(400).json({ error: "feedback requires request_id and a score from 1 to 5" });
      return;
    }

    if (portraitId) {
      const portrait = await deps.portraitStore.load(ownerUid, portraitId);
      if (!portrait) {
        res.status(404).json({ error: "portrait not found" });
        return;
      }
    }

    try {
      const now = new Date().toISOString();
      const saved = await deps.feedbackStore.save({
        owner_uid: ownerUid,
        portrait_id: portraitId || null,
        request_id: requestId,
        score,
        question_json: Object.prototype.hasOwnProperty.call(body, "question") ? body.question : null,
        context_json: {
          ...(isRecord(body.context) ? body.context : {}),
          source: "question-agent-workbench",
          user_agent: normalizeStatusString(req.get("user-agent")),
        },
        created_at: now,
        updated_at: now,
      });

      logEvent("info", req, "question_agent.feedback.saved", {
        owner_uid: ownerUid,
        portrait_id: portraitId || null,
        request_id: requestId,
        score,
      });

      res.json({ ok: true, feedback: saved });
    } catch (error) {
      logEvent("error", req, "question_agent.feedback.failed", {
        owner_uid: ownerUid,
        portrait_id: portraitId || null,
        request_id: requestId,
        error: serializeError(error),
      });
      res.status(500).json({
        error: "feedback save failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post("/portrait/:portraitId/history", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const body = readRequestBody(req);
    const kind = normalizePortraitHistoryKind(body.kind);
    const content = normalizeStatusString(body.content);
    if (!content && kind !== "generated_question") {
      res.status(400).json({ error: "历史消息内容不能为空" });
      return;
    }

    const saved = await deps.portraitStore.appendMessage(ownerUid, portraitId, {
      role: normalizePortraitHistoryRole(body.role),
      kind,
      content: content || "已生成题目。",
      created_at: new Date().toISOString(),
      request_id: normalizeStatusString(body.request_id) || undefined,
      payload: body.payload,
    });
    if (!saved) {
      res.status(404).json({ error: "出题对话不存在" });
      return;
    }

    logEvent("info", req, "question_agent.portrait.history_appended", {
      portrait_id: saved.portrait_id,
      owner_uid: ownerUid,
      kind,
      message_count: saved.messages.length,
    });

    res.json({ portrait: saved });
  });

  router.get("/portraits", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraits = await deps.portraitStore.list(ownerUid);
    logEvent("info", req, "question_agent.portrait.listed", {
      owner_uid: ownerUid,
      portrait_count: portraits.length,
    });

    res.json({ portraits });
  });

  router.post("/portrait/:portraitId/reply", deps.requireAuth, async (req: Request, res: Response) => {
    const ownerUid = readRequiredUid(req, res, deps);
    if (!ownerUid) {
      return;
    }

    const portraitId = normalizeStatusString(req.params.portraitId);
    const portrait = await deps.portraitStore.load(ownerUid, portraitId);
    if (!portrait) {
      res.status(404).json({ error: "出题对话不存在" });
      return;
    }

    const body = readRequestBody(req);
    let attachments: QuestionPortraitAttachment[] = [];
    try {
      attachments = normalizePortraitAttachments(body.attachments);
    } catch (error) {
      if (error instanceof PortraitAttachmentValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
    const teacherMessage = normalizeStatusString(body.message) || defaultTeacherMessageForAttachments(attachments);
    if (!teacherMessage) {
      res.status(400).json({ error: "老师回复不能为空" });
      return;
    }
    try {
      const teacherPayload = buildPortraitTeacherPayload(attachments, true);
      const saved = await deps.portraitStore.appendMessage(
        ownerUid,
        portrait.portrait_id,
        createTeacherHistoryMessage(teacherMessage, teacherPayload),
      );
      if (!saved) {
        res.status(404).json({ error: "出题对话不存在" });
        return;
      }
      void completePortraitReplyInBackground(deps, req, ownerUid, saved, teacherMessage, teacherPayload);

      logEvent("info", req, "question_agent.portrait.updated", {
        portrait_id: saved.portrait_id,
        owner_uid: ownerUid,
        spec_status: saved.spec.status,
        pending_field: saved.pending_field,
      });

      res.json({
        portrait: saved,
        assistant_message: "",
        teacher_intent: "continue_portrait",
        processing: true,
      });
    } catch (error) {
      if (error instanceof PortraitAttachmentValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      logEvent("error", req, "question_agent.portrait.reply_failed", {
        portrait_id: portrait.portrait_id,
        owner_uid: ownerUid,
        error: serializeError(error),
      });

      const failedAt = new Date().toISOString();
      try {
        await deps.portraitStore.appendMessage(ownerUid, portrait.portrait_id, {
          role: "teacher",
          content: teacherMessage,
          created_at: failedAt,
        });
      } catch (historyError) {
        logEvent("error", req, "question_agent.portrait.reply_failure_history_failed", {
          portrait_id: portrait.portrait_id,
          owner_uid: ownerUid,
          error: serializeError(historyError),
        });
      }

      sendPortraitDialogueError(res, error, "处理出题回复失败");
    }
  });

  attachAiGenerateRoutes(router, deps, {
    generatePath: "/generate",
    statusPath: "/status/:requestId",
    resolveOwnerUid: deps.getUidFromReq,
    validateGenerationRequest: async ({ req, body, payload }) => {
      const ownerUid = deps.getUidFromReq(req);
      const portraitId = normalizeStatusString(body.portrait_id);
      if (!portraitId) {
        return null;
      }
      if (!ownerUid) {
        return {
          statusCode: 401,
          error: "需要登录后才能从画像生成题目。",
          code: "AUTH_REQUIRED",
        };
      }

      const portrait = await deps.portraitStore.load(ownerUid, portraitId);
      if (!portrait) {
        return {
          statusCode: 404,
          error: "画像不存在，不能生成题目。",
          code: "PORTRAIT_NOT_FOUND",
          details: { portrait_id: portraitId },
        };
      }

      const portraitReady = portrait.status === "ready" && portrait.spec.status === "ready";
      if (!portraitReady) {
        return {
          statusCode: 409,
          error: "画像尚未完整，不能生成题目。",
          code: "PORTRAIT_NOT_READY",
          details: {
            portrait_id: portraitId,
            portrait_status: portrait.status,
            spec_status: portrait.spec.status,
            pending_field: portrait.pending_field,
          },
          validation_errors: portrait.validation_errors,
          spec: portrait.spec,
          plan: portrait.plan,
        };
      }

      const mismatches = readPortraitGenerationFieldMismatches(portrait, payload);
      if (mismatches.length > 0) {
        return {
          statusCode: 409,
          error: "生成请求与当前画像不一致，请先同步或重新提交画像规范。",
          code: "PORTRAIT_SPEC_MISMATCH",
          details: {
            portrait_id: portraitId,
            mismatched_fields: mismatches,
          },
          spec: portrait.spec,
          plan: portrait.plan,
        };
      }

      return null;
    },
    persistGeneratedQuestion: async ({ req, body, requestId, result }) => {
      const ownerUid = deps.getUidFromReq(req);
      const portraitId = normalizeStatusString(body.portrait_id);
      if (!ownerUid || !portraitId) {
        return;
      }

      const portrait = await deps.portraitStore.load(ownerUid, portraitId);
      if (!portrait) {
        logEvent("warn", req, "question_agent.portrait.generated_question_missing_portrait", {
          portrait_id: portraitId,
          owner_uid: ownerUid,
          request_id: requestId,
        });
        return;
      }

      const alreadyPersisted = portrait.messages.some((message) => (
        message.kind === "generated_question"
        && normalizeStatusString(message.request_id) === requestId
        && isGeneratedQuestionPayload(message.payload)
      ));
      if (alreadyPersisted) {
        return;
      }

      const saved = await deps.portraitStore.appendMessage(ownerUid, portraitId, {
        role: "assistant",
        kind: "generated_question",
        content: "已生成题目。",
        created_at: new Date().toISOString(),
        request_id: requestId,
        payload: result,
      });

      logEvent("info", req, "question_agent.portrait.generated_question_persisted", {
        portrait_id: portraitId,
        owner_uid: ownerUid,
        request_id: requestId,
        message_count: saved?.messages.length ?? portrait.messages.length,
      });
    },
    persistGenerationFailure: async ({ req, body, requestId }) => {
      const ownerUid = deps.getUidFromReq(req);
      const portraitId = normalizeStatusString(body.portrait_id);
      if (!ownerUid || !portraitId) {
        return;
      }

      const portrait = await deps.portraitStore.load(ownerUid, portraitId);
      if (!portrait) {
        logEvent("warn", req, "question_agent.portrait.generation_failure_missing_portrait", {
          portrait_id: portraitId,
          owner_uid: ownerUid,
          request_id: requestId,
        });
        return;
      }

      const alreadyPersisted = portrait.messages.some((message) => (
        message.kind === "error"
        && normalizeStatusString(message.request_id) === requestId
        && isRecord(message.payload)
        && normalizeStatusString(message.payload.type) === "generation_failure"
      ));
      if (alreadyPersisted) {
        return;
      }

      const saved = await deps.portraitStore.appendMessage(ownerUid, portraitId, {
        role: "assistant",
        kind: "error",
        content: createTeacherSafeErrorMessage("题目生成"),
        created_at: new Date().toISOString(),
        request_id: requestId,
        payload: {
          type: "generation_failure",
          redacted: true,
        },
      });

      logEvent("info", req, "question_agent.portrait.generation_failure_persisted", {
        portrait_id: portraitId,
        owner_uid: ownerUid,
        request_id: requestId,
        message_count: saved?.messages.length ?? portrait.messages.length,
      });
    },
  });

  return router;
}
