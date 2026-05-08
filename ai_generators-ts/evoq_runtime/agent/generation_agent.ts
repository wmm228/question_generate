import type { AiGenerateResponse, AiGenPayload } from "../../../src/types/ai-generate";
import { runEvoqAlgorithm } from "../../evoq_runtime_adapter";

export const sourcePythonModule = "generation_agent.py";
export const sourceTypeScriptModule = "evoq_runtime/agent/generation_agent.ts";

export interface EvoqGenerationAgentInput {
  payload: AiGenPayload;
  requestId?: string;
}

export async function generationAgent(input: EvoqGenerationAgentInput): Promise<AiGenerateResponse> {
  return runEvoqAlgorithm(input.payload, input.requestId);
}
