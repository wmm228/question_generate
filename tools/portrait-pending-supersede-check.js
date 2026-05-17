const assert = require("node:assert/strict");

const {
  normalizeQuestionPortraitMessages,
  prepareQuestionPortraitMessagesForAppend,
  supersedePendingTeacherReplies,
} = require("../dist/src/services/question-portrait-store.js");

const existing = normalizeQuestionPortraitMessages([
  {
    role: "teacher",
    content: "你好呀",
    created_at: "2026-05-15T08:22:00.000Z",
    payload: {
      reply_pending: true,
      turn_id: "turn_old",
    },
  },
]);

const next = normalizeQuestionPortraitMessages([
  {
    role: "teacher",
    content: "继续",
    created_at: "2026-05-15T08:23:00.000Z",
    payload: {
      reply_pending: true,
      turn_id: "turn_new",
    },
  },
])[0];

const messages = [...supersedePendingTeacherReplies(existing, next), next];

assert.equal(messages.length, 2);
assert.equal(messages[0].payload.reply_pending, false);
assert.equal(messages[0].payload.superseded, true);
assert.equal(messages[0].payload.turn_id, "turn_old");
assert.equal(messages[1].payload.reply_pending, true);
assert.equal(messages[1].payload.turn_id, "turn_new");

const currentErrorMessages = prepareQuestionPortraitMessagesForAppend(messages, {
  role: "assistant",
  kind: "error",
  content: "error",
  created_at: "2026-05-15T08:24:00.000Z",
  payload: {
    error_for_turn_id: "turn_new",
    requires_latest_pending_turn_id: "turn_new",
  },
});

assert.ok(currentErrorMessages);
assert.equal(currentErrorMessages[1].payload.reply_pending, false);
assert.equal(typeof currentErrorMessages[1].payload.failed_at, "string");

const staleErrorMessages = prepareQuestionPortraitMessagesForAppend(messages, {
  role: "assistant",
  kind: "error",
  content: "old error",
  created_at: "2026-05-15T08:25:00.000Z",
  payload: {
    error_for_turn_id: "turn_old",
    requires_latest_pending_turn_id: "turn_old",
  },
});

assert.equal(staleErrorMessages, null);

console.log("portrait pending supersede check passed");
