import { generateAiQuestion } from "../../src/services/ai-generate";
import { normalizeAiGenPayload, type AiGenPayload } from "../../src/types/ai-generate";

import { Config } from "./config";

export interface GenerationRequest {
  knowledge_points: string[];
  difficulty: string;
  subject: string;
  question_type: string;
  visual_mode: string;
  question?: string;
  answer?: string;
  explanation?: string;
  options?: string[];
  placement?: string;
  image_targets?: string[];
}

export interface GeneratedVariant {
  question: string;
  question_type: string;
  difficulty: string;
  options: string[];
  answer: string;
  explanation: string;
  knowledge_points: string[];
  needs_visual: boolean;
  image_generation_failed?: boolean;
}

function normalizeDifficulty(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (["easy", "medium", "hard"].includes(normalized)) {
    return normalized;
  }
  return "medium";
}

function toAiGenPayload(request: GenerationRequest): AiGenPayload {
  const primaryKnowledgePoint = request.knowledge_points.find((item) => item.trim())?.trim() || "general";
  return normalizeAiGenPayload({
    knowledge_point: primaryKnowledgePoint,
    difficulty: request.difficulty.trim() || "3",
    algorithm: "direct",
    question_type: request.question_type,
    content_mode: request.visual_mode === "none" ? "text" : "image",
    image_placement: request.placement,
    image_targets: request.image_targets,
    image_mode: request.visual_mode === "none" ? "none" : request.visual_mode,
  });
}

function inferNeedsVisual(request: GenerationRequest): boolean {
  return request.visual_mode === "required" || request.visual_mode === "optional";
}

export class QuestionGenerator {
  constructor(
    private readonly options: {
      output_dir: string;
      verbose?: boolean;
      max_retries?: number;
      language?: string;
      subject?: string;
      question_type?: string;
      include_explanation?: boolean;
      include_knowledge_points?: boolean;
      num_variants?: number;
      visual_mode?: string;
      require_visual_phrase?: boolean;
      visual_dependency_retry_limit?: number;
      enable_evaluation?: boolean;
      evaluation_scale?: string;
    },
  ) {}

  async generate(request: GenerationRequest, requestId: string): Promise<GeneratedVariant> {
    Config.load();
    const payload = toAiGenPayload(request);
    const result = await generateAiQuestion(payload, requestId);

    return {
      question: result.question,
      question_type: payload.question_type,
      difficulty: normalizeDifficulty(request.difficulty),
      options: result.options,
      answer: result.ground_truth,
      explanation: result.solution_steps.join("\n"),
      knowledge_points: request.knowledge_points,
      needs_visual: inferNeedsVisual(request),
      ...(result.image_generation_failed === true ? { image_generation_failed: true } : {}),
    };
  }

  async generateVariants(request: GenerationRequest, requestId: string): Promise<GeneratedVariant[]> {
    const variantCount = Math.max(1, this.options.num_variants ?? 1);
    const variants: GeneratedVariant[] = [];
    for (let index = 0; index < variantCount; index += 1) {
      variants.push(await this.generate(request, `${requestId}-variant-${index + 1}`));
    }
    return variants;
  }
}
