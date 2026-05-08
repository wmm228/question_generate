import type { AiGenImagePlacementOrEmpty, AiGenPayload } from "../../types/ai-generate";
import type { QuestionSpecNormalizeResponse } from "../../types/question-agent";

export interface RawGeneratedPayload {
  question?: unknown;
  solution_steps?: unknown;
  ground_truth?: unknown;
  image_position?: unknown;
  image_code?: unknown;
  scene_name?: unknown;
  render_notes?: unknown;
}

export interface NormalizedRawGeneratedPayload {
  question: string;
  solution_steps: string[];
  ground_truth: string;
  image_position?: AiGenImagePlacementOrEmpty;
  image_code?: string;
  scene_name?: string;
  render_notes?: string;
}

export interface RawEvaluationPayload {
  passed?: unknown;
  issues?: unknown;
  revision_instructions?: unknown;
}

export interface NormalizedEvaluationPayload {
  passed: boolean;
  issues: string[];
  revision_instructions: string;
}

export type AiGenerateProgressStage = "request" | "generate" | "evaluate" | "render";
export type AiGenerateProgressState = "pending" | "active" | "done" | "error";

export interface AiGenerateProgressEvent {
  stage: AiGenerateProgressStage;
  state: AiGenerateProgressState;
  detail: string;
  log?: string;
}

export type AiGenerateProgressReporter = (event: AiGenerateProgressEvent) => void;

export interface AiGenerateExecutionContext {
  payload: AiGenPayload;
  requestId: string;
  specContext: QuestionSpecNormalizeResponse;
  reportProgress?: AiGenerateProgressReporter;
}

export interface DraftArtifact {
  content: string;
  draftJson: string;
  raw: NormalizedRawGeneratedPayload;
}

export interface EvoqCandidateReview {
  passed: boolean;
  score: number;
  strengths: string[];
  issues: string[];
  mutation_instructions: string;
}

export interface EvoqPopulationCandidate {
  id: string;
  content: string;
  draftJson: string;
  raw: NormalizedRawGeneratedPayload;
  review: EvoqCandidateReview;
}
