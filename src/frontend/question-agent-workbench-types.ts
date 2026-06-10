export type AuthMode = "login" | "register";
export type FeedbackTone = "neutral" | "ok" | "warn" | "error";
export type ProgressState = "pending" | "active" | "done" | "error";

export interface WorkbenchClientConfig {
  algorithms: string[];
  algorithm_labels: Record<string, string>;
  question_types: string[];
  question_type_labels: Record<string, string>;
  content_modes: string[];
  content_mode_labels: Record<string, string>;
  image_modes: string[];
  image_mode_labels: Record<string, string>;
  image_placements: string[];
  image_placement_labels: Record<string, string>;
  image_targets: string[];
  image_target_labels: Record<string, string>;
}

export interface QuestionAgentContractEnvelope {
  source_path: string;
  contract: Record<string, unknown>;
}

export interface OahStatusEnvelope {
  ok: boolean;
  status?: string;
  run_execution_ready?: boolean;
  workspace?: Record<string, unknown>;
  config?: Record<string, unknown>;
  catalog?: Record<string, unknown>;
  diagnosis?: Record<string, unknown>;
  health?: Record<string, unknown>;
  details?: string;
  error?: string;
}

export interface WorkbenchLayoutState {
  sidebarWidth: number;
  chatPanelWidth: number;
  inspectorWidth: number;
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
}

export interface SpecNormalizeResponse {
  spec: Record<string, unknown>;
  plan: Record<string, unknown>;
}

export interface ProgressStage {
  key: string;
  label: string;
  detail: string;
  state: ProgressState;
  updatedAt: string;
}

export interface ProgressSnapshot {
  requestId: string;
  startedAt: string;
  updatedAt: string;
  finished: boolean;
  error?: string;
  result?: GeneratedResult;
  stages: ProgressStage[];
  logs: string[];
}

export interface VisualPipelineMeta {
  requested?: boolean;
  status?: string;
  provider?: string;
  stage?: string;
  image_mode?: string;
  image_targets?: string[];
}

export interface GeneratedAssets {
  stem_image?: string | null;
  explanation_image?: string | null;
  option_images?: Record<string, string | null | undefined>;
}

export interface GeneratedStructuredImage {
  url?: string | null;
  label?: string;
  role?: string;
  option_key?: string;
}

export interface GeneratedStructuredContent {
  stem?: {
    image?: GeneratedStructuredImage | null;
  };
  options?: Array<{
    key?: string;
    image?: GeneratedStructuredImage | null;
  }>;
  solution?: {
    image?: GeneratedStructuredImage | null;
  };
}

export interface GeneratedRequestMeta {
  subject?: string;
  knowledge_point?: string;
  difficulty?: string;
  algorithm?: string;
  algorithm_label?: string;
  question_type?: string;
  question_type_label?: string;
  content_mode?: string;
  content_mode_label?: string;
  image_mode?: string;
  image_mode_label?: string;
  image_placement?: string;
  image_placement_label?: string;
  image_targets?: string[];
  image_target_labels?: string[];
}

export interface GeneratedResult extends GeneratedAssets {
  question: string;
  options: string[];
  solution_steps: string[];
  ground_truth: string;
  meta?: GeneratedRequestMeta;
  request?: GeneratedRequestMeta;
  image_svg?: string;
  image_code?: string;
  assets?: GeneratedAssets;
  content?: GeneratedStructuredContent;
  visual_pipeline?: VisualPipelineMeta;
}

export interface QuestionLibraryItem {
  question_id: string;
  portrait_id: string;
  request_id: string;
  subject: string;
  knowledge_point: string;
  difficulty: string;
  question_type: string;
  content_mode: string;
  algorithm: string;
  created_at: string;
  updated_at: string;
  result: GeneratedResult;
}

export interface QuestionLibraryEnvelope {
  questions?: QuestionLibraryItem[];
}

export interface GenerationPayload {
  subject: string;
  knowledge_point: string;
  difficulty: string;
  algorithm: string;
  question_type: string;
  content_mode: string;
  image_placement: string;
  image_targets: string[];
  image_mode: string;
}

export interface AuthResponse {
  ok?: boolean;
  token?: string;
  uid?: string;
  error?: string;
}

export interface MeEnvelope {
  uid?: string;
}

export interface PortraitAttachment {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  data_url: string;
}

export interface PortraitMessage {
  role?: string;
  content?: string;
  created_at?: string;
  kind?: string;
  request_id?: string;
  payload?: unknown;
}

export interface PortraitGuidanceEnvelope {
  status_explanation?: string;
  missing_items?: string[];
  teacher_checklist?: string[];
  next_step?: string;
}

export interface PortraitDocumentEnvelope {
  portrait_id?: string;
  title?: string;
  status?: string;
  pending_field?: string;
  summary?: string;
  session_memory?: Record<string, unknown>;
  guidance?: PortraitGuidanceEnvelope;
  draft?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  validation_errors?: string[];
  messages?: PortraitMessage[];
  markdown?: string;
  markdown_path?: string | null;
  updated_at?: string;
  created_at?: string;
}

export interface PortraitTurnEnvelope {
  portrait?: PortraitDocumentEnvelope;
  assistant_message?: string;
  teacher_intent?: string;
  processing?: boolean;
}

export interface PortraitListItem {
  portrait_id?: string;
  title?: string;
  status?: string;
  pending_field?: string;
  summary?: string;
  updated_at?: string;
  created_at?: string;
  history_updated_at?: string;
  message_count?: number;
}

export interface PortraitListEnvelope {
  portraits?: PortraitListItem[];
}

export interface PersistedWorkbenchState {
  activePortraitId: string;
  activeGeneration: {
    requestId: string;
    portraitId: string;
    startedAt: string;
  } | null;
  latestKnowledgePointDraft: string;
  latestPortraitReplyDraft: string;
  requestDraft: Partial<GenerationPayload>;
  layout: WorkbenchLayoutState;
}

export const DEFAULT_CLIENT_CONFIG: WorkbenchClientConfig = {
  algorithms: ["direct", "cot", "react", "dear", "eqpr", "evoq"],
  algorithm_labels: {
    direct: "直接生成",
    cot: "分步推理",
    react: "推理行动",
    dear: "分解增强",
    eqpr: "过程校验",
    evoq: "进化优化",
  },
  question_types: ["multiple_choice", "true_false", "short_answer"],
  question_type_labels: {
    multiple_choice: "选择题",
    true_false: "判断题",
    short_answer: "简答题",
  },
  content_modes: ["text", "image"],
  content_mode_labels: {
    text: "文本题",
    image: "图片题",
  },
  image_modes: ["none", "optional", "required"],
  image_mode_labels: {
    none: "无图",
    optional: "可选配图",
    required: "必须出图",
  },
  image_placements: ["stem_image", "explanation_image", "option_image"],
  image_placement_labels: {
    stem_image: "题干配图",
    explanation_image: "解析配图",
    option_image: "选项配图",
  },
  image_targets: ["stem", "options", "solution"],
  image_target_labels: {
    stem: "题干",
    options: "选项",
    solution: "解析",
  },
};

export const IMAGE_TARGET_BY_PLACEMENT: Record<string, string[]> = {
  stem_image: ["stem"],
  explanation_image: ["solution"],
  option_image: ["options"],
};

export const DEFAULT_PERSISTED_STATE: PersistedWorkbenchState = {
  activePortraitId: "",
  activeGeneration: null,
  latestKnowledgePointDraft: "",
  latestPortraitReplyDraft: "",
  requestDraft: {
    subject: "",
    difficulty: "2",
    algorithm: "direct",
    question_type: "multiple_choice",
    content_mode: "text",
    image_mode: "none",
    image_placement: "",
    image_targets: [],
  },
  layout: {
    sidebarWidth: 240,
    chatPanelWidth: 3.4,
    inspectorWidth: 460,
    sidebarCollapsed: false,
    inspectorCollapsed: true,
  },
};
