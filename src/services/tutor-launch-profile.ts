export const TUTOR_LAUNCH_PROFILES = ["default", "local_oah"] as const;

export type TutorLaunchProfile = (typeof TUTOR_LAUNCH_PROFILES)[number];

function normalizeString(value: string | undefined): string {
  return (value || "").trim();
}

function setDefaultEnv(key: string, value: string): void {
  if (!normalizeString(process.env[key])) {
    process.env[key] = value;
  }
}

function normalizeLaunchProfile(value: string | undefined): TutorLaunchProfile {
  return normalizeString(value).toLowerCase() === "local_oah" ? "local_oah" : "default";
}

function applyLocalOahProfileDefaults(): void {
  setDefaultEnv("OAH_BASE_URL", "http://127.0.0.1:8787");
  setDefaultEnv("OAH_MODEL_NAME", "platform/qwen_qwen3.5-397b-a17b");
  setDefaultEnv("OAH_MODEL_PRIORITY", "platform/qwen_qwen3.5-397b-a17b,platform/qwen_qwen3-next-80b-a3b-instruct,platform/mistralai_ministral-14b-instruct-2512,platform/deepseek-ai_deepseek-v4-flash");
  setDefaultEnv("OAH_AGENT_NAME", "question-orchestrator");
  setDefaultEnv("OAH_INTENT_AGENT_NAME", "intent-recognizer");
  setDefaultEnv("OAH_WORKSPACE_RUNTIME", "tutor-question-generation");
  setDefaultEnv("OAH_WORKSPACE_NAME", "tutor-question-generation");
  setDefaultEnv("OAH_WORKSPACE_OWNER_ID", "tutor");
  setDefaultEnv("OAH_WORKSPACE_AUTO_CREATE", "true");
  setDefaultEnv("OAH_RUN_POLL_INTERVAL_MS", "1000");
  setDefaultEnv("OAH_RUN_TIMEOUT_MS", "1800000");
  setDefaultEnv("OAH_REQUEST_TIMEOUT_MS", "600000");
  setDefaultEnv("OAH_PORTRAIT_DIALOGUE_TIMEOUT_MS", "600000");
  setDefaultEnv("OAH_ALLOW_5173_FALLBACK", "false");
  setDefaultEnv("OAH_MODEL_FALLBACK_ENABLED", "true");
  setDefaultEnv("TUTOR_STORAGE_BACKEND", "filesystem");
}

export function applyTutorLaunchProfile(profileRaw: string | undefined): TutorLaunchProfile {
  const profile = normalizeLaunchProfile(profileRaw);
  if (profile === "local_oah") {
    applyLocalOahProfileDefaults();
  }
  return profile;
}
