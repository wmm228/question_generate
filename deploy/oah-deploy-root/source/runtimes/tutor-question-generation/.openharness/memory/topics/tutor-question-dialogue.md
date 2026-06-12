---
name: tutor-question-dialogue
description: Durable rules for Tutor question-generation dialogue and memory handling.
type: project
---

Intent recognition must be semantic and context-aware. Do not implement generation authorization with hardcoded trigger text, keyword tables, or regular expressions.

Why: teachers often confirm or amend requirements in natural language across multiple turns, so the system must infer intent from the normalized spec, current teacher message, recent dialogue, and memory state.

How to apply: `intent-recognizer` decides whether the current teacher turn authorizes immediate generation after normalization. Recent messages are short-term context, `session_memory` is compressed long-term dialogue state for the current conversation, and teacher/student profiles are stable portrait signals rather than dialogue memory.

The `edu-question-spec.v1` contract remains the source of truth for question generation. Human-controlled fields such as subject, knowledge point, difficulty, question type, content mode, algorithm, and image requirements must come from the teacher or business request, not from profile inference or memory defaults.

Business defaults are allowed when the teacher has not expressed a conflicting preference: use `direct` for the generation algorithm, and use `stem_image` / `image_targets=["stem"]` for image questions without an explicit placement.

When a normalized spec is ready and the teacher asks why no question appeared, asks for the question, or accepts a confirmation in context, treat that as possible generation authorization and let `intent-recognizer` make the final semantic decision.
