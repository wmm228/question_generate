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
  setDefaultEnv("OAH_MODEL_NAME", "platform/kimi-k26");
  setDefaultEnv("OAH_MODEL_PRIORITY", "platform/kimi-k26");
  setDefaultEnv("OAH_AGENT_NAME", "question-orchestrator");
  setDefaultEnv("OAH_WORKSPACE_RUNTIME", "tutor-question-generation");
  setDefaultEnv("OAH_WORKSPACE_NAME", "tutor-question-generation");
  setDefaultEnv("OAH_WORKSPACE_OWNER_ID", "tutor");
  setDefaultEnv("OAH_WORKSPACE_AUTO_CREATE", "true");
  setDefaultEnv("OAH_RUN_POLL_INTERVAL_MS", "1000");
  setDefaultEnv("OAH_RUN_TIMEOUT_MS", "900000");
  setDefaultEnv("OAH_REQUEST_TIMEOUT_MS", "240000");
  setDefaultEnv("OAH_PORTRAIT_DIALOGUE_TIMEOUT_MS", "240000");
  setDefaultEnv("OAH_ALLOW_5173_FALLBACK", "false");
  setDefaultEnv("OAH_MODEL_FALLBACK_ENABLED", "false");
  setDefaultEnv("TUTOR_STORAGE_BACKEND", "filesystem");
}

export function applyTutorLaunchProfile(profileRaw: string | undefined): TutorLaunchProfile {
  const profile = normalizeLaunchProfile(profileRaw);
  if (profile === "local_oah") {
    applyLocalOahProfileDefaults();
  }
  return profile;
}
