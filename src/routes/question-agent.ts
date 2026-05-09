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
import { applyQuestionPortraitTeacherReply, createQuestionPortrait } from "../services/question-portrait";
import type { QuestionPortraitStore } from "../services/question-portrait-store";
import { getRequestId, logEvent, serializeError } from "../utils/request";

export type AuthMiddleware = RequestHandler;

export interface QuestionAgentRouterDependencies extends AiGenerateRouterDependencies {
  getUidFromReq: UidResolver;
  portraitStore: QuestionPortraitStore;
}

interface CatalogModelSummary {
  ref: string | null;
  name: string | null;
  provider: string | null;
  model_name: string | null;
  url: string | null;
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

function isGenerateIntentMessage(value: string): boolean {
  const text = normalizeStatusString(value).replace(/\s+/g, "");
  if (!text) {
    return false;
  }
  return /^(出呀|出题|出题呀|生成|开始生成|快生成|可以生成|马上生成|开始出题|生成吧|出吧|来题|开始吧)[。！!？?呀啊]*$/.test(text);
}

function isPortraitReadyForGeneration(portrait: unknown): boolean {
  if (!isRecord(portrait)) {
    return false;
  }
  const spec = isRecord(portrait.spec) ? portrait.spec : {};
  return normalizeStatusString(portrait.status) === "ready" && normalizeStatusString(spec.status) === "ready";
}

function readRequiredUid(req: Request, res: Response, deps: QuestionAgentRouterDependencies): string | null {
  const uid = deps.getUidFromReq(req);
  if (!uid) {
    res.status(401).json({ error: "未登录或登录状态已失效" });
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
    available_models: catalogModels,
    summary: usesWorkspaceDefaultModel
      ? "当前 Tutor 没有显式配置 OAH_MODEL_NAME，实际运行会使用 OAH workspace 默认模型。"
      : `当前 Tutor 显式配置的 modelRef 为 ${configuredModelRef}。`,
    hint: usesWorkspaceDefaultModel
      ? "如果默认模型不可用，请先查看 available_models，再把可用的 modelRef 写入 Tutor .env 的 OAH_MODEL_NAME。"
      : "如果当前模型不可用，请确认该 modelRef 在 OAH catalog 中存在，并且其上游模型 API 可连通。",
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
      const teacherMessage = normalizeStatusString(body.message);
      const turn = await createQuestionPortrait(ownerUid, teacherMessage);
      const saved = await deps.portraitStore.save(turn.portrait);

      logEvent("info", req, "question_agent.portrait.started", {
        portrait_id: saved.portrait_id,
        owner_uid: ownerUid,
        spec_status: saved.spec.status,
        pending_field: saved.pending_field,
      });

      res.json({
        portrait: saved,
        assistant_message: turn.assistant_message,
      });
    } catch (error) {
      logEvent("error", req, "question_agent.portrait.start_failed", {
        owner_uid: ownerUid,
        error: serializeError(error),
      });

      res.status(500).json({
        error: "规范对话启动失败",
        details: error instanceof Error ? error.message : String(error),
      });
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
      res.status(404).json({ error: "规范会话不存在" });
      return;
    }

    logEvent("info", req, "question_agent.portrait.loaded", {
      portrait_id: portrait.portrait_id,
      owner_uid: ownerUid,
    });

    res.json({ portrait });
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
      res.status(404).json({ error: "规范会话不存在" });
      return;
    }

    const body = readRequestBody(req);
    const teacherMessage = normalizeStatusString(body.message);
    if (!teacherMessage) {
      res.status(400).json({ error: "消息内容不能为空" });
      return;
    }

    if (isGenerateIntentMessage(teacherMessage) && isPortraitReadyForGeneration(portrait)) {
      logEvent("warn", req, "question_agent.portrait.generate_intent_rejected", {
        portrait_id: portrait.portrait_id,
        owner_uid: ownerUid,
      });
      res.status(409).json({
        error: "规范已就绪，请调用生成接口，不要继续走画像对话接口。",
        code: "PORTRAIT_READY_GENERATE_REQUESTED",
        hint: "前端应调用 /api/ai-question/generate，并使用当前画像 draft 作为生成参数。",
        portrait,
      });
      return;
    }

    try {
      const turn = await applyQuestionPortraitTeacherReply(portrait, teacherMessage);
      const saved = await deps.portraitStore.save(turn.portrait);

      logEvent("info", req, "question_agent.portrait.updated", {
        portrait_id: saved.portrait_id,
        owner_uid: ownerUid,
        spec_status: saved.spec.status,
        pending_field: saved.pending_field,
      });

      res.json({
        portrait: saved,
        assistant_message: turn.assistant_message,
      });
    } catch (error) {
      logEvent("error", req, "question_agent.portrait.reply_failed", {
        portrait_id: portrait.portrait_id,
        owner_uid: ownerUid,
        error: serializeError(error),
      });

      res.status(500).json({
        error: "规范对话回复失败",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  attachAiGenerateRoutes(router, deps, {
    generatePath: "/generate",
    statusPath: "/status/:requestId",
  });

  return router;
}
