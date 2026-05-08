import { generateQuestionImage } from "./question_generator";
import { type AiGenerateResponse, type AiGenPayloadInput } from "../src/types/ai-generate";
import { buildSyntheticRequestId } from "../src/utils/request";

export type VisualGenerationResult = AiGenerateResponse;

export async function generateVisualExplanation(
  input: AiGenPayloadInput,
  requestId = buildSyntheticRequestId("ai-visual-generator", "visual"),
): Promise<VisualGenerationResult> {
  return generateQuestionImage(input, requestId);
}
