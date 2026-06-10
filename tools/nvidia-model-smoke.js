const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-nano-30b-a3b";

for (const envFile of [".env.nvidia.local", ".env.nvidia", ".env.local"]) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false, quiet: true });
  }
}

function trim(value) {
  return String(value || "").trim();
}

function normalizeBaseUrl(value) {
  return trim(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function readPrompt() {
  const args = process.argv.slice(2).map(trim).filter(Boolean);
  return args.join(" ") || "What is 2 + 2? Reply with only the number.";
}

function readPositiveIntegerEnv(name) {
  const parsed = Number.parseInt(trim(process.env[name]), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractText(message) {
  const content = message && message.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("")
      .trim();
  }
  return "";
}

async function main() {
  const apiKey = trim(process.env.NVIDIA_API_KEY || process.env.NGC_API_KEY);
  const baseUrl = normalizeBaseUrl(process.env.NVIDIA_BASE_URL);
  const model = trim(process.env.NVIDIA_MODEL_NAME || process.env.NVIDIA_MODEL) || DEFAULT_MODEL;
  const prompt = readPrompt();
  const maxThinkingTokens = readPositiveIntegerEnv("NVIDIA_MAX_THINKING_TOKENS");

  if (!apiKey) {
    console.error("NVIDIA_API_KEY is not configured.");
    console.error("Copy .env.nvidia.example to .env.nvidia.local, fill NVIDIA_API_KEY, then run: npm run smoke:nvidia");
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.2,
    max_tokens: 128,
    stream: false,
  };
  if (maxThinkingTokens) {
    payload.max_thinking_tokens = maxThinkingTokens;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = await response.text();
  if (!response.ok) {
    console.error(`NVIDIA model smoke failed: HTTP ${response.status}`);
    console.error(body);
    process.exitCode = 1;
    return;
  }

  const json = JSON.parse(body);
  const message = json.choices && json.choices[0] && json.choices[0].message;
  const text = extractText(message);
  const reasoning = trim(message && (message.reasoning_content || message.reasoningContent));

  console.log(`base_url=${baseUrl}`);
  console.log(`model=${model}`);
  console.log(`latency_ms=${Date.now() - startedAt}`);
  if (reasoning) {
    console.log(`reasoning=${reasoning}`);
  }
  console.log(`answer=${text || body}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
