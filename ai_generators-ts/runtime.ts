import { generateAiQuestion } from "../src/services/ai-generate";
import { type AiGenPayload, validateAiGenPayload } from "../src/types/ai-generate";
import { buildSyntheticRequestId } from "../src/utils/request";

interface QuestionPayload {
  question: string;
  solution_steps: string[];
  ground_truth: string;
}

function buildRequestId(algorithm: string): string {
  return buildSyntheticRequestId("ai-runtime", algorithm);
}

function toQuestionPayload(result: Awaited<ReturnType<typeof generateAiQuestion>>): QuestionPayload {
  if (result.options.length === 0) {
    return {
      question: result.question,
      solution_steps: result.solution_steps,
      ground_truth: result.ground_truth,
    };
  }

  return {
    question: [result.question, ...result.options].filter(Boolean).join("\n"),
    solution_steps: result.solution_steps,
    ground_truth: result.ground_truth,
  };
}

function assertValidPayload(payload: AiGenPayload): void {
  const validationError = validateAiGenPayload(payload);
  if (validationError) {
    throw new Error(validationError);
  }
}

export async function runAlgorithm(payload: AiGenPayload, requestId?: string): Promise<QuestionPayload> {
  assertValidPayload(payload);
  const result = await generateAiQuestion(payload, requestId ?? buildRequestId(payload.algorithm));
  return toQuestionPayload(result);
}
