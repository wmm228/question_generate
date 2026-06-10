import type {
  AiGenAlgorithm,
  AiGenContentMode,
  AiGenImageMode,
  AiGenImagePlacementOrEmpty,
  AiGenImageTarget,
  AiGenQuestionType,
} from "./ai-generate";
import type {
  QuestionAgentPlan,
  QuestionControlledFieldKey,
  QuestionGenerationSpec,
  StudentProfile,
  TeacherPreferenceProfile,
} from "./question-agent";

export type QuestionPortraitStatus = "draft" | "ready";
export type QuestionPortraitRole = "teacher" | "assistant";
export type QuestionPortraitMessageKind = "text" | "generated_question" | "notice" | "error";
export type QuestionPortraitTeacherIntent = "continue_portrait" | "generate_question";
export type QuestionPortraitPendingField =
  | "subject"
  | QuestionControlledFieldKey
  | "teacher_profile"
  | "student_profile"
  | "none";

export interface QuestionPortraitDraft {
  subject: string;
  knowledge_point: string;
  difficulty: string;
  algorithm: AiGenAlgorithm | "";
  question_type: AiGenQuestionType | "";
  content_mode: AiGenContentMode | "";
  image_mode: AiGenImageMode;
  image_placement: AiGenImagePlacementOrEmpty;
  image_targets: AiGenImageTarget[];
  teacher_profile: Partial<TeacherPreferenceProfile>;
  student_profile: Partial<StudentProfile>;
}

export interface QuestionPortraitMessage {
  role: QuestionPortraitRole;
  content: string;
  created_at: string;
  kind?: QuestionPortraitMessageKind;
  request_id?: string;
  payload?: unknown;
}

export interface QuestionPortraitAttachment {
  id: string;
  name: string;
  mime_type: string;
  size: number;
  data_url: string;
}

export interface QuestionPortraitRemoteSession {
  workspace_id: string;
  session_id: string;
  agent_name: string;
}

export interface QuestionPortraitGuidance {
  status_explanation: string;
  missing_items: string[];
  teacher_checklist: string[];
  next_step: string;
}

export interface QuestionPortraitMemory {
  version: "question-portrait-memory.v1";
  summary: string;
  stable_facts: string[];
  open_items: string[];
  dialogue_state: string[];
  updated_at: string;
}

export interface QuestionPortraitDocument {
  portrait_id: string;
  owner_uid: string;
  title: string;
  status: QuestionPortraitStatus;
  pending_field: QuestionPortraitPendingField;
  summary: string;
  guidance: QuestionPortraitGuidance;
  session_memory?: QuestionPortraitMemory;
  draft: QuestionPortraitDraft;
  spec: QuestionGenerationSpec;
  plan: QuestionAgentPlan;
  validation_errors: string[];
  messages: QuestionPortraitMessage[];
  remote_session: QuestionPortraitRemoteSession | null;
  markdown: string;
  markdown_path: string | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

export interface QuestionPortraitTurnResult {
  portrait: QuestionPortraitDocument;
  assistant_message: string;
  teacher_intent: QuestionPortraitTeacherIntent;
}
