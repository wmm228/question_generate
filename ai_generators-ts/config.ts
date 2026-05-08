import { getOahCoreConfig } from "../src/services/oah-config";

export interface AiGeneratorsConfig {
  model: string;
}

export function getAiGeneratorsConfig(): AiGeneratorsConfig {
  return {
    model: getOahCoreConfig().model,
  };
}
