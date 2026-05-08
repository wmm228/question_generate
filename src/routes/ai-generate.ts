import { Router, type Request, type RequestHandler, type Response } from "express";

import { generateAiQuestion } from "../services/ai-generate";
import { getOahCoreConfig } from "../services/oah-config";
import {
  type AiGenerateStatusStore,
} from "../services/ai-generate-status";
import { normalizeQuestionGenerationSpec } from "../services/question-agent-spec";
import { normalizeAiGenPayload, validateAiGenPayload } from "../types/ai-generate";
import { getRequestId, logEvent, serializeError } from "../utils/request";

export type AuthMiddleware = RequestHandler;
export interface AiGenerateRouterDependencies {
  requireAuth: AuthMiddleware;
  statusStore: AiGenerateStatusStore;
}

export interface AiGenerateRouteOptions {
  generatePath?: string;
  statusPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequestBody(req: Request): Record<string, unknown> {
  return isRecord(req.body) ? req.body : {};
}

function buildOahExecutionHint(configuredModelRef: string): string {
  if (configuredModelRef) {
    return `当前 Tutor 配置的 OAH_MODEL_NAME=${configuredModelRef}。请确认该 modelRef 在 OAH 中存在，并且其上游模型 API 可连通。`;
  }
  return "当前 Tutor 没有显式配置 OAH_MODEL_NAME，正在使用 OAH workspace 默认模型。请先查看 /api/ai-question/oah-status 返回的 diagnosis.available_models，再把可用的 modelRef 写入 Tutor .env 的 OAH_MODEL_NAME。";
}

export function attachAiGenerateRoutes(
  router: Router,
  deps: AiGenerateRouterDependencies,
  options: AiGenerateRouteOptions = {},
): Router {
  const statusPath = options.statusPath ?? "/ai-generate-status/:requestId";
  const generatePath = options.generatePath ?? "/ai-generate";

  router.get(statusPath, deps.requireAuth, (req: Request, res: Response) => {
    const requestId = String(req.params.requestId || "").trim();
    if (!requestId) {
      res.status(400).json({ error: "缺少 requestId" });
      return;
    }

    const snapshot = deps.statusStore.get(requestId);
    if (!snapshot) {
      res.status(404).json({ error: "未找到执行进度" });
      return;
    }

    res.json(snapshot);
  });

  router.post(generatePath, deps.requireAuth, async (req: Request, res: Response) => {
    const reqStart = Date.now();
    const reqId = getRequestId(req);
    deps.statusStore.ensure(reqId);
    deps.statusStore.appendLog(reqId, "服务器已接收 AI 出题请求。");

    const body = readRequestBody(req);
    const normalizedSpec = normalizeQuestionGenerationSpec({
      ...body,
      request_uuid: body.request_uuid ?? reqId,
    });
    const payload = normalizeAiGenPayload(body);
    const {
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
      algorithm,
      difficulty,
      knowledge_point,
      question_type,
      content_mode,
      image_placement: image_placement || "none",
      image_targets,
      image_mode,
    });

    if (normalizedSpec.spec.status !== "ready") {
      deps.statusStore.updateStage(reqId, "generate", "error", "教师侧试题规范尚未确认。");
      deps.statusStore.updateStage(reqId, "evaluate", "error", "评估阶段未开始。");
      deps.statusStore.updateStage(reqId, "render", "error", "响应组装阶段未开始。");
      deps.statusStore.appendLog(reqId, "教师确认尚未完成，已阻止本次生成。");
      deps.statusStore.finish(reqId, "教师侧试题规范尚未确认。");
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
      deps.statusStore.updateStage(reqId, "generate", "error", "请求参数校验失败。");
      deps.statusStore.updateStage(reqId, "evaluate", "error", "评估阶段未开始。");
      deps.statusStore.updateStage(reqId, "render", "error", "响应组装阶段未开始。");
      deps.statusStore.appendLog(reqId, `请求参数校验失败：${validationError}`);
      deps.statusStore.finish(reqId, validationError);
      logEvent("warn", req, "ai_generate.request.invalid", {
        spec_id: normalizedSpec.spec.spec_id,
        error_message: validationError,
      });
      res.status(400).json({ error: validationError });
      return;
    }

    try {
      deps.statusStore.appendLog(
        reqId,
        `规范已确认，正在调用生成智能体 ${normalizedSpec.spec.generation_contract.generator_agent}。`,
      );
      logEvent("info", req, "ai_generate.spec.ready", {
        spec_id: normalizedSpec.spec.spec_id,
        plan_id: normalizedSpec.plan.plan_id,
        generator_agent: normalizedSpec.spec.generation_contract.generator_agent,
        evaluator_agent: normalizedSpec.spec.generation_contract.evaluator_agent,
        required_tools: normalizedSpec.spec.generation_contract.required_tools,
      });

      const result = await generateAiQuestion(
        payload,
        reqId,
        normalizedSpec,
        (event) => {
          deps.statusStore.applyProgressEvent(reqId, event);
        },
      );

      deps.statusStore.updateStage(reqId, "generate", "done", "草稿生成已完成。");
      deps.statusStore.updateStage(reqId, "evaluate", "done", "评估与修订已完成。");
      deps.statusStore.updateStage(reqId, "render", "done", "最终响应组装已完成。");
      deps.statusStore.appendLog(reqId, "AI 出题流程已完成。");
      deps.statusStore.finish(reqId);

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
      deps.statusStore.updateStage(reqId, "generate", "error", "生成阶段未成功完成。");
      deps.statusStore.updateStage(reqId, "evaluate", "error", "评估阶段未成功完成。");
      deps.statusStore.updateStage(reqId, "render", "error", "响应组装阶段未成功完成。");
      deps.statusStore.appendLog(reqId, `流程执行失败：${message}`);
      deps.statusStore.finish(reqId, message);
      logEvent("error", req, "ai_generate.response.failed", {
        duration_ms: Date.now() - reqStart,
        error: serializeError(error),
      });

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

      if (message.includes("no execution worker is available for runs")) {
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
