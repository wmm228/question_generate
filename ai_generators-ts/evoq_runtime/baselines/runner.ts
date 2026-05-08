import { normalizeAiGenPayload, type AiGenPayload } from "../../../src/types/ai-generate";
import { runBaselineAlgorithm } from "../../evoq_runtime_adapter";

export interface BaselineRunConfig {
  llm?: {
    generation_model?: string;
    reflection_model?: string;
    model?: string;
  };
  baselines?: {
    common?: {
      count?: number;
    };
  };
}

export interface BaselineItem {
  question: string;
  options: string[];
  solution_steps: string[];
  ground_truth: string;
}

function normalizeQuestionType(value: string): AiGenPayload["question_type"] {
  if (value === "true_false" || value === "short_answer") {
    return value;
  }
  return "multiple_choice";
}

function buildPayload(
  algo: AiGenPayload["algorithm"],
  knowledgeId: string,
  difficultyTarget: number,
  questionType: string,
  contentMode: string,
  imagePlacement: string,
): AiGenPayload {
  return normalizeAiGenPayload({
    knowledge_point: knowledgeId,
    difficulty: String(difficultyTarget),
    algorithm: algo,
    question_type: normalizeQuestionType(questionType),
    content_mode: contentMode,
    image_placement: imagePlacement,
  });
}

export async function runBaseline(
  algo: AiGenPayload["algorithm"],
  knowledgeId: string,
  difficultyTarget: number,
  config: BaselineRunConfig,
  outputDir: string,
  count?: number,
  datasetPath?: string,
  outputFilename?: string,
  questionType = "multiple_choice",
  contentMode = "text",
  imagePlacement = "",
): Promise<{
  items: BaselineItem[];
  token_stats: {
    case_filename?: string;
    algo: string;
    total_tokens: number;
  };
}> {
  void config;
  void outputDir;
  void datasetPath;
  const itemCount = Math.max(1, count ?? config.baselines?.common?.count ?? 1);
  const items: BaselineItem[] = [];
  for (let index = 0; index < itemCount; index += 1) {
    const result = await runBaselineAlgorithm(
      buildPayload(algo, knowledgeId, difficultyTarget, questionType, contentMode, imagePlacement),
    );
    items.push({
      question: result.question,
      options: result.options,
      solution_steps: result.solution_steps,
      ground_truth: result.ground_truth,
    });
  }

  return {
    items,
    token_stats: {
      ...(outputFilename ? { case_filename: outputFilename } : {}),
      algo,
      total_tokens: 0,
    },
  };
}
