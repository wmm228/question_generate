import { generateAiQuestion } from "../src/services/ai-generate";
import {
  normalizeAiGenPayload,
  validateAiGenPayload,
  type AiGenerateResponse,
  type AiGenPayloadInput,
} from "../src/types/ai-generate";
import { buildSyntheticRequestId } from "../src/utils/request";

export type QuestionGeneratorResult = AiGenerateResponse;

export async function generateQuestionImage(
  input: AiGenPayloadInput,
  requestId = buildSyntheticRequestId("ai-question-generator", "image"),
): Promise<QuestionGeneratorResult> {
  const payload = normalizeAiGenPayload({
    ...input,
    content_mode: "image",
    image_mode: input.image_mode || "required",
  });
  const validationError = validateAiGenPayload(payload);
  if (validationError) {
    throw new Error(validationError);
  }
  return generateAiQuestion(payload, requestId);
}
