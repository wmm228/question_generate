export const TUTOR_LAUNCH_PROFILES = ["default", "local_oah"] as const;

export type TutorLaunchProfile = (typeof TUTOR_LAUNCH_PROFILES)[number];

function normalizeString(value: string | undefined): string {
  return (value || "").trim();
}

function setEnv(key: string, value: string): void {
  process.env[key] = value;
}

function normalizeLaunchProfile(value: string | undefined): TutorLaunchProfile {
  return normalizeString(value).toLowerCase() === "local_oah" ? "local_oah" : "default";
}

function applyLocalOahProfileDefaults(): void {
  setEnv("OAH_BASE_URL", "http://127.0.0.1:8787");
  setEnv("OAH_AGENT_NAME", "question-orchestrator");
  setEnv("OAH_WORKSPACE_RUNTIME", "tutor-question-generation");
  setEnv("OAH_WORKSPACE_NAME", "tutor-question-generation");
  setEnv("OAH_WORKSPACE_OWNER_ID", "tutor");
  setEnv("OAH_WORKSPACE_AUTO_CREATE", "true");
  setEnv("OAH_RUN_POLL_INTERVAL_MS", "1000");
  setEnv("TUTOR_STORAGE_BACKEND", "memory");
}

export function applyTutorLaunchProfile(profileRaw: string | undefined): TutorLaunchProfile {
  const profile = normalizeLaunchProfile(profileRaw);
  if (profile === "local_oah") {
    applyLocalOahProfileDefaults();
  }
  return profile;
}
