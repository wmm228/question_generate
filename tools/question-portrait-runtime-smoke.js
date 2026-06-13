require("ts-node/register/transpile-only");

const fs = require("fs");
const path = require("path");

const { getOahIntentConfig } = require("../src/services/oah-config");
const { createQuestionPortraitSeed } = require("../src/services/question-portrait");
const {
  createFileSystemQuestionPortraitStore,
  createInMemoryQuestionPortraitStore,
} = require("../src/services/question-portrait-store");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(label, values, expected) {
  assert(
    values.some((value) => String(value).includes(expected)),
    `${label} should include ${expected}; actual: ${JSON.stringify(values)}`,
  );
}

function withEnv(vars, callback) {
  const keys = Object.keys(vars);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function smokeMemoryStore(store, label) {
  const ownerUid = `memory-smoke-${label}`;
  const seed = createQuestionPortraitSeed(ownerUid, "先出一道数学一次函数选择题，难度 2。");
  const saved = await store.save(seed.portrait);

  assert(saved.session_memory, `${label}: session_memory should exist after save`);
  assertIncludes(`${label}: initial dialogue_state`, saved.session_memory.dialogue_state, "message_count=1");
  assertIncludes(`${label}: initial dialogue_state`, saved.session_memory.dialogue_state, "先出一道数学一次函数选择题");

  const appendedAt = "2030-01-02T03:04:05.000Z";
  const appended = await store.appendMessage(ownerUid, saved.portrait_id, {
    role: "teacher",
    content: "我还需要一道带图题，图片放题干就行。",
    created_at: appendedAt,
  });

  assert(appended, `${label}: appendMessage should return a document`);
  assert(appended.session_memory, `${label}: session_memory should exist after append`);
  assert(appended.session_memory.updated_at === appendedAt, `${label}: memory updated_at should follow latest message`);
  assertIncludes(`${label}: appended dialogue_state`, appended.session_memory.dialogue_state, "message_count=2");
  assertIncludes(`${label}: appended dialogue_state`, appended.session_memory.dialogue_state, "带图题");
  assert(appended.session_memory.summary.includes("带图题"), `${label}: summary should include compressed dialogue state`);

  const stale = await store.save({
    ...appended,
    session_memory: {
      version: "question-portrait-memory.v1",
      summary: "stale",
      stable_facts: [],
      open_items: [],
      dialogue_state: [],
      updated_at: "1999-01-01T00:00:00.000Z",
    },
  });
  assert(stale.session_memory.summary !== "stale", `${label}: save should recompute stale memory`);
}

function smokeIntentConfig() {
  withEnv({
    OAH_MODEL_NAME: "platform/main-model",
    OAH_INTENT_MODEL_NAME: "",
    OAH_INTENT_AGENT_NAME: "",
  }, () => {
    const config = getOahIntentConfig();
    assert(config.intentAgentName === "question-orchestrator", "intent agent should default to question-orchestrator");
    assert(config.intentModel === "platform/main-model", "intent model should fall back to OAH_MODEL_NAME");
  });

  withEnv({
    OAH_MODEL_NAME: "platform/main-model",
    OAH_INTENT_MODEL_NAME: "platform/intent-model",
    OAH_INTENT_AGENT_NAME: "custom-intent-agent",
  }, () => {
    const config = getOahIntentConfig();
    assert(config.intentAgentName === "custom-intent-agent", "intent agent should use OAH_INTENT_AGENT_NAME");
    assert(config.intentModel === "platform/intent-model", "intent model should use OAH_INTENT_MODEL_NAME");
  });
}

async function run() {
  await smokeMemoryStore(createInMemoryQuestionPortraitStore(), "memory");

  const baseDirectory = path.resolve(process.cwd(), ".tmp", `question-portrait-runtime-smoke-${Date.now()}`);
  fs.mkdirSync(baseDirectory, { recursive: true });
  await smokeMemoryStore(createFileSystemQuestionPortraitStore({ baseDirectory }), "filesystem");

  smokeIntentConfig();
  console.log("question portrait runtime smoke passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
