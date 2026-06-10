const assert = require("assert");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function requestJson(baseUrl, path, init = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${path} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

async function pollPortrait(baseUrl, token, portraitId, timeoutMs) {
  const startedAt = Date.now();
  let latest;
  while (Date.now() - startedAt < timeoutMs) {
    latest = await requestJson(
      baseUrl,
      `/api/ai-question/portrait/${encodeURIComponent(portraitId)}`,
      {
        headers: {
          "x-session-token": token,
        },
      },
      timeoutMs,
    );
    const portrait = latest.body && typeof latest.body === "object" ? latest.body.portrait : null;
    const messages = portrait && Array.isArray(portrait.messages) ? portrait.messages : [];
    const authorized = messages.some((message) => (
      message
      && message.role === "assistant"
      && message.payload
      && message.payload.teacher_intent === "generate_question"
    ));
    if (portrait?.status === "ready" && portrait?.spec?.status === "ready" && authorized) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return latest;
}

async function main() {
  const baseUrl = normalizeString(process.env.TUTOR_BASE_URL) || "http://127.0.0.1:7896";
  const timeoutMsRaw = Number.parseInt(normalizeString(process.env.TUTOR_SMOKE_REQUEST_TIMEOUT_MS) || "180000", 10);
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : 180000;
  const uid = `live_smoke_${Math.random().toString(36).slice(2, 10)}`;
  const email = `${uid}@example.test`;
  const password = "Pass123456!";

  const register = await requestJson(
    baseUrl,
    "/api/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid,
        email,
        displayName: "Live Smoke",
        password,
      }),
    },
    timeoutMs,
  );
  assert(register.ok, `register failed: ${JSON.stringify(register, null, 2)}`);
  const token = register.body && register.body.token;
  assert(token, "register should return token");

  const start = await requestJson(
    baseUrl,
    "/api/ai-question/portrait/start",
    {
      method: "POST",
      headers: {
        "x-session-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "我想要一道带图题，先别生成，先帮我确认一下。",
      }),
    },
    timeoutMs,
  );
  assert(start.ok, `portrait start failed: ${JSON.stringify(start, null, 2)}`);
  const portraitId = start.body?.portrait?.portrait_id;
  assert(portraitId, "portrait start should return portrait_id");

  const initialPortrait = start.body.portrait;
  const initialMemory = initialPortrait?.session_memory;
  assert(initialMemory, "start response should include session_memory");

  const reply = await requestJson(
    baseUrl,
    `/api/ai-question/portrait/${encodeURIComponent(portraitId)}/reply`,
    {
      method: "POST",
      headers: {
        "x-session-token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "可以，学科数学，知识点一次函数，难度2，题型选择题，内容模式image，图片放题干，现在开始生成。",
      }),
    },
    timeoutMs,
  );
  assert(reply.ok, `portrait reply failed: ${JSON.stringify(reply, null, 2)}`);
  const replyPortrait = reply.body?.portrait;
  assert(replyPortrait?.session_memory, "reply response should include refreshed session_memory");
  assert(
    Array.isArray(replyPortrait.session_memory.dialogue_state)
      && replyPortrait.session_memory.dialogue_state.some((item) => String(item).includes("现在开始生成")),
    `reply session_memory should capture latest dialogue state: ${JSON.stringify(replyPortrait.session_memory, null, 2)}`,
  );

  const finalStatus = await pollPortrait(baseUrl, token, portraitId, timeoutMs);
  assert(finalStatus?.ok, `portrait poll failed: ${JSON.stringify(finalStatus, null, 2)}`);
  const finalPortrait = finalStatus.body?.portrait;
  assert(finalPortrait, "final portrait should be present");
  const finalMessages = Array.isArray(finalPortrait.messages) ? finalPortrait.messages : [];
  const finalAuthorized = finalMessages.some((message) => (
    message
    && message.role === "assistant"
    && message.payload
    && message.payload.teacher_intent === "generate_question"
  ));
  assert(finalPortrait.status === "ready", `final portrait should be ready: ${JSON.stringify(finalPortrait, null, 2)}`);
  assert(finalPortrait.spec?.status === "ready", `final spec should be ready: ${JSON.stringify(finalPortrait, null, 2)}`);
  assert(finalAuthorized, `final portrait should authorize generation: ${JSON.stringify(finalPortrait, null, 2)}`);
  assert(
    finalPortrait.session_memory
      && Array.isArray(finalPortrait.session_memory.dialogue_state)
      && finalPortrait.session_memory.dialogue_state.some((item) => String(item).includes("现在开始生成")),
    `final session_memory should still retain the latest turn: ${JSON.stringify(finalPortrait.session_memory, null, 2)}`,
  );

  console.log(JSON.stringify({
    portrait_id: portraitId,
    initial_dialogue_state: initialMemory.dialogue_state,
    reply_dialogue_state: replyPortrait.session_memory.dialogue_state,
    final_message_count: finalPortrait.messages.length,
    final_teacher_intent: "generate_question",
    final_status: finalPortrait.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
