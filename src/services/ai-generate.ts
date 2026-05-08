import type { AiGenerateResponse, AiGenPayload } from "../types/ai-generate";
import type { QuestionSpecNormalizeResponse } from "../types/question-agent";
import { normalizeQuestionGenerationSpec } from "./question-agent-spec";
import { createAiGenerateRuntime } from "./ai-generate-runtime/runtime";
import { executeAlgorithmStrategy } from "./ai-generate-runtime/strategies";

export type {
  AiGenerateProgressEvent,
  AiGenerateProgressReporter,
  AiGenerateProgressStage,
  AiGenerateProgressState,
} from "./ai-generate-runtime/types";

import type { AiGenerateProgressReporter } from "./ai-generate-runtime/types";

export async function generateAiQuestion(
  payload: AiGenPayload,
  requestId: string,
  specContext: QuestionSpecNormalizeResponse = normalizeQuestionGenerationSpec({
    ...payload,
    request_uuid: requestId,
  }),
  reportProgress?: AiGenerateProgressReporter,
): Promise<AiGenerateResponse> {
  const runtime = createAiGenerateRuntime({
    payload,
    requestId,
    specContext,
    reportProgress,
  });

  runtime.logPipelineStarted();

  try {
    const raw = await executeAlgorithmStrategy(runtime);
    const result = await runtime.finalize(raw);
    runtime.logPipelineCompleted(result);
    return result;
  } catch (error) {
    runtime.logPipelineFailed(error);
    throw error;
  }
}
