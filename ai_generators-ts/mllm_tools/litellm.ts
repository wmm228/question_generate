import { callOahSessionText } from "../../src/services/oah-client";
import { getOahCoreConfig } from "../../src/services/oah-config";

import { getAiGeneratorsConfig } from "../config";
import { type RuntimeContentPart } from "./utils";

export interface LlmRequestPayload {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  temperature?: number;
  stream?: boolean;
  response_format?: { type: "json_object" };
}

function resolveApiUrl(): string {
  const oahCoreConfig = getOahCoreConfig();
  if (!oahCoreConfig.baseUrl) {
    throw new Error("OAH_BASE_URL not configured");
  }
  return oahCoreConfig.baseUrl;
}

export function createJsonRequestPayload(
  messages: RuntimeContentPart[],
  model = getAiGeneratorsConfig().model,
): LlmRequestPayload {
  const mergedContent = messages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    model,
    messages: [{ role: "user", content: mergedContent }],
    temperature: 0.7,
    stream: false,
    response_format: { type: "json_object" },
  };
}

export async function callLiteLlmJson(
  messages: RuntimeContentPart[],
  requestId: string,
  model = getAiGeneratorsConfig().model,
): Promise<string> {
  const mergedContent = messages
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const oahCoreConfig = getOahCoreConfig();

  return callOahSessionText({
    baseUrl: resolveApiUrl(),
    requestId,
    content: mergedContent,
    sessionTitle: `AI runtime ${requestId}`,
    agentName: oahCoreConfig.agentName || undefined,
    modelRef: model || undefined,
    workspaceId: oahCoreConfig.workspaceId || undefined,
    workspaceRuntime: oahCoreConfig.workspaceRuntime || undefined,
    workspaceName: oahCoreConfig.workspaceName || undefined,
    workspaceOwnerId: oahCoreConfig.workspaceOwnerId || undefined,
    workspaceServiceName: oahCoreConfig.workspaceServiceName || undefined,
    workspaceAutoCreate: oahCoreConfig.workspaceAutoCreate,
  });
}
