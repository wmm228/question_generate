import { Router, type Request, type RequestHandler, type Response } from "express";
import { createHash } from "crypto";

import { generateAiQuestion } from "../services/ai-generate";
import { type AiGenerateStatusStore } from "../services/ai-generate-status";
import { getOahCoreConfig } from "../services/oah-config";
import { normalizeQuestionGenerationSpec } from "../services/question-agent-spec";
import {
  normalizeAiGenPayload,
  validateAiGenPayload,
  type AiGenerateApiResponse,
  type AiGenPayload,
} from "../types/ai-generate";
import type { QuestionSpecNormalizeResponse } from "../types/question-agent";
import { getRequestId, logEvent, serializeError } from "../utils/request";

export type AuthMiddleware = RequestHandler;

export interface AiGenerateRouterDependencies {
  requireAuth: AuthMiddleware;
  statusStore: AiGenerateStatusStore;
}

export interface AiGenerateRouteOptions {
  generatePath?: string;
  statusPath?: string;
  resolveOwnerUid?: (req: Request) => string | null;
  validateGenerationRequest?: (context: {
    req: Request;
    body: Record<string, unknown>;
    requestId: string;
    payload: AiGenPayload;
    normalizedSpec: QuestionSpecNormalizeResponse;
  }) => Promise<AiGenerateRequestBlock | null | undefined>;
  persistGeneratedQuestion?: (context: {
    req: Request;
    body: Record<string, unknown>;
    requestId: string;
    payload: AiGenPayload;
    result: AiGenerateApiResponse;
  }) => Promise<void>;
  persistGenerationFailure?: (context: {
    req: Request;
    body: Record<string, unknown>;
    requestId: string;
    payload: AiGenPayload;
    errorMessage: string;
    result?: AiGenerateApiResponse;
  }) => Promise<void>;
}

export interface AiGenerateRequestBlock {
  statusCode?: number;
  error: string;
  code?: string;
  details?: unknown;
  validation_errors?: string[];
  spec?: unknown;
  plan?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequestBody(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

function normalizeOwnerUid(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildScopedRequestId(publicRequestId: string, ownerUid: string): string {
  const normalizedOwnerUid = normalizeOwnerUid(ownerUid);
  if (!normalizedOwnerUid) {
    return publicRequestId;
  }
  const ownerHash = createHash("sha256").update(normalizedOwnerUid).digest("hex").slice(0, 16);
  return `owner_${ownerHash}-${publicRequestId}`;
}

function toPublicStatusSnapshot<T extends { requestId: string }>(snapshot: T, publicRequestId: string): T {
  return {
    ...snapshot,
    requestId: publicRequestId,
  };
}

function buildOahExecutionHint(configuredModelRef: string): string {
  if (configuredModelRef) {
    return `当前 Tutor 配置的 OAH_MODEL_NAME=${configuredModelRef}。请确认该 modelRef 在 OAH 中存在，并且其上游模型 API 可连通。`;
  }
  return "当前 Tutor 没有显式配置 OAH_MODEL_NAME，正在使用 OAH workspace 默认模型。请先查看 /api/ai-question/oah-status 返回的 diagnosis.available_models，再把可用的 modelRef 写入 Tutor .env 的 OAH_MODEL_NAME。";
}

function buildOahTimeoutHint(configuredModelRef: string): string {
  const modelText = configuredModelRef ? `当前模型为 ${configuredModelRef}` : "当前使用 OAH workspace 默认模型";
  return `${modelText}。本次 OAH run 超过 OAH_RUN_TIMEOUT_MS 后被终止；选项配图和复杂 SVG 图片题会明显更慢。已确认模型在执行但没有及时返回时，应提高 OAH_RUN_TIMEOUT_MS，或降低本题图片复杂度后重试。`;
}

export function attachAiGenerateRoutes(
  router: Router,
  deps: AiGenerateRouterDependencies,
  options: AiGenerateRouteOptions = {},
): Router {
  const statusPath = options.statusPath ?? "/ai-generate-status/:requestId";
  const generatePath = options.generatePath ?? "/ai-generate";

  router.get(statusPath, deps.requireAuth, async (req: Request, res: Response) => {
    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "缺少 requestId" });
      return;
    }

    const ownerUid = normalizeOwnerUid(options.resolveOwnerUid?.(req));
    const statusRequestId = buildScopedRequestId(requestId, ownerUid);
    const snapshot = await deps.statusStore.get(statusRequestId);
    if (!snapshot) {
      res.status(404).json({ error: "未找到执行进度" });
      return;
    }

    res.json(toPublicStatusSnapshot(snapshot, requestId));
  });

  router.post(generatePath, deps.requireAuth, async (req: Request, res: Response) => {
    const reqStart = Date.now();
    const publicReqId = getRequestId(req);
    const ownerUid = normalizeOwnerUid(options.resolveOwnerUid?.(req));
    const statusRequestId = buildScopedRequestId(publicReqId, ownerUid);
    await deps.statusStore.ensure(statusRequestId);
    await deps.statusStore.appendLog(statusRequestId, "服务器已接收 AI 出题请求。");

    const body = readRequestBody(req);
    const normalizedSpec = normalizeQuestionGenerationSpec({
      ...body,
      request_uuid: body.request_uuid ?? publicReqId,
    });
    const payload = normalizeAiGenPayload(body);
    const {
      subject,
      knowledge_point,
      difficulty,
      algorithm,
      question_type,
      content_mode,
      image_placement,
      image_targets,
      image_mode,
    } = payload;

    logEvent("info", req, "ai_generate.request.received", {
      spec_id: normalizedSpec.spec.spec_id,
      spec_status: normalizedSpec.spec.status,
      status_request_uuid: statusRequestId,
      algorithm,
      subject,
      difficulty,
      knowledge_point,
      question_type,
      content_mode,
      image_placement: image_placement || "none",
      image_targets,
      image_mode,
    });

    if (normalizedSpec.spec.status !== "ready") {
      await deps.statusStore.updateStage(statusRequestId, "generate", "error", "教师侧试题规范尚未确认。");
      await deps.statusStore.updateStage(statusRequestId, "evaluate", "error", "评估阶段未开始。");
      await deps.statusStore.updateStage(statusRequestId, "render", "error", "响应组装阶段未开始。");
      await deps.statusStore.appendLog(statusRequestId, "教师确认尚未完成，已阻止本次生成。");
      await deps.statusStore.finish(statusRequestId, "教师侧试题规范尚未确认。");
      logEvent("warn", req, "ai_generate.spec.blocked", {
        spec_id: normalizedSpec.spec.spec_id,
        validation_errors: normalizedSpec.spec.validation_errors,
      });
      res.status(400).json({
        error: "生成前必须先完成教师确认。",
        validation_errors: normalizedSpec.spec.validation_errors,
        spec: normalizedSpec.spec,
        plan: normalizedSpec.plan,
      });
      return;
    }

    const validationError = validateAiGenPayload(payload);
    if (validationError) {
      await deps.statusStore.updateStage(statusRequestId, "generate", "error", "请求参数校验失败。");
      await deps.statusStore.updateStage(statusRequestId, "evaluate", "error", "评估阶段未开始。");
      await deps.statusStore.updateStage(statusRequestId, "render", "error", "响应组装阶段未开始。");
      await deps.statusStore.appendLog(statusRequestId, `请求参数校验失败：${validationError}`);
      await deps.statusStore.finish(statusRequestId, validationError);
      logEvent("warn", req, "ai_generate.request.invalid", {
        spec_id: normalizedSpec.spec.spec_id,
        error_message: validationError,
      });
      res.status(400).json({ error: validationError });
      return;
    }

    if (options.validateGenerationRequest) {
      const requestBlock = await options.validateGenerationRequest({
        req,
        body,
        requestId: publicReqId,
        payload,
        normalizedSpec,
      });
      if (requestBlock) {
        const blockMessage = requestBlock.error || "生成请求被业务规则阻止。";
        await deps.statusStore.updateStage(statusRequestId, "generate", "error", blockMessage);
        await deps.statusStore.updateStage(statusRequestId, "evaluate", "error", "评估阶段未开始。");
        await deps.statusStore.updateStage(statusRequestId, "render", "error", "响应组装阶段未开始。");
        await deps.statusStore.appendLog(statusRequestId, blockMessage);
        await deps.statusStore.finish(statusRequestId, blockMessage);
        logEvent("warn", req, "ai_generate.request.blocked", {
          spec_id: normalizedSpec.spec.spec_id,
          code: requestBlock.code || "GENERATION_REQUEST_BLOCKED",
          details: requestBlock.details,
        });
        res.status(requestBlock.statusCode || 400).json({
          error: blockMessage,
          ...(requestBlock.code ? { code: requestBlock.code } : {}),
          ...(requestBlock.details !== undefined ? { details: requestBlock.details } : {}),
          ...(requestBlock.validation_errors ? { validation_errors: requestBlock.validation_errors } : {}),
          ...(requestBlock.spec ? { spec: requestBlock.spec } : {}),
          ...(requestBlock.plan ? { plan: requestBlock.plan } : {}),
        });
        return;
      }
    }

    try {
      await deps.statusStore.appendLog(
        statusRequestId,
        `规范已确认，正在调用生成智能体 ${normalizedSpec.spec.generation_contract.generator_agent}。`,
      );
      logEvent("info", req, "ai_generate.spec.ready", {
        spec_id: normalizedSpec.spec.spec_id,
        plan_id: normalizedSpec.plan.plan_id,
        generator_agent: normalizedSpec.spec.generation_contract.generator_agent,
        evaluator_agent: normalizedSpec.spec.generation_contract.evaluator_agent,
        required_capabilities: normalizedSpec.spec.generation_contract.required_capabilities,
      });

      const result = await generateAiQuestion(
        payload,
        statusRequestId,
        normalizedSpec,
        (event) => {
          void deps.statusStore.applyProgressEvent(statusRequestId, event).catch(() => undefined);
        },
      );

      if (content_mode === "image" && image_mode === "required" && result.image_generation_failed === true) {
        const resultRecord = result as unknown as Record<string, unknown>;
        const visualError = typeof resultRecord.visual_pipeline_error === "string"
          ? resultRecord.visual_pipeline_error
          : "必需图片未生成。";
        const errorMessage = `图片渲染失败，必需图片未生成：${visualError}`;
        await deps.statusStore.updateStage(statusRequestId, "generate", "done", "草稿生成已完成。");
        await deps.statusStore.updateStage(statusRequestId, "evaluate", "done", "评估与修订已完成。");
        await deps.statusStore.updateStage(statusRequestId, "render", "error", "图片渲染失败，必需图片未生成。");
        await deps.statusStore.appendLog(statusRequestId, errorMessage);
        await deps.statusStore.finish(statusRequestId, errorMessage);
        logEvent("error", req, "ai_generate.required_image.failed", {
          duration_ms: Date.now() - reqStart,
          visual_error: visualError,
        });
        if (options.persistGenerationFailure) {
          try {
            await options.persistGenerationFailure({
              req,
              body,
              requestId: publicReqId,
              payload,
              errorMessage,
              result,
            });
          } catch (persistError) {
            await deps.statusStore.appendLog(statusRequestId, "题目生成失败，但写入失败原因到画像历史失败。").catch(() => undefined);
            logEvent("error", req, "ai_generate.failure_history_persist_failed", {
              duration_ms: Date.now() - reqStart,
              error: serializeError(persistError),
            });
          }
        }
        res.status(502).json({
          error: "图片题渲染失败，未生成必需图片。",
          code: "AI_IMAGE_RENDER_FAILED",
          details: visualError,
          result,
        });
        return;
      }

      await deps.statusStore.updateStage(statusRequestId, "generate", "done", "草稿生成已完成。");
      await deps.statusStore.updateStage(statusRequestId, "evaluate", "done", "评估与修订已完成。");
      await deps.statusStore.updateStage(statusRequestId, "render", "done", "最终响应组装已完成。");
      await deps.statusStore.appendLog(statusRequestId, "AI 出题流程已完成。");
      await deps.statusStore.finish(statusRequestId, undefined, result as unknown as Record<string, unknown>);

      if (options.persistGeneratedQuestion) {
        try {
          await options.persistGeneratedQuestion({
            req,
            body,
            requestId: publicReqId,
            payload,
            result,
          });
        } catch (persistError) {
          await deps.statusStore.appendLog(statusRequestId, "题目已生成，但写入画像历史失败。").catch(() => undefined);
          logEvent("error", req, "ai_generate.history_persist_failed", {
            duration_ms: Date.now() - reqStart,
            error: serializeError(persistError),
          });
        }
      }

      logEvent("info", req, "ai_generate.response.generated", {
        duration_ms: Date.now() - reqStart,
        has_options: result.options.length > 0,
        solution_steps_count: result.solution_steps.length,
        image_generation_failed: result.image_generation_failed === true,
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const oahConfig = getOahCoreConfig();
      const configuredModelRef = oahConfig.model || "";
      await deps.statusStore.updateStage(statusRequestId, "generate", "error", "生成阶段未成功完成。");
      await deps.statusStore.updateStage(statusRequestId, "evaluate", "error", "评估阶段未成功完成。");
      await deps.statusStore.updateStage(statusRequestId, "render", "error", "响应组装阶段未成功完成。");
      await deps.statusStore.appendLog(statusRequestId, `流程执行失败：${message}`);
      await deps.statusStore.finish(statusRequestId, message);
      logEvent("error", req, "ai_generate.response.failed", {
        duration_ms: Date.now() - reqStart,
        error: serializeError(error),
      });
      if (options.persistGenerationFailure) {
        try {
          await options.persistGenerationFailure({
            req,
            body,
            requestId: publicReqId,
            payload,
            errorMessage: message,
          });
        } catch (persistError) {
          await deps.statusStore.appendLog(statusRequestId, "题目生成失败，但写入失败原因到画像历史失败。").catch(() => undefined);
          logEvent("error", req, "ai_generate.failure_history_persist_failed", {
            duration_ms: Date.now() - reqStart,
            error: serializeError(persistError),
          });
        }
      }

      if (
        message.includes("status=timed_out")
        || message.includes("Run exceeded configured timeout")
      ) {
        res.status(504).json({
          error: "当前模型生成超时。",
          code: "OAH_MODEL_TIMEOUT",
          details: message,
          hint: buildOahTimeoutHint(configuredModelRef),
        });
        return;
      }

      if (
        message.includes("Cannot connect to API")
        || message.includes("getaddrinfo ENOTFOUND")
        || message.includes("finished with status=failed")
      ) {
        res.status(503).json({
          error: "OAH 已启动执行，但当前模型 API 不可达。",
          code: "OAH_MODEL_API_UNREACHABLE",
          details: message,
          hint: buildOahExecutionHint(configuredModelRef),
        });
        return;
      }

      if (
        message.includes("OAH network request failed")
        || message.includes("Connect Timeout Error")
        || message.includes("fetch failed")
      ) {
        res.status(503).json({
          error: "AI 出题服务当前不可达。",
          code: "AI_GENERATE_NETWORK_UNREACHABLE",
          details: message,
          hint: "当前是 Tutor 到 OAH API 这一跳不可达，请先检查 OAH_BASE_URL 对应服务是否在线。",
        });
        return;
      }

      if (
        message.includes("no execution worker is available for runs")
        || message.includes("没有可执行运行任务")
      ) {
        res.status(503).json({
          error: "AI 出题执行 Worker 当前不可用。",
          code: "AI_GENERATE_WORKER_UNAVAILABLE",
          details: message,
          hint: "OAH API 可访问，但当前没有可执行 run 的 Worker，请先检查 OAH Worker 状态。",
        });
        return;
      }

      res.status(500).json({
        error: "AI 出题失败",
        details: message,
        hint: buildOahExecutionHint(configuredModelRef),
      });
    }
  });

  return router;
}

export function createAiGenerateRouter(deps: AiGenerateRouterDependencies): Router {
  return attachAiGenerateRoutes(Router(), deps);
}
