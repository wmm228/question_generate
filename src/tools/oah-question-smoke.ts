interface RequestResult {
  status: number;
  ok: boolean;
  body: unknown;
}

interface RegisterResponseBody {
  ok?: boolean;
  token?: string;
  uid?: string;
  error?: string;
}

function normalizeString(value: string | undefined): string {
  return (value || "").trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function requestJson(baseUrl: string, path: string, init: RequestInit = {}): Promise<RequestResult> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

async function main(): Promise<void> {
  const tutorBaseUrl = normalizeString(process.env.TUTOR_BASE_URL) || "http://127.0.0.1:7896";
  const waitMsRaw = Number.parseInt(normalizeString(process.env.TUTOR_SMOKE_WAIT_MS) || "0", 10);
  const waitMs = Number.isFinite(waitMsRaw) && waitMsRaw > 0 ? waitMsRaw : 0;
  const requestId = `smoke-${Date.now()}`;
  const uid = `smoke_${Math.random().toString(36).slice(2, 10)}`;
  const password = "Pass123456!";

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  const register = await requestJson(tutorBaseUrl, "/api/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uid,
      password,
    }),
  });

  const registerBody = register.body as RegisterResponseBody | null;
  const token = registerBody?.token;
  if (!register.ok || !token) {
    throw new Error(`register failed: ${JSON.stringify(register, null, 2)}`);
  }

  const authHeaders: Record<string, string> = {
    "x-session-token": token,
  };

  const oahStatus = await requestJson(tutorBaseUrl, "/api/ai-question/oah-status", {
    method: "GET",
    headers: authHeaders,
  });

  const generate = await requestJson(tutorBaseUrl, "/api/ai-question/generate", {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "application/json",
      "x-request-uuid": requestId,
    },
    body: JSON.stringify({
      knowledge_point: "linear function graph interpretation",
      difficulty: "2",
      algorithm: "direct",
      question_type: "multiple_choice",
      content_mode: "text",
      image_placement: "",
      image_targets: [],
      image_mode: "none",
    }),
  });

  const progress = await requestJson(
    tutorBaseUrl,
    `/api/ai-question/status/${encodeURIComponent(requestId)}`,
    {
      method: "GET",
      headers: authHeaders,
    },
  );

  console.log(
    JSON.stringify(
      {
        tutor_base_url: tutorBaseUrl,
        uid,
        request_id: requestId,
        register,
        oah_status: oahStatus,
        generate,
        progress,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
