export const AI_GEN_QUESTION_TYPES = ["multiple_choice", "true_false", "short_answer"] as const;
export const AI_GEN_CONTENT_MODES = ["text", "image"] as const;
export const AI_GEN_IMAGE_PLACEMENTS = ["stem_image", "explanation_image", "option_image"] as const;
export const AI_GEN_IMAGE_TARGETS = ["stem", "options", "solution"] as const;
export const AI_GEN_IMAGE_MODES = ["none", "optional", "required"] as const;
export const AI_GEN_ALGORITHMS = ["direct", "cot", "react", "dear", "eqpr", "evoq"] as const;

export type AiGenQuestionType = (typeof AI_GEN_QUESTION_TYPES)[number];
export type AiGenContentMode = (typeof AI_GEN_CONTENT_MODES)[number];
export type AiGenImagePlacement = (typeof AI_GEN_IMAGE_PLACEMENTS)[number];
export type AiGenImageTarget = (typeof AI_GEN_IMAGE_TARGETS)[number];
export type AiGenImageMode = (typeof AI_GEN_IMAGE_MODES)[number];
export type AiGenAlgorithm = (typeof AI_GEN_ALGORITHMS)[number];
export type AiGenImagePlacementOrEmpty = AiGenImagePlacement | "";

export const AI_GEN_QUESTION_TYPE_LABELS: Record<AiGenQuestionType, string> = {
  multiple_choice: "选择题",
  true_false: "判断题",
  short_answer: "简答题",
};

export const AI_GEN_CONTENT_MODE_LABELS: Record<AiGenContentMode, string> = {
  text: "文本题",
  image: "图片题",
};

export const AI_GEN_IMAGE_PLACEMENT_LABELS: Record<AiGenImagePlacementOrEmpty, string> = {
  "": "",
  stem_image: "题干配图",
  explanation_image: "解析配图",
  option_image: "选项配图",
};

export const AI_GEN_IMAGE_TARGET_LABELS: Record<AiGenImageTarget, string> = {
  stem: "题干",
  options: "选项",
  solution: "解析",
};

export const AI_GEN_IMAGE_MODE_LABELS: Record<AiGenImageMode, string> = {
  none: "无图",
  optional: "可选配图",
  required: "必须生成图片",
};

export const AI_GEN_ALGORITHM_LABELS: Record<AiGenAlgorithm, string> = {
  direct: "直接生成",
  cot: "分步推理",
  react: "推理-行动-观察",
  dear: "分解分析修订",
  eqpr: "评估起草处理修订",
  evoq: "进化式出题",
};

const AI_GEN_QUESTION_TYPE_SET = new Set<string>(AI_GEN_QUESTION_TYPES);
const AI_GEN_CONTENT_MODE_SET = new Set<string>(AI_GEN_CONTENT_MODES);
const AI_GEN_IMAGE_PLACEMENT_SET = new Set<string>(AI_GEN_IMAGE_PLACEMENTS);
const AI_GEN_IMAGE_TARGET_SET = new Set<string>(AI_GEN_IMAGE_TARGETS);
const AI_GEN_IMAGE_MODE_SET = new Set<string>(AI_GEN_IMAGE_MODES);
const AI_GEN_ALGORITHM_SET = new Set<string>(AI_GEN_ALGORITHMS);

export interface AiGenPayloadInput {
  subject?: unknown;
  knowledge_point?: unknown;
  difficulty?: unknown;
  algorithm?: unknown;
  question_type?: unknown;
  content_mode?: unknown;
  image_placement?: unknown;
  image_targets?: unknown;
  image_mode?: unknown;
}

export interface AiGenPayload {
  subject: string;
  knowledge_point: string;
  difficulty: string;
  algorithm: AiGenAlgorithm;
  question_type: AiGenQuestionType;
  content_mode: AiGenContentMode;
  image_placement: AiGenImagePlacementOrEmpty;
  image_targets: AiGenImageTarget[];
  image_mode: AiGenImageMode;
}

export interface AiGenerateRequestMeta {
  subject: string;
  question_type: AiGenQuestionType;
  question_type_label: string;
  content_mode: AiGenContentMode;
  content_mode_label: string;
  image_mode: AiGenImageMode;
  image_mode_label: string;
  image_placement: AiGenImagePlacementOrEmpty;
  image_placement_label: string;
  image_targets: AiGenImageTarget[];
  image_target_labels: string[];
}

export interface AiGenerateApiError {
  error: string;
  details?: string;
}

export interface AiGenerateImageAssets {
  stem_image?: string | null;
  explanation_image?: string | null;
  option_images?: Partial<Record<"A" | "B" | "C" | "D", string | null>>;
}

export interface AiGenerateStructuredImageAsset {
  role: "stem" | "solution" | "option";
  url: string | null;
  label: string;
  option_key?: "A" | "B" | "C" | "D";
}

export interface AiGenerateStructuredContent {
  stem: {
    text: string;
    image_targeted: boolean;
    image: AiGenerateStructuredImageAsset | null;
  };
  options: Array<{
    key: string;
    text: string;
    image_targeted: boolean;
    image: AiGenerateStructuredImageAsset | null;
  }>;
  solution: {
    steps: string[];
    image_targeted: boolean;
    image: AiGenerateStructuredImageAsset | null;
  };
}

export interface AiGenerateVisualPipelineMeta {
  requested: boolean;
  image_mode: AiGenImageMode;
  image_targets: AiGenImageTarget[];
  status: "not_requested" | "pending" | "completed" | "failed";
  provider: "safe_svg" | "visual_solver_bridge" | "none";
  stage: "idle" | "render_pending" | "rendered" | "failed";
}

export interface AiGenerateResponse {
  question: string;
  options: string[];
  solution_steps: string[];
  ground_truth: string;
  image_position?: AiGenImagePlacementOrEmpty;
  image_svg?: string;
  image_code?: string;
  meta: AiGenerateRequestMeta;
  request: AiGenerateRequestMeta;
  content: AiGenerateStructuredContent;
  assets: AiGenerateImageAssets;
  visual_pipeline: AiGenerateVisualPipelineMeta;
  image_generation_failed?: boolean;
}

export type AiGenerateApiResponse = AiGenerateResponse & AiGenerateImageAssets;

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAlgorithm(value: unknown): AiGenAlgorithm {
  const algorithm = normalizeString(value);
  return AI_GEN_ALGORITHM_SET.has(algorithm) ? (algorithm as AiGenAlgorithm) : "direct";
}

function normalizeQuestionType(value: unknown): AiGenQuestionType {
  const questionType = normalizeString(value);
  return AI_GEN_QUESTION_TYPE_SET.has(questionType) ? (questionType as AiGenQuestionType) : "multiple_choice";
}

function normalizeContentMode(value: unknown): AiGenContentMode {
  const contentMode = normalizeString(value);
  return AI_GEN_CONTENT_MODE_SET.has(contentMode) ? (contentMode as AiGenContentMode) : "text";
}

function normalizeImagePlacement(value: unknown): AiGenImagePlacementOrEmpty {
  const imagePlacement = normalizeString(value);
  return AI_GEN_IMAGE_PLACEMENT_SET.has(imagePlacement) ? (imagePlacement as AiGenImagePlacement) : "";
}

function normalizeImageMode(value: unknown): AiGenImageMode {
  const imageMode = normalizeString(value);
  return AI_GEN_IMAGE_MODE_SET.has(imageMode) ? (imageMode as AiGenImageMode) : "none";
}

function normalizeImageTargets(value: unknown): AiGenImageTarget[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((item) => normalizeString(item))
    .filter((item): item is AiGenImageTarget => AI_GEN_IMAGE_TARGET_SET.has(item));

  return Array.from(new Set(normalized));
}

function mapPlacementToTargets(imagePlacement: AiGenImagePlacementOrEmpty): AiGenImageTarget[] {
  if (imagePlacement === "option_image") {
    return ["options"];
  }
  if (imagePlacement === "explanation_image") {
    return ["solution"];
  }
  if (imagePlacement === "stem_image") {
    return ["stem"];
  }
  return [];
}

function deriveImagePlacement(imageTargets: AiGenImageTarget[]): AiGenImagePlacementOrEmpty {
  if (imageTargets.length !== 1) {
    return "";
  }
  if (imageTargets[0] === "stem") {
    return "stem_image";
  }
  if (imageTargets[0] === "solution") {
    return "explanation_image";
  }
  if (imageTargets[0] === "options") {
    return "option_image";
  }
  return "";
}

function normalizeTargetsForQuestionType(
  questionType: AiGenQuestionType,
  imageTargets: AiGenImageTarget[],
): AiGenImageTarget[] {
  if (questionType === "multiple_choice") {
    return imageTargets.length > 0 ? imageTargets : ["stem"];
  }

  const filteredTargets = imageTargets.filter((target) => target !== "options");
  return filteredTargets.length > 0 ? filteredTargets : ["stem"];
}

export function normalizeAiGenPayload(body: AiGenPayloadInput): AiGenPayload {
  const subject = normalizeString(body.subject);
  const knowledge_point = normalizeString(body.knowledge_point);
  const difficulty = normalizeString(body.difficulty);
  const algorithm = normalizeAlgorithm(body.algorithm);
  const question_type = normalizeQuestionType(body.question_type);
  const content_mode = normalizeContentMode(body.content_mode);
  const legacyImagePlacement = normalizeImagePlacement(body.image_placement);
  let image_targets = normalizeImageTargets(body.image_targets);
  let image_mode = normalizeImageMode(body.image_mode);

  if (content_mode === "text") {
    image_targets = [];
    image_mode = "none";
  } else {
    if (image_targets.length === 0) {
      image_targets = mapPlacementToTargets(legacyImagePlacement);
    }
    image_targets = normalizeTargetsForQuestionType(question_type, image_targets);
    if (image_mode === "none") {
      image_mode = "required";
    }
  }

  const image_placement = content_mode === "image" ? deriveImagePlacement(image_targets) : "";

  return {
    subject,
    knowledge_point,
    difficulty,
    algorithm,
    question_type,
    content_mode,
    image_placement,
    image_targets,
    image_mode,
  };
}

export function validateAiGenPayload(payload: AiGenPayload): string | null {
  const {
    subject,
    knowledge_point,
    difficulty,
    algorithm,
    question_type,
    content_mode,
    image_placement,
    image_targets,
    image_mode,
  } = payload;

  if (!subject || !knowledge_point || !difficulty || !algorithm || !question_type || !content_mode) {
    return "缺少必要参数";
  }
  if (!AI_GEN_QUESTION_TYPE_SET.has(question_type)) {
    return "题型不合法";
  }
  if (!AI_GEN_CONTENT_MODE_SET.has(content_mode)) {
    return "内容模式不合法";
  }
  if (!AI_GEN_ALGORITHM_SET.has(algorithm)) {
    return "算法不合法";
  }
  if (!/^\d+$/.test(difficulty)) {
    return "难度参数不合法";
  }

  const difficultyNum = Number(difficulty);
  if (!Number.isInteger(difficultyNum) || difficultyNum < 1 || difficultyNum > 6) {
    return "难度参数不合法";
  }

  if (content_mode === "image") {
    if (!AI_GEN_IMAGE_MODE_SET.has(image_mode) || image_mode === "none") {
      return "图片模式不合法";
    }
    if (image_targets.length === 0) {
      return "图片目标不能为空";
    }
    if (image_targets.some((target) => !AI_GEN_IMAGE_TARGET_SET.has(target))) {
      return "图片目标不合法";
    }
    if ((question_type === "true_false" || question_type === "short_answer") && image_targets.includes("options")) {
      return "当前题型不支持选项配图";
    }
    if (image_placement && !AI_GEN_IMAGE_PLACEMENT_SET.has(image_placement)) {
      return "图片位置不合法";
    }
  }

  if (content_mode === "text") {
    if (image_placement !== "") {
      return "纯文本题不能设置图片位置";
    }
    if (image_targets.length > 0) {
      return "纯文本题不能设置图片目标";
    }
    if (image_mode !== "none") {
      return "纯文本题不能设置图片模式";
    }
  }

  return null;
}
