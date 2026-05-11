import { signInWithCustomToken, signInWithEmailAndPassword, type Auth, type User } from "firebase/auth";

export type UserRole = "admin" | "user";
export type AdminScope = "none" | "operator" | "super_admin";

type LoginResponse = {
  customToken?: string;
};

type SessionBootstrapResponse = {
  role?: string;
  adminScope?: string;
  adminRoster?: unknown;
  superAdminRoster?: unknown;
  tokenRefreshRequired?: boolean;
};

const API_BASE_URL = (import.meta.env.VITE_AI_PROXY_BASE_URL as string | undefined)?.trim() || "/api";
const AUTH_LOGIN_URL = `${API_BASE_URL.replace(/\/$/, "")}/auth/login`;
const AUTH_SESSION_BOOTSTRAP_URL = `${API_BASE_URL.replace(/\/$/, "")}/auth/session/bootstrap`;
const ENABLE_AI_PROXY = (import.meta.env.VITE_ENABLE_AI_PROXY ?? "true").trim().toLowerCase() !== "false";

const fallbackUserSession = {
  role: "user" as const,
  adminScope: "none" as const,
  adminRoster: [] as string[],
  superAdminRoster: [] as string[],
};

const normalizeEmailList = (value: unknown) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    : [];

const parseApiErrorCode = async (response: Response, fallback: string) => {
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as { error?: string };
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // ignore malformed error payloads
  }
  return fallback;
};

export const signInWithIdentifier = async (auth: Auth, identifier: string, password: string) => {
  const normalizedIdentifier = identifier.trim();
  const isEmailIdentifier = normalizedIdentifier.includes("@");

  if (!ENABLE_AI_PROXY) {
    if (!isEmailIdentifier) {
      throw new Error("USERNAME_LOGIN_REQUIRES_PROXY");
    }
    return signInWithEmailAndPassword(auth, normalizedIdentifier, password);
  }

  const response = await fetch(AUTH_LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifier: normalizedIdentifier,
      password,
    }),
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 405 || response.status === 503) {
      if (!isEmailIdentifier) {
        throw new Error("USERNAME_LOGIN_REQUIRES_PROXY");
      }
      return signInWithEmailAndPassword(auth, normalizedIdentifier, password);
    }
    throw new Error(await parseApiErrorCode(response, "AUTH_LOGIN_FAILED"));
  }

  const payload = (await response.json()) as LoginResponse;
  const customToken = payload.customToken?.trim() ?? "";
  if (!customToken) {
    throw new Error("AUTH_LOGIN_FAILED");
  }

  return signInWithCustomToken(auth, customToken);
};

export const bootstrapAuthSession = async (user: User) => {
  if (!ENABLE_AI_PROXY) {
    return fallbackUserSession;
  }

  const postBootstrap = async (forceRefresh: boolean) => {
    const token = await user.getIdToken(forceRefresh);
    return fetch(AUTH_SESSION_BOOTSTRAP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
  };

  let response: Response;
  try {
    response = await postBootstrap(false);
  } catch {
    return fallbackUserSession;
  }

  if (response.status === 401) {
    try {
      response = await postBootstrap(true);
    } catch {
      throw new Error("UNAUTHORIZED");
    }
  }

  if (response.status === 404 || response.status === 405 || response.status === 503) {
    return fallbackUserSession;
  }

  if (!response.ok) {
    throw new Error(await parseApiErrorCode(response, "SESSION_BOOTSTRAP_FAILED"));
  }

  let payload: SessionBootstrapResponse;
  try {
    payload = (await response.json()) as SessionBootstrapResponse;
  } catch {
    return fallbackUserSession;
  }

  if (payload.tokenRefreshRequired) {
    await user.getIdToken(true);
  }

  return {
    role: payload.role === "admin" ? ("admin" as const) : ("user" as const),
    adminScope:
      payload.adminScope === "super_admin"
        ? ("super_admin" as const)
        : payload.adminScope === "operator"
        ? ("operator" as const)
        : ("none" as const),
    adminRoster: normalizeEmailList(payload.adminRoster),
    superAdminRoster: normalizeEmailList(payload.superAdminRoster),
  };
};
