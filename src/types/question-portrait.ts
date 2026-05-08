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
export type QuestionPortraitPendingField =
  | QuestionControlledFieldKey
  | "teacher_profile"
  | "student_profile"
  | "none";

export interface QuestionPortraitDraft {
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

export interface QuestionPortraitDocument {
  portrait_id: string;
  owner_uid: string;
  title: string;
  status: QuestionPortraitStatus;
  pending_field: QuestionPortraitPendingField;
  summary: string;
  guidance: QuestionPortraitGuidance;
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
}

export interface QuestionPortraitTurnResult {
  portrait: QuestionPortraitDocument;
  assistant_message: string;
}
