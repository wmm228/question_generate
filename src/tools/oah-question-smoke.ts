import * as http from "node:http";
import * as https from "node:https";

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

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (
    typeof headers === "object"
    && "entries" in headers
    && typeof (headers as { entries?: unknown }).entries === "function"
  ) {
    return Object.fromEntries((headers as { entries: () => Iterable<[string, string]> }).entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  if (typeof headers !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
  );
}

async function requestJson(
  baseUrl: string,
  requestPath: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<RequestResult> {
  return new Promise<RequestResult>((resolve, reject) => {
    const target = new URL(requestPath, baseUrl);
    const body = typeof init.body === "string" || Buffer.isBuffer(init.body)
      ? init.body
      : undefined;
    const headers = normalizeHeaders(init.headers);
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["Content-Length"] = String(Buffer.byteLength(body));
    }

    const client = target.protocol === "https:" ? https : http;
    const timeout = setTimeout(() => {
      request.destroy(new Error(`${requestPath} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const request = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method || "GET",
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          clearTimeout(timeout);
          const text = Buffer.concat(chunks).toString("utf8");
          let parsedBody: unknown = null;
          if (text.trim()) {
            try {
              parsedBody = JSON.parse(text);
            } catch {
              parsedBody = text;
            }
          }
          const status = response.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: parsedBody,
          });
        });
      },
    );

    request.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function main(): Promise<void> {
  const tutorBaseUrl = normalizeString(process.env.TUTOR_BASE_URL) || "http://127.0.0.1:7896";
  const waitMsRaw = Number.parseInt(normalizeString(process.env.TUTOR_SMOKE_WAIT_MS) || "0", 10);
  const waitMs = Number.isFinite(waitMsRaw) && waitMsRaw > 0 ? waitMsRaw : 0;
  const requestTimeoutMsRaw = Number.parseInt(
    normalizeString(process.env.TUTOR_SMOKE_REQUEST_TIMEOUT_MS) || "30000",
    10,
  );
  const requestTimeoutMs = Number.isFinite(requestTimeoutMsRaw) && requestTimeoutMsRaw > 0
    ? requestTimeoutMsRaw
    : 30000;
  const requestId = `smoke-${Date.now()}`;
  const uid = `smoke_${Math.random().toString(36).slice(2, 10)}`;
  const email = `${uid}@example.test`;
  const password = "Pass123456!";

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  const register = await requestJson(
    tutorBaseUrl,
    "/api/register",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        uid,
        email,
        displayName: "Smoke Tester",
        password,
      }),
    },
    requestTimeoutMs,
  );

  const registerBody = register.body as RegisterResponseBody | null;
  const token = registerBody?.token;
  if (!register.ok || !token) {
    throw new Error(`register failed: ${JSON.stringify(register, null, 2)}`);
  }

  const authHeaders: Record<string, string> = {
    "x-session-token": token,
  };

  const oahStatus = await requestJson(
    tutorBaseUrl,
    "/api/ai-question/oah-status",
    {
      method: "GET",
      headers: authHeaders,
    },
    requestTimeoutMs,
  );

  const generate = await requestJson(
    tutorBaseUrl,
    "/api/ai-question/generate",
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
        "x-request-uuid": requestId,
      },
      body: JSON.stringify({
        subject: "数学",
        knowledge_point: "linear function graph interpretation",
        difficulty: "2",
        algorithm: "direct",
        question_type: "multiple_choice",
        content_mode: "text",
        image_placement: "",
        image_targets: [],
        image_mode: "none",
      }),
    },
    requestTimeoutMs,
  );

  const progress = await requestJson(
    tutorBaseUrl,
    `/api/ai-question/status/${encodeURIComponent(requestId)}`,
    {
      method: "GET",
      headers: authHeaders,
    },
    requestTimeoutMs,
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
