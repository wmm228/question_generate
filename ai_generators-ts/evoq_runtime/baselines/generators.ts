import type { AiGenerateResponse, AiGenPayload } from "../../../src/types/ai-generate";
import { runBaselineAlgorithm } from "../../evoq_runtime_adapter";

export const sourcePythonModule = "generators.py";
export const sourceTypeScriptModule = "evoq_runtime/baselines/generators.ts";

export interface BaselineGeneratorInput {
  payload: AiGenPayload;
  requestId?: string;
}

export async function generators(input: BaselineGeneratorInput): Promise<AiGenerateResponse> {
  return runBaselineAlgorithm(input.payload, input.requestId);
}
