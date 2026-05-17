import type { AiGenImagePlacementOrEmpty, AiGenPayload } from "../../types/ai-generate";
import type { QuestionSpecNormalizeResponse } from "../../types/question-agent";

export interface RawGeneratedPayload {
  Item?: unknown;
  item?: unknown;
  result?: unknown;
  stem?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  analysis?: unknown;
  solution_steps?: unknown;
  ground_truth?: unknown;
  image_position?: unknown;
  image_svg?: unknown;
  image_code?: unknown;
  scene_name?: unknown;
  render_notes?: unknown;
}

export interface NormalizedRawGeneratedPayload {
  question: string;
  options?: string[];
  solution_steps: string[];
  ground_truth: string;
  image_position?: AiGenImagePlacementOrEmpty;
  image_svg?: string;
  image_code?: string;
  scene_name?: string;
  render_notes?: string;
}

export interface RawEvaluationPayload {
  passed?: unknown;
  quality_gate?: unknown;
  score?: unknown;
  fitness?: unknown;
  strengths?: unknown;
  weaknesses?: unknown;
  issues?: unknown;
  difficulty_direction?: unknown;
  revision_instructions?: unknown;
  algorithm_feedback?: unknown;
  mutation_instructions?: unknown;
  rethink_instructions?: unknown;
  next_action_hint?: unknown;
}

export interface NormalizedEvaluationPayload {
  passed: boolean;
  score: number;
  fitness: number;
  strengths: string[];
  weaknesses: string[];
  issues: string[];
  difficulty_direction: "easier" | "matched" | "harder" | "unclear";
  revision_instructions: string;
  algorithm_feedback: {
    summary: string;
    mutation_instructions: string;
    rethink_instructions: string;
    next_action_hint: string;
  };
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
  fitness: number;
  strengths: string[];
  weaknesses: string[];
  issues: string[];
  mutation_instructions: string;
  rethink_instructions: string;
  next_action_hint: string;
}

export interface EvoqPopulationCandidate {
  id: string;
  content: string;
  draftJson: string;
  raw: NormalizedRawGeneratedPayload;
  review: EvoqCandidateReview;
}
