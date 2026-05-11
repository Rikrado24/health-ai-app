import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const FIREBASE_PASSWORD_SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://sehatai-68f20.web.app",
  "https://sehatai-68f20.firebaseapp.com",
  "http://localhost",
  "http://127.0.0.1",
  "capacitor://localhost",
];
const DEFAULT_ALLOWED_RESPONSE_MODELS = ["gpt-5.2", "gpt-4.1-mini", "gpt-4.1"];
const DEFAULT_ALLOWED_TRANSCRIPTION_MODELS = ["gpt-4o-mini-transcribe"];
const MAX_RESPONSE_BODY_BYTES = 5 * 1024 * 1024;
const MAX_AUDIO_BODY_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 700;
const MAX_INPUT_ITEMS = 8;
const MAX_CONTENT_ITEMS = 10;
const MAX_TEXT_LENGTH = 12000;
const MAX_IMAGE_DATA_URL_LENGTH = 3_500_000;
const MAX_RESPONSE_REQUESTS_PER_WINDOW = 12;
const MAX_TRANSCRIPTION_REQUESTS_PER_WINDOW = 6;
const MAX_PUBLIC_LOGIN_REQUESTS_PER_WINDOW = 8;
const MAX_DEVICE_MEASUREMENT_REQUESTS_PER_WINDOW = 24;
const RATE_LIMIT_WINDOW_MS = 60_000;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

type ProxyTool = { type: "web_search_preview" };
type ProxyContentItem =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };
type ProxyInputItem = {
  role: "user" | "system" | "developer";
  content: ProxyContentItem[];
};
type ProxyResponsesPayload = {
  model: string;
  input: ProxyInputItem[];
  max_output_tokens: number;
  temperature: number;
  tools?: ProxyTool[];
};
type RateLimitEntry = {
  count: number;
  resetAt: number;
};
type SessionRole = "admin" | "user";
type AdminScope = "none" | "operator" | "super_admin";
type SessionState = {
  role: SessionRole;
  adminScope: AdminScope;
  adminRoster: string[];
  superAdminRoster: string[];
  claims: Record<string, true>;
  claimsUpdated: boolean;
};
type DeviceMeasurementPayload = {
  ownerUid: string;
  ownerEmail: string;
  heightCm: number;
  weightKg: number;
  measuredAtMs: number;
  deviceId: string;
  sessionId: string;
};

const responseRateLimits = new Map<string, RateLimitEntry>();
const transcriptionRateLimits = new Map<string, RateLimitEntry>();
const publicLoginRateLimits = new Map<string, RateLimitEntry>();
const deviceMeasurementRateLimits = new Map<string, RateLimitEntry>();

const json = (value: unknown) => JSON.stringify(value);

const parseConfiguredValues = (value: string | undefined, fallback: string[]) => {
  const parsed = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

const getAllowedOrigins = () => parseConfiguredValues(process.env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
const getAllowedResponseModels = () =>
  parseConfiguredValues(process.env.OPENAI_ALLOWED_RESPONSE_MODELS, DEFAULT_ALLOWED_RESPONSE_MODELS);
const getAllowedTranscriptionModels = () =>
  parseConfiguredValues(process.env.OPENAI_ALLOWED_TRANSCRIPTION_MODELS, DEFAULT_ALLOWED_TRANSCRIPTION_MODELS);
const getDeviceIngestApiKeys = () => parseConfiguredValues(process.env.DEVICE_INGEST_API_KEYS, []);

const extractBearerToken = (value: string | undefined) => {
  if (!value) return "";
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "";
  return token.trim();
};

const verifyUser = async (authHeader: string | undefined) => {
  const token = extractBearerToken(authHeader);
  if (!token) {
    throw new Error("AUTH_REQUIRED");
  }
  return getAuth().verifyIdToken(token);
};

const firstHeaderValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value ?? "");

const getClientAddress = (req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }) => {
  const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bodySizeOf = (value: Uint8Array | Buffer | undefined) => {
  if (!value) return 0;
  return value.byteLength;
};

const resolveAllowedOrigin = (originHeader: string | undefined) => {
  const origin = originHeader?.trim();
  if (!origin) return "";
  return getAllowedOrigins().includes(origin) ? origin : "";
};

const applyCors = (originHeader: string | undefined, res: { setHeader: (name: string, value: string) => void }) => {
  const allowedOrigin = resolveAllowedOrigin(originHeader);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }
  return allowedOrigin;
};

const isHttpsUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const sanitizeContentItem = (item: unknown): ProxyContentItem | null => {
  if (!isPlainObject(item) || typeof item.type !== "string") return null;
  if (item.type === "input_text") {
    if (typeof item.text !== "string") return null;
    const text = item.text.trim();
    if (!text || text.length > MAX_TEXT_LENGTH) return null;
    return { type: "input_text", text };
  }
  if (item.type === "input_image") {
    if (typeof item.image_url !== "string") return null;
    const imageUrl = item.image_url.trim();
    if (!imageUrl) return null;
    if (imageUrl.startsWith("data:image/")) {
      if (imageUrl.length > MAX_IMAGE_DATA_URL_LENGTH) return null;
      return { type: "input_image", image_url: imageUrl };
    }
    if (!isHttpsUrl(imageUrl)) return null;
    return { type: "input_image", image_url: imageUrl };
  }
  return null;
};

const sanitizeInputItem = (item: unknown): ProxyInputItem | null => {
  if (!isPlainObject(item) || typeof item.role !== "string" || !Array.isArray(item.content)) return null;
  if (!["user", "system", "developer"].includes(item.role)) return null;
  if (item.content.length === 0 || item.content.length > MAX_CONTENT_ITEMS) return null;
  const content = item.content
    .map((entry) => sanitizeContentItem(entry))
    .filter((entry): entry is ProxyContentItem => entry !== null);
  if (content.length !== item.content.length) return null;
  return {
    role: item.role as ProxyInputItem["role"],
    content,
  };
};

const sanitizeTools = (value: unknown): ProxyTool[] | undefined => {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > 1) return undefined;
  const tools = value
    .filter((item) => isPlainObject(item) && item.type === "web_search_preview")
    .map(() => ({ type: "web_search_preview" as const }));
  if (tools.length !== value.length) return undefined;
  return tools;
};

const sanitizeResponsesPayload = (body: unknown, rawBody: Uint8Array | Buffer | undefined): ProxyResponsesPayload | null => {
  if (bodySizeOf(rawBody) > MAX_RESPONSE_BODY_BYTES) return null;
  if (!isPlainObject(body)) return null;

  const allowedModels = getAllowedResponseModels();
  if (typeof body.model !== "string" || !allowedModels.includes(body.model)) return null;
  if (!Array.isArray(body.input) || body.input.length === 0 || body.input.length > MAX_INPUT_ITEMS) return null;

  const input = body.input.map((item) => sanitizeInputItem(item)).filter((item): item is ProxyInputItem => item !== null);
  if (input.length !== body.input.length) return null;

  const requestedMaxTokens =
    typeof body.max_output_tokens === "number" && Number.isFinite(body.max_output_tokens)
      ? Math.floor(body.max_output_tokens)
      : 300;
  const max_output_tokens = Math.max(1, Math.min(MAX_OUTPUT_TOKENS, requestedMaxTokens));

  const requestedTemperature =
    typeof body.temperature === "number" && Number.isFinite(body.temperature) ? body.temperature : 0.4;
  const temperature = Math.max(0, Math.min(1.2, requestedTemperature));

  const tools = sanitizeTools(body.tools);
  if (body.tools != null && !tools) return null;

  return {
    model: body.model,
    input,
    max_output_tokens,
    temperature,
    ...(tools ? { tools } : {}),
  };
};

const extractMultipartField = (rawBody: Uint8Array | Buffer | undefined, fieldName: string) => {
  if (!rawBody) return "";
  const bodyText = Buffer.from(rawBody).toString("latin1");
  const pattern = new RegExp(`name="${fieldName}"\\r\\n\\r\\n([^\\r\\n]+)`, "i");
  const match = bodyText.match(pattern);
  return match?.[1]?.trim() ?? "";
};

const sanitizeTranscriptionRequest = (
  contentTypeHeader: string | undefined,
  rawBody: Uint8Array | Buffer | undefined
) => {
  const contentType = String(contentTypeHeader ?? "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return { ok: false as const, error: "INVALID_CONTENT_TYPE" };
  }
  if (bodySizeOf(rawBody) === 0 || bodySizeOf(rawBody) > MAX_AUDIO_BODY_BYTES) {
    return { ok: false as const, error: "AUDIO_PAYLOAD_TOO_LARGE" };
  }

  const model = extractMultipartField(rawBody, "model");
  if (!model || !getAllowedTranscriptionModels().includes(model)) {
    return { ok: false as const, error: "MODEL_NOT_ALLOWED" };
  }

  const language = extractMultipartField(rawBody, "language");
  if (language && !["id", "en"].includes(language)) {
    return { ok: false as const, error: "LANGUAGE_NOT_ALLOWED" };
  }

  return {
    ok: true as const,
    contentType,
  };
};

const touchRateLimit = (store: Map<string, RateLimitEntry>, key: string, maxRequests: number) => {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (existing.count >= maxRequests) {
    return true;
  }

  existing.count += 1;
  return false;
};

const proxyEnabled = () => (process.env.OPENAI_PROXY_ENABLED ?? "true").toLowerCase() !== "false";
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const isEmailIdentifier = (value: string) => value.includes("@");

const parseConfiguredEmails = (value: string | undefined) =>
  Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((item) => normalizeEmail(item))
        .filter(Boolean)
    )
  );

const getAdminRoster = () => parseConfiguredEmails(process.env.ADMIN_EMAILS);

const getSuperAdminRoster = () => {
  const adminRoster = getAdminRoster();
  const explicit = parseConfiguredEmails(process.env.SUPER_ADMIN_EMAILS).filter((email) => adminRoster.includes(email));
  return explicit.length > 0 ? explicit : adminRoster.slice(0, 1);
};

const buildSessionStateForEmail = (email: string): Omit<SessionState, "claimsUpdated"> => {
  const normalizedEmail = normalizeEmail(email);
  const adminRoster = getAdminRoster();
  const superAdminRoster = getSuperAdminRoster();
  const isAdmin = normalizedEmail !== "" && adminRoster.includes(normalizedEmail);
  const adminScope: AdminScope = !isAdmin
    ? "none"
    : superAdminRoster.includes(normalizedEmail)
    ? "super_admin"
    : "operator";

  const claims: Record<string, true> = {};
  if (isAdmin) claims.admin = true;
  if (adminScope === "super_admin") claims.super_admin = true;

  return {
    role: isAdmin ? "admin" : "user",
    adminScope,
    adminRoster,
    superAdminRoster,
    claims,
  };
};

const syncUserSession = async (uid: string, emailHint: string) => {
  const adminAuth = getAuth();
  const userRecord = await adminAuth.getUser(uid);
  const resolvedEmail = normalizeEmail(emailHint || userRecord.email || "");
  const sessionState = buildSessionStateForEmail(resolvedEmail);
  const existingClaims = userRecord.customClaims ?? {};
  const nextClaims = { ...existingClaims } as Record<string, unknown>;

  const shouldHaveAdminClaim = sessionState.role === "admin";
  const shouldHaveSuperAdminClaim = sessionState.adminScope === "super_admin";

  if (shouldHaveAdminClaim) nextClaims.admin = true;
  else delete nextClaims.admin;

  if (shouldHaveSuperAdminClaim) nextClaims.super_admin = true;
  else delete nextClaims.super_admin;

  const claimsUpdated =
    Boolean(existingClaims.admin) !== shouldHaveAdminClaim ||
    Boolean(existingClaims.super_admin) !== shouldHaveSuperAdminClaim;

  if (claimsUpdated) {
    await adminAuth.setCustomUserClaims(uid, nextClaims);
  }

  return {
    ...sessionState,
    claimsUpdated,
  } satisfies SessionState;
};

const parseIdentityToolkitErrorCode = (text: string) => {
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } };
    return payload.error?.message?.trim() ?? "";
  } catch {
    return "";
  }
};

const getFirebaseWebApiKey = () => (process.env.FIREBASE_WEB_API_KEY ?? process.env.FIREBASE_API_KEY ?? "").trim();

const resolveLoginEmail = async (identifier: string) => {
  const db = getFirestore();
  const normalizedIdentifier = normalizeUsername(identifier);

  const usernameDoc = await db.collection("usernames").doc(normalizedIdentifier).get();
  if (usernameDoc.exists) {
    const ownerEmail = String(usernameDoc.data()?.ownerEmail ?? "").trim().toLowerCase();
    if (ownerEmail) return ownerEmail;
  }

  const profileSnapshot = await db.collection("userProfiles").where("username", "==", normalizedIdentifier).limit(1).get();
  if (!profileSnapshot.empty) {
    const ownerEmail = String(profileSnapshot.docs[0]?.data()?.ownerEmail ?? "").trim().toLowerCase();
    if (ownerEmail) return ownerEmail;
  }

  return "";
};

const sanitizeLoginRequest = (body: unknown) => {
  if (!isPlainObject(body) || typeof body.identifier !== "string" || typeof body.password !== "string") {
    return null;
  }

  const identifier = normalizeUsername(body.identifier);
  const password = body.password;
  if (!identifier || !password) return null;
  if (!isEmailIdentifier(identifier) && !USERNAME_PATTERN.test(identifier)) return null;

  return {
    identifier,
    password,
  };
};

const sanitizeDeviceMeasurementPayload = (body: unknown): DeviceMeasurementPayload | null => {
  if (!isPlainObject(body)) return null;

  const ownerUid = typeof body.ownerUid === "string" ? body.ownerUid.trim() : "";
  const ownerEmail = typeof body.ownerEmail === "string" ? normalizeEmail(body.ownerEmail) : "";
  const heightCm = typeof body.heightCm === "number" ? Number(body.heightCm) : Number.NaN;
  const weightKg = typeof body.weightKg === "number" ? Number(body.weightKg) : Number.NaN;
  const measuredAtMsRaw = typeof body.measuredAtMs === "number" ? Number(body.measuredAtMs) : Date.now();
  const deviceIdRaw = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const sessionIdRaw = typeof body.sessionId === "string" ? body.sessionId.trim() : "";

  if (!ownerUid || ownerUid.length > 200) return null;
  if (!ownerEmail || ownerEmail.length > 254) return null;
  if (!Number.isFinite(heightCm) || heightCm < 50 || heightCm > 250) return null;
  if (!Number.isFinite(weightKg) || weightKg < 10 || weightKg > 350) return null;
  if (!Number.isFinite(measuredAtMsRaw)) return null;

  const now = Date.now();
  const measuredAtMs = Math.floor(measuredAtMsRaw);
  if (measuredAtMs < now - 1000 * 60 * 60 * 24 * 7 || measuredAtMs > now + 1000 * 60 * 5) return null;

  return {
    ownerUid,
    ownerEmail,
    heightCm: Number(heightCm.toFixed(1)),
    weightKg: Number(weightKg.toFixed(1)),
    measuredAtMs,
    deviceId: deviceIdRaw || "raspi-device-1",
    sessionId: sessionIdRaw || `raspi-${measuredAtMs}`,
  };
};

const extractDeviceApiKey = (req: { headers: Record<string, string | string[] | undefined> }) => {
  const direct = firstHeaderValue(req.headers["x-device-key"]).trim();
  if (direct) return direct;
  return extractBearerToken(firstHeaderValue(req.headers.authorization));
};

const hasValidDeviceApiKey = (value: string) => {
  const configuredKeys = getDeviceIngestApiKeys();
  return value !== "" && configuredKeys.includes(value);
};

export const aiProxy = onRequest({ region: "asia-southeast2", invoker: "public" }, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const allowedOrigin = applyCors(req.headers.origin, res);

  if (req.headers.origin && !allowedOrigin) {
    res.status(403).send(json({ error: "ORIGIN_NOT_ALLOWED" }));
    return;
  }

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  if (req.method !== "POST") {
    res.status(405).send(json({ error: "METHOD_NOT_ALLOWED" }));
    return;
  }

  const path = req.path.endsWith("/") ? req.path.slice(0, -1) : req.path;
  if (path.endsWith("/auth/login")) {
    if (touchRateLimit(publicLoginRateLimits, `${getClientAddress(req)}:login`, MAX_PUBLIC_LOGIN_REQUESTS_PER_WINDOW)) {
      res.status(429).send(json({ error: "RATE_LIMITED" }));
      return;
    }

    const loginRequest = sanitizeLoginRequest(req.body);
    if (!loginRequest) {
      res.status(400).send(json({ error: "INVALID_LOGIN_REQUEST" }));
      return;
    }

    const firebaseWebApiKey = getFirebaseWebApiKey();
    if (!firebaseWebApiKey) {
      res.status(500).send(json({ error: "AUTH_PROVIDER_MISCONFIGURED" }));
      return;
    }

    const email = isEmailIdentifier(loginRequest.identifier)
      ? normalizeEmail(loginRequest.identifier)
      : await resolveLoginEmail(loginRequest.identifier);
    if (!email) {
      res.status(401).send(json({ error: "INVALID_CREDENTIALS" }));
      return;
    }

    const upstream = await fetch(`${FIREBASE_PASSWORD_SIGN_IN_URL}?key=${encodeURIComponent(firebaseWebApiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: json({
        email,
        password: loginRequest.password,
        returnSecureToken: true,
      }),
    });

    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      const upstreamError = parseIdentityToolkitErrorCode(upstreamText);
      if (
        ["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS", "USER_DISABLED"].includes(upstreamError)
      ) {
        res.status(401).send(json({ error: "INVALID_CREDENTIALS" }));
        return;
      }
      if (upstreamError === "TOO_MANY_ATTEMPTS_TRY_LATER") {
        res.status(429).send(json({ error: "RATE_LIMITED" }));
        return;
      }
      res.status(502).send(json({ error: "AUTH_PROVIDER_ERROR" }));
      return;
    }

    const payload = JSON.parse(upstreamText) as { localId?: string; email?: string };
    const uid = String(payload.localId ?? "").trim();
    const resolvedEmail = normalizeEmail(String(payload.email ?? email));
    if (!uid || !resolvedEmail) {
      res.status(502).send(json({ error: "AUTH_PROVIDER_ERROR" }));
      return;
    }

    const sessionState = await syncUserSession(uid, resolvedEmail);
    const customToken = await getAuth().createCustomToken(uid, sessionState.claims);
    res.status(200).send(json({ customToken }));
    return;
  }

  if (path.endsWith("/auth/session/bootstrap")) {
    let decodedToken: Awaited<ReturnType<typeof verifyUser>>;
    try {
      decodedToken = await verifyUser(req.headers.authorization);
    } catch {
      res.status(401).send(json({ error: "UNAUTHORIZED" }));
      return;
    }

    const sessionState = await syncUserSession(decodedToken.uid, String(decodedToken.email ?? ""));
    res.status(200).send(
      json({
        role: sessionState.role,
        adminScope: sessionState.adminScope,
        adminRoster: sessionState.role === "admin" ? sessionState.adminRoster : [],
        superAdminRoster: sessionState.role === "admin" ? sessionState.superAdminRoster : [],
        tokenRefreshRequired: sessionState.claimsUpdated,
      })
    );
    return;
  }

  if (path.endsWith("/device/measurement")) {
    const deviceApiKey = extractDeviceApiKey(req);
    if (!hasValidDeviceApiKey(deviceApiKey)) {
      res.status(401).send(json({ error: "UNAUTHORIZED_DEVICE" }));
      return;
    }

    if (
      touchRateLimit(
        deviceMeasurementRateLimits,
        `${getClientAddress(req)}:device-measurement`,
        MAX_DEVICE_MEASUREMENT_REQUESTS_PER_WINDOW
      )
    ) {
      res.status(429).send(json({ error: "RATE_LIMITED" }));
      return;
    }

    const payload = sanitizeDeviceMeasurementPayload(req.body);
    if (!payload) {
      res.status(400).send(json({ error: "INVALID_MEASUREMENT_PAYLOAD" }));
      return;
    }

    const db = getFirestore();
    const historySnapshot = await db.collection("healthData").where("ownerUid", "==", payload.ownerUid).limit(24).get();
    const latestExisting = historySnapshot.docs
      .map((doc) => {
        const raw = doc.data() as {
          timestamp?: { toMillis?: () => number; toDate?: () => Date } | null;
          steps?: number;
          calories?: number;
          sleep?: number;
          heartRate?: number;
          bloodPressure?: string;
          meals?: string;
        };
        const millis = raw.timestamp?.toMillis?.() ?? raw.timestamp?.toDate?.()?.getTime?.() ?? 0;
        return { raw, millis };
      })
      .sort((a, b) => b.millis - a.millis)[0]?.raw;

    await db.collection("deviceMeasurements").add({
      ownerUid: payload.ownerUid,
      ownerEmail: payload.ownerEmail,
      heightCm: payload.heightCm,
      weightKg: payload.weightKg,
      measuredAt: new Date(payload.measuredAtMs),
      measuredAtMs: payload.measuredAtMs,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
      source: "raspi_measurement_device",
      createdAt: new Date(),
    });

    await db.collection("healthData").add({
      timestamp: new Date(payload.measuredAtMs),
      steps: Number(latestExisting?.steps ?? 0),
      height: payload.heightCm,
      weight: payload.weightKg,
      calories: Number(latestExisting?.calories ?? 0),
      sleep: Number(latestExisting?.sleep ?? 0),
      heartRate: Number(latestExisting?.heartRate ?? 0),
      bloodPressure: String(latestExisting?.bloodPressure ?? "0/0"),
      meals: String(latestExisting?.meals ?? "-"),
      source: "raspi_measurement",
      ownerEmail: payload.ownerEmail,
      ownerUid: payload.ownerUid,
      deviceId: payload.deviceId,
      sessionId: payload.sessionId,
    });

    res.status(200).send(
      json({
        ok: true,
        ownerUid: payload.ownerUid,
        ownerEmail: payload.ownerEmail,
        measuredAtMs: payload.measuredAtMs,
      })
    );
    return;
  }

  if (!proxyEnabled()) {
    res.status(503).send(json({ error: "AI_PROXY_DISABLED" }));
    return;
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    res.status(500).send(json({ error: "MISSING_SERVER_OPENAI_KEY" }));
    return;
  }

  let decodedToken: Awaited<ReturnType<typeof verifyUser>>;
  try {
    decodedToken = await verifyUser(req.headers.authorization);
  } catch {
    res.status(401).send(json({ error: "UNAUTHORIZED" }));
    return;
  }

  if (path.endsWith("/openai/responses")) {
    if (touchRateLimit(responseRateLimits, `${decodedToken.uid}:responses`, MAX_RESPONSE_REQUESTS_PER_WINDOW)) {
      res.status(429).send(json({ error: "RATE_LIMITED" }));
      return;
    }

    const payload = sanitizeResponsesPayload(req.body, req.rawBody);
    if (!payload) {
      res.status(400).send(json({ error: "INVALID_REQUEST_PAYLOAD" }));
      return;
    }

    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: json(payload),
    });
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    const text = await upstream.text();
    res.status(upstream.status).send(text);
    return;
  }

  if (path.endsWith("/openai/transcriptions")) {
    if (touchRateLimit(transcriptionRateLimits, `${decodedToken.uid}:transcriptions`, MAX_TRANSCRIPTION_REQUESTS_PER_WINDOW)) {
      res.status(429).send(json({ error: "RATE_LIMITED" }));
      return;
    }

    const validation = sanitizeTranscriptionRequest(req.headers["content-type"], req.rawBody);
    if (!validation.ok) {
      res.status(400).send(json({ error: validation.error }));
      return;
    }

    const upstream = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": validation.contentType,
      },
      body: new Uint8Array(req.rawBody),
    });
    const contentType = upstream.headers.get("content-type");
    if (contentType) {
      res.setHeader("Content-Type", contentType);
    }
    const text = await upstream.text();
    res.status(upstream.status).send(text);
    return;
  }

  res.status(404).send(json({ error: "NOT_FOUND" }));
});
