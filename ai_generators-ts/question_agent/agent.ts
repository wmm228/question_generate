import { type AiGenPayload } from "../../src/types/ai-generate";
import { runAlgorithm } from "../runtime";

export interface QuestionAgentOptions {
  need_id?: number;
  log_dir?: string;
  data_dir?: string;
  base_model_setting?: Record<string, string>;
  search_setting?: Record<string, string | number | boolean>;
  reflection_setting?: Record<string, string | number | boolean>;
  needs?: string;
  algorithm_name?: AiGenPayload["algorithm"];
}

export class BaseAgent {
  readonly needId: number;
  readonly needs: string;
  readonly algorithmName: AiGenPayload["algorithm"];

  constructor(options: QuestionAgentOptions = {}) {
    this.needId = options.need_id ?? 0;
    this.needs = options.needs?.trim() || "高中数学";
    this.algorithmName = options.algorithm_name ?? "evoq";
  }

  getInitThought(): string {
    return `围绕“${this.needs}”设计一道高质量题目。`;
  }

  async run(): Promise<{
    states: string[];
    result_dict: { question: string; solution_steps: string[]; ground_truth: string };
    exe_time: string;
  }> {
    const startedAt = Date.now();
    const result = await runAlgorithm({
      subject: this.needs,
      knowledge_point: this.needs,
      difficulty: "3",
      algorithm: this.algorithmName,
      question_type: "multiple_choice",
      content_mode: "text",
      image_placement: "",
      image_targets: [],
      image_mode: "none",
    });

    return {
      states: [this.getInitThought()],
      result_dict: result,
      exe_time: `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s`,
    };
  }
}
