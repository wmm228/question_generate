import { generateAiQuestion } from "../src/services/ai-generate";
import { type AiGenerateResponse, type AiGenPayload, validateAiGenPayload } from "../src/types/ai-generate";
import { buildSyntheticRequestId } from "../src/utils/request";

const BASELINE_ALGORITHMS = new Set<AiGenPayload["algorithm"]>(["direct", "cot", "react", "dear", "eqpr"]);

function buildRequestId(algorithm: string): string {
  return buildSyntheticRequestId("ai-runtime-adapter", algorithm);
}

function assertValidPayload(payload: AiGenPayload): void {
  const validationError = validateAiGenPayload(payload);
  if (validationError) {
    throw new Error(validationError);
  }
}

export async function runBaselineAlgorithm(payload: AiGenPayload, requestId?: string): Promise<AiGenerateResponse> {
  assertValidPayload(payload);
  if (!BASELINE_ALGORITHMS.has(payload.algorithm)) {
    throw new Error(`Baseline adapter does not accept algorithm=${payload.algorithm}. Use one of: ${Array.from(BASELINE_ALGORITHMS).join(", ")}`);
  }
  return generateAiQuestion(payload, requestId ?? buildRequestId(payload.algorithm));
}

export async function runEvoqAlgorithm(payload: AiGenPayload, requestId?: string): Promise<AiGenerateResponse> {
  const evoqPayload: AiGenPayload = payload.algorithm === "evoq"
    ? payload
    : {
        ...payload,
        algorithm: "evoq",
      };
  assertValidPayload(evoqPayload);
  return generateAiQuestion(evoqPayload, requestId ?? buildRequestId("evoq"));
}
