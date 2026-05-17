export interface ZitadelAuthConfig {
  baseUrl: string;
  personalAccessToken: string;
  clientId: string;
  timeoutMs: number;
}

export interface ZitadelRegisterInput {
  uid: string;
  password: string;
  email: string;
  displayName?: string;
}

export interface ZitadelAuthenticatedUser {
  uid: string;
  userId?: string;
  loginName?: string;
  displayName?: string;
}

export class ZitadelRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(status: number, message: string, code: string, payload: unknown) {
    super(message);
    this.name = "ZitadelRequestError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

interface ZitadelSessionMutationResponse {
  sessionId?: string;
  sessionToken?: string;
}

interface ZitadelSessionEnvelope {
  session?: {
    factors?: {
      user?: {
        verifiedAt?: string;
        id?: string;
        loginName?: string;
        displayName?: string;
      };
      password?: {
        verifiedAt?: string;
      };
    };
  };
}

interface ZitadelCreateUserResponse {
  id?: string;
  userId?: string;
}

export interface ZitadelAuthClient {
  login(loginName: string, password: string): Promise<ZitadelAuthenticatedUser>;
  register(input: ZitadelRegisterInput): Promise<ZitadelAuthenticatedUser>;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isTruthyFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

function assertSecureBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("ZITADEL_BASE_URL is not a valid URL");
  }

  if (parsed.protocol === "https:") {
    return;
  }
  if (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)) {
    return;
  }
  if (parsed.protocol === "http:" && isTruthyFlag(process.env.ZITADEL_ALLOW_INSECURE_HTTP)) {
    return;
  }

  throw new Error(
    "ZITADEL_BASE_URL must use HTTPS unless it points to localhost or ZITADEL_ALLOW_INSECURE_HTTP=true is explicitly set.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readZitadelErrorMessage(payload: unknown, fallback: string): { message: string; code: string } {
  if (!isRecord(payload)) {
    return { message: fallback, code: "" };
  }
  const code = normalizeString(payload.code);
  const message = normalizeString(payload.message) || normalizeString(payload.error) || fallback;
  return { message, code };
}

function splitDisplayName(value: string): { givenName: string; familyName: string } {
  const parts = value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
  }
  return { givenName: value || "EduQG", familyName: "User" };
}

export function createZitadelAuthClient(config: ZitadelAuthConfig): ZitadelAuthClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  assertSecureBaseUrl(baseUrl);

  async function requestJson<T>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      query?: Record<string, string>;
    },
  ): Promise<T> {
    const url = new URL(path, `${baseUrl}/`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      method: options.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.personalAccessToken}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.trim() };
      }
    }
    if (!response.ok) {
      const error = readZitadelErrorMessage(payload, `ZITADEL request failed with ${response.status}`);
      throw new ZitadelRequestError(response.status, error.message, error.code, payload);
    }
    return payload as T;
  }

  async function readVerifiedSession(
    sessionId: string,
    sessionToken: string,
    fallbackLoginName: string,
  ): Promise<ZitadelAuthenticatedUser> {
    const envelope = await requestJson<ZitadelSessionEnvelope>(
      `/v2/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "GET",
        query: { sessionToken },
      },
    );
    const user = envelope.session?.factors?.user;
    const password = envelope.session?.factors?.password;
    const userVerifiedAt = normalizeString(user?.verifiedAt);
    const passwordVerifiedAt = normalizeString(password?.verifiedAt);
    const userId = normalizeString(user?.id);
    const loginName = normalizeString(user?.loginName) || fallbackLoginName;
    const displayName = normalizeString(user?.displayName);
    if ((!userId && !loginName) || !userVerifiedAt || !passwordVerifiedAt) {
      throw new ZitadelRequestError(502, "ZITADEL session is not fully verified", "session_not_verified", envelope);
    }
    return {
      uid: loginName || userId || fallbackLoginName,
      userId: userId || undefined,
      loginName: loginName || undefined,
      displayName: displayName || undefined,
    };
  }

  return {
    async login(loginName: string, password: string): Promise<ZitadelAuthenticatedUser> {
      const createResponse = await requestJson<ZitadelSessionMutationResponse>("/v2/sessions", {
        method: "POST",
        body: {
          checks: {
            user: {
              loginName,
            },
          },
        },
      });
      const sessionId = normalizeString(createResponse.sessionId);
      const firstSessionToken = normalizeString(createResponse.sessionToken);
      if (!sessionId || !firstSessionToken) {
        throw new ZitadelRequestError(502, "ZITADEL did not return a session", "missing_session", createResponse);
      }

      const passwordResponse = await requestJson<ZitadelSessionMutationResponse>(
        `/v2/sessions/${encodeURIComponent(sessionId)}`,
        {
          method: "PATCH",
          body: {
            checks: {
              password: {
                password,
              },
            },
          },
        },
      );
      const sessionToken = normalizeString(passwordResponse.sessionToken) || firstSessionToken;
      return readVerifiedSession(sessionId, sessionToken, loginName);
    },

    async register(input: ZitadelRegisterInput): Promise<ZitadelAuthenticatedUser> {
      const displayName = normalizeString(input.displayName) || input.uid;
      const profileName = splitDisplayName(displayName);
      const humanPayload = {
        profile: {
          givenName: profileName.givenName,
          familyName: profileName.familyName,
          displayName,
          preferredLanguage: "zh",
        },
        email: {
          email: input.email,
          isVerified: true,
        },
        password: {
          password: input.password,
          changeRequired: false,
        },
      };
      let response: ZitadelCreateUserResponse;
      try {
        response = await requestJson<ZitadelCreateUserResponse>("/v2/users/human", {
          method: "POST",
          body: {
            username: input.uid,
            ...humanPayload,
          },
        });
      } catch (error) {
        if (!(error instanceof ZitadelRequestError) || (error.status !== 404 && error.status !== 405)) {
          throw error;
        }
        response = await requestJson<ZitadelCreateUserResponse>("/v2/users/new", {
          method: "POST",
          body: {
            username: input.uid,
            human: humanPayload,
          },
        });
      }
      const userId = normalizeString(response.id) || normalizeString(response.userId);
      return {
        uid: input.uid,
        userId: userId || undefined,
        loginName: input.uid,
        displayName,
      };
    },
  };
}
