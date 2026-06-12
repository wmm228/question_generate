import type {
  AiGenContentMode,
  AiGenImagePlacementOrEmpty,
  AiGenPayload,
  AiGenQuestionType,
} from "../../../src/types/ai-generate";
import { normalizeQuestionGenerationSpec } from "../../../src/services/question-agent-spec";
import { createAiGenerateRuntime } from "../../../src/services/ai-generate-runtime/runtime";
import { runEvoqPopulation } from "../../../src/services/ai-generate-runtime/strategies";
import { buildSyntheticRequestId } from "../../../src/utils/request";
import { placementToImageTargets } from "../../multimodal_runtime/tutor_integration";

export interface EvolutionConfig {
  ga?: {
    pop_size?: number;
    generations?: number;
  };
}

export interface EvolutionCandidate {
  id: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

function buildPayload(
  knowledgeId: string,
  difficultyTarget: number,
  questionType: AiGenQuestionType,
  contentMode: AiGenContentMode,
  imagePlacement: AiGenImagePlacementOrEmpty,
): AiGenPayload {
  return {
    subject: "数学",
    knowledge_point: knowledgeId,
    difficulty: String(difficultyTarget),
    algorithm: "evoq",
    question_type: questionType,
    content_mode: contentMode,
    image_placement: imagePlacement,
    image_targets: contentMode === "image" ? placementToImageTargets(imagePlacement || "stem_image") : [],
    image_mode: contentMode === "image" ? "required" : "none",
  };
}

function normalizeQuestionType(value: string): AiGenQuestionType {
  if (value === "true_false" || value === "short_answer" || value === "multiple_choice") {
    return value;
  }
  return "multiple_choice";
}

function normalizeContentMode(value: string): AiGenContentMode {
  return value === "image" ? "image" : "text";
}

function normalizeImagePlacement(value: string): AiGenImagePlacementOrEmpty {
  if (value === "stem_image" || value === "explanation_image" || value === "option_image") {
    return value;
  }
  return "";
}

function buildSeedStrategies(popSize: number, contentMode: AiGenContentMode): string[] {
  const base = contentMode === "image"
    ? [
        "让图片成为解题所必需的信息来源。",
        "生成干净的干扰项，并让视觉细节与答案相关。",
        "通过读图负担区分薄弱、中等和较强学生。",
        "题干尽量简洁，但图片内部保持较高信息密度。",
      ]
    : [
        "在保证答案无歧义的前提下提高干扰项质量。",
        "使用简洁但包含多步推理的解题路径。",
        "强调概念区分度，让不同掌握水平的学生表现出差异。",
        "使用不那么套路化但仍可解的题目情境。",
      ];

  const normalizedSize = Math.max(2, Math.min(popSize, base.length));
  return base.slice(0, normalizedSize);
}

export async function runGa(
  knowledgeId: string,
  difficultyTarget: number,
  config: EvolutionConfig,
  outputDir: string,
  datasetPath?: string,
  caseFolderName?: string,
  questionType = "multiple_choice",
  contentMode = "text",
  imagePlacement = "",
): Promise<{
  population: EvolutionCandidate[];
  best: EvolutionCandidate | null;
}> {
  void outputDir;
  void datasetPath;
  void caseFolderName;

  const normalizedQuestionType = normalizeQuestionType(questionType);
  const normalizedContentMode = normalizeContentMode(contentMode);
  const normalizedImagePlacement = normalizeImagePlacement(imagePlacement);
  const payload = buildPayload(
    knowledgeId,
    difficultyTarget,
    normalizedQuestionType,
    normalizedContentMode,
    normalizedImagePlacement,
  );
  const requestId = buildSyntheticRequestId("evoq-ga", payload.algorithm);
  const specContext = normalizeQuestionGenerationSpec({
    ...payload,
    request_uuid: requestId,
  });
  const runtime = createAiGenerateRuntime({
    payload,
    requestId,
    specContext,
  });

  const populationSize = Math.max(2, config.ga?.pop_size ?? 3);
  const mutationRounds = Math.max(1, config.ga?.generations ?? 1);
  const seedStrategies = buildSeedStrategies(populationSize, normalizedContentMode);
  const populationResult = await runEvoqPopulation(runtime, {
    seedStrategies,
    mutationRounds,
    maxPopulationSize: populationSize,
  });

  const population = populationResult.candidates.map((candidate) => {
    const questionLines = candidate.raw.question.split(/\r?\n/);
    const embeddedOptions = questionLines
      .map((line) => line.trim())
      .filter((line) => /^[A-D]\s*[.、:：)]/.test(line));
    const finalQuestion = candidate.raw.options && candidate.raw.options.length > 0
      ? candidate.raw.question
      : questionLines[0]?.trim() || candidate.raw.question;
    return {
      id: candidate.id,
      question: finalQuestion,
      options: candidate.raw.options && candidate.raw.options.length > 0
        ? candidate.raw.options
        : embeddedOptions,
      answer: candidate.raw.ground_truth,
      explanation: candidate.raw.solution_steps.join("\n"),
    };
  });

  const best = population[0] ?? null;
  return {
    population,
    best,
  };
}
