import path from "path";

import dotenv from "dotenv";

export interface OahWorkspaceSelector {
  agentName: string;
  workspaceId: string;
  workspaceRuntime: string;
  workspaceName: string;
  workspaceOwnerId: string;
  workspaceServiceName: string;
  workspaceAutoCreate: boolean;
}

export interface OahCoreConfig extends OahWorkspaceSelector {
  baseUrl: string;
  model: string;
}

export interface OahMediaConfig {
  ocrBaseUrl: string;
  ocrModel: string;
  asrUrl: string;
  asrKey: string;
  ttsUrl: string;
  ttsKey: string;
}

const DEFAULT_OAH_BASE_URL = "http://10.11.20.89:8787";

for (const envPath of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
]) {
  dotenv.config({ path: envPath, override: false, quiet: true });
}

function trim(value: string | undefined): string {
  return (value || "").trim();
}

function trimUrl(value: string | undefined): string {
  return trim(value).replace(/\/+$/, "");
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = trim(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getOahWorkspaceSelector(): OahWorkspaceSelector {
  return {
    agentName: trim(process.env.OAH_AGENT_NAME),
    workspaceId: trim(process.env.OAH_WORKSPACE_ID),
    workspaceRuntime: trim(process.env.OAH_WORKSPACE_RUNTIME),
    workspaceName: trim(process.env.OAH_WORKSPACE_NAME),
    workspaceOwnerId: trim(process.env.OAH_WORKSPACE_OWNER_ID || process.env.OAH_OWNER_ID),
    workspaceServiceName: trim(process.env.OAH_WORKSPACE_SERVICE_NAME),
    workspaceAutoCreate: parseBoolean(process.env.OAH_WORKSPACE_AUTO_CREATE, true),
  };
}

export function getOahCoreConfig(): OahCoreConfig {
  const selector = getOahWorkspaceSelector();
  return {
    ...selector,
    baseUrl: trimUrl(process.env.OAH_BASE_URL) || DEFAULT_OAH_BASE_URL,
    model: trim(process.env.OAH_MODEL_NAME),
  };
}

export function getOahMediaConfig(): OahMediaConfig {
  const core = getOahCoreConfig();
  return {
    ocrBaseUrl: trimUrl(process.env.OAH_OCR_API_URL) || core.baseUrl,
    ocrModel: trim(process.env.OAH_OCR_MODEL) || "ocr2.0",
    asrUrl: trim(process.env.OAH_ASR_URL),
    asrKey: trim(process.env.OAH_ASR_KEY),
    ttsUrl: trim(process.env.OAH_TTS_URL),
    ttsKey: trim(process.env.OAH_TTS_KEY),
  };
}
