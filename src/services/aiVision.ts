import type { HealthData } from "../pages/Dashboard";
import { auth } from "./firebase";

type VisionResult = {
  suggestion: string;
};

type LiveConversationInput = {
  photoDataUrl?: string;
  userMessage: string;
  latest?: HealthData;
};

type LiveConversationResult = {
  replyText: string;
};

type VisionContentItem = { type: string; text?: string; image_url?: string };
type VisionMessage = { role: "system" | "developer" | "user"; content: VisionContentItem[] };
type ResponsesApiPayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

const API_BASE_URL = (import.meta.env.VITE_AI_PROXY_BASE_URL as string | undefined)?.trim() || "/api";
const RESPONSES_URL = `${API_BASE_URL.replace(/\/$/, "")}/openai/responses`;
const STT_URL = `${API_BASE_URL.replace(/\/$/, "")}/openai/transcriptions`;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_VISION_MODEL = "gpt-4.1-mini";
const MODEL_NOT_ALLOWED_HINTS = ["MODEL_NOT_ALLOWED", "model_not_allowed", "INVALID_REQUEST_PAYLOAD"];

const parseBooleanEnv = (value: string | undefined, fallback = false) => {
  if (typeof value !== "string") return fallback;
  return value.trim().toLowerCase() === "true";
};

const splitCsv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const isLikelyPlaceholder = (value: string) => /your_|placeholder|example/i.test(value);

const ENABLE_WEB_SEARCH = parseBooleanEnv(import.meta.env.VITE_OPENAI_ENABLE_WEB_SEARCH as string | undefined, true);
const ENABLE_AI_PROXY = parseBooleanEnv(import.meta.env.VITE_ENABLE_AI_PROXY as string | undefined, true);
const VISION_MODEL = (import.meta.env.VITE_OPENAI_VISION_MODEL as string | undefined)?.trim() || DEFAULT_VISION_MODEL;
const VISION_MODEL_FALLBACKS = splitCsv(import.meta.env.VITE_OPENAI_VISION_FALLBACK_MODELS as string | undefined);
const DIRECT_OPENAI_KEY = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim() ?? "";

const getVisionModelCandidates = () => {
  const candidates = [VISION_MODEL, ...VISION_MODEL_FALLBACKS, DEFAULT_VISION_MODEL];
  return Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean)));
};

const isLocalhost = () => {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
};

const canUseDirectOpenAI = () => {
  if (!isLocalhost()) return false;
  if (!DIRECT_OPENAI_KEY || isLikelyPlaceholder(DIRECT_OPENAI_KEY)) return false;
  return DIRECT_OPENAI_KEY.startsWith("sk-");
};

const canFallbackToDirect = (error: Error) =>
  error.message === "AI_PROXY_DISABLED" ||
  error.message.includes("VISION_API_ERROR: 404") ||
  error.message.includes("VISION_API_ERROR: 500") ||
  error.message.includes("Failed to fetch");

function buildHealthContext(latest?: HealthData) {
  if (!latest) {
    return "Data kesehatan terbaru belum tersedia.";
  }

  const safeHeightCm = Number(latest.height ?? 0);
  const safeWeightKg = Number(latest.weight ?? 0);
  const safeSleepHours = Number(latest.sleep ?? 0);
  const safeHeartRate = Number(latest.heartRate ?? 0);
  const safeSteps = Number(latest.steps ?? 0);
  const safeCalories = Number(latest.calories ?? 0);
  const bmi = safeHeightCm > 0 ? safeWeightKg / Math.pow(safeHeightCm / 100, 2) : 0;
  const sleepStatus = safeSleepHours >= 7 && safeSleepHours <= 9 ? "baik" : "perlu perbaikan";
  const stepsStatus = safeSteps >= 8000 ? "baik" : "perlu ditingkatkan";
  const heartStatus = safeHeartRate >= 60 && safeHeartRate <= 100 ? "baik" : "perlu dipantau";

  return `Data kesehatan terbaru user:
- Langkah: ${safeSteps} (${stepsStatus})
- Tinggi: ${safeHeightCm} cm
- Berat: ${safeWeightKg} kg
- IMT: ${bmi > 0 ? bmi.toFixed(1) : "tidak tersedia"}
- Kalori: ${safeCalories} kcal
- Tidur: ${safeSleepHours} jam (${sleepStatus})
- Detak jantung: ${safeHeartRate} bpm (${heartStatus})
- Tensi: ${latest.bloodPressure}
- Makanan: ${latest.meals}`;
}

function parseOutputText(payload: ResponsesApiPayload) {
  return (
    payload.output_text?.trim() ||
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .filter((contentItem) => contentItem.type === "output_text" && contentItem.text)
      .map((contentItem) => contentItem.text?.trim())
      .join("\n")
      .trim() ||
    ""
  );
}

const getAuthHeader = async () => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("AUTH_REQUIRED");
  }
  const token = await user.getIdToken();
  return `Bearer ${token}`;
};

const parseApiErrorCode = (text: string) => {
  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error?.trim() || "";
  } catch {
    return "";
  }
};

const buildApiError = (response: Response, errorText: string, fallbackPrefix: string) => {
  const apiCode = parseApiErrorCode(errorText);
  if (response.status === 401) return new Error("UNAUTHORIZED");
  if (response.status === 429) return new Error("RATE_LIMITED");
  return new Error(`${fallbackPrefix}: ${response.status} ${apiCode || errorText}`);
};

async function callVisionModelThroughProxy(
  messages: VisionMessage[],
  options?: { allowWebSearch?: boolean; temperature?: number; maxOutputTokens?: number }
) {
  if (!ENABLE_AI_PROXY) {
    throw new Error("AI_PROXY_DISABLED");
  }

  const authHeader = await getAuthHeader();
  const modelCandidates = getVisionModelCandidates();
  let lastError: Error | null = null;

  for (const model of modelCandidates) {
    const requestBody: {
      model: string;
      input: VisionMessage[];
      max_output_tokens: number;
      temperature: number;
      tools?: Array<{ type: string }>;
    } = {
      model,
      input: messages,
      max_output_tokens: options?.maxOutputTokens ?? 260,
      temperature: options?.temperature ?? 0.35,
    };

    if (options?.allowWebSearch && ENABLE_WEB_SEARCH) {
      requestBody.tools = [{ type: "web_search_preview" }];
    }

    const response = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      return (await response.json()) as ResponsesApiPayload;
    }

    const errorText = await response.text();
    const errorCode = parseApiErrorCode(errorText);

    if (requestBody.tools && response.status === 400) {
      const retryWithoutTools = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          ...requestBody,
          tools: undefined,
        }),
      });

      if (retryWithoutTools.ok) {
        return (await retryWithoutTools.json()) as ResponsesApiPayload;
      }

      const retryErrorText = await retryWithoutTools.text();
      const retryErrorCode = parseApiErrorCode(retryErrorText);
      lastError = buildApiError(retryWithoutTools, retryErrorText, "VISION_API_ERROR");
      if (retryWithoutTools.status === 400 && MODEL_NOT_ALLOWED_HINTS.includes(retryErrorCode)) {
        continue;
      }
      throw lastError;
    }

    lastError = buildApiError(response, errorText, "VISION_API_ERROR");
    if (response.status === 400 && MODEL_NOT_ALLOWED_HINTS.includes(errorCode)) {
      continue;
    }
    throw lastError;
  }

  if (lastError) throw lastError;
  throw new Error("VISION_API_ERROR: no-model-available");
}

async function callVisionModelDirect(
  messages: VisionMessage[],
  options?: { allowWebSearch?: boolean; temperature?: number; maxOutputTokens?: number }
) {
  if (!canUseDirectOpenAI()) {
    throw new Error("DIRECT_OPENAI_UNAVAILABLE");
  }

  const modelCandidates = getVisionModelCandidates();
  let lastError: Error | null = null;

  for (const model of modelCandidates) {
    const requestBody: {
      model: string;
      input: VisionMessage[];
      max_output_tokens: number;
      temperature: number;
      tools?: Array<{ type: string }>;
    } = {
      model,
      input: messages,
      max_output_tokens: options?.maxOutputTokens ?? 260,
      temperature: options?.temperature ?? 0.35,
    };

    if (options?.allowWebSearch && ENABLE_WEB_SEARCH) {
      requestBody.tools = [{ type: "web_search_preview" }];
    }

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DIRECT_OPENAI_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.ok) {
      return (await response.json()) as ResponsesApiPayload;
    }

    const errorText = await response.text();
    const errorCode = parseApiErrorCode(errorText);
    lastError = buildApiError(response, errorText, "VISION_DIRECT_ERROR");
    if (response.status === 400 && MODEL_NOT_ALLOWED_HINTS.includes(errorCode)) {
      continue;
    }
    throw lastError;
  }

  if (lastError) throw lastError;
  throw new Error("VISION_DIRECT_ERROR: no-model-available");
}

async function callVisionModel(
  messages: VisionMessage[],
  options?: { allowWebSearch?: boolean; temperature?: number; maxOutputTokens?: number }
) {
  try {
    return await callVisionModelThroughProxy(messages, options);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (!canFallbackToDirect(error)) {
      throw error;
    }
    if (!canUseDirectOpenAI()) {
      throw new Error("AI_BACKEND_UNAVAILABLE");
    }
    return callVisionModelDirect(messages, options);
  }
}

export async function analyzePhotoWithAI(photoDataUrl: string, latest?: HealthData): Promise<VisionResult> {
  const context = buildHealthContext(latest);
  const payload = await callVisionModel(
    [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "Kamu adalah edukator kesehatan umum berbahasa Indonesia. Tujuanmu memberi edukasi praktis, bukan diagnosis pasti.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${context}

Analisis foto ini untuk edukasi kesehatan dan jawab dalam 4 bagian singkat:
1) Observasi utama dari foto
2) Risiko yang mungkin perlu diperhatikan
3) Langkah aman 24 jam ke depan (maks 3 poin)
4) Kapan perlu periksa tenaga medis

Gaya jawaban: jelas, empatik, praktis, tanpa menghakimi, maks 150 kata.`,
          },
          { type: "input_image", image_url: photoDataUrl },
        ],
      },
    ],
    {
      allowWebSearch: false,
      temperature: 0.3,
      maxOutputTokens: 320,
    }
  );

  const outputText = parseOutputText(payload);
  if (!outputText) {
    throw new Error("EMPTY_AI_RESPONSE");
  }

  return { suggestion: outputText };
}

export async function communicateWithVisionAI({
  photoDataUrl,
  userMessage,
  latest,
}: LiveConversationInput): Promise<LiveConversationResult> {
  const context = buildHealthContext(latest);
  const userContent: VisionContentItem[] = [
    {
      type: "input_text",
      text: `${context}

Pertanyaan user:
"${userMessage}"

Tugas:
- Berikan jawaban edukasi kesehatan yang presisi dan mudah dipraktikkan.
- Jika data user terlihat baik, tetap beri penguatan kebiasaan sehat + 1 optimasi kecil.
- Jika ada nilai yang belum ideal, prioritaskan tindakan kecil paling berdampak dulu.
- Hindari diagnosis pasti, tidak boleh menulis resep dosis obat spesifik.
- Jika pertanyaan di luar edukasi kesehatan, tolak sopan lalu arahkan kembali.

Format WAJIB 5 bagian:
1) Ringkasan kondisi saat ini (berdasarkan data user + pertanyaan)
2) Edukasi singkat (kenapa ini penting)
3) Rencana aksi 24 jam (maks 3 poin, spesifik dan realistis)
4) Tanda bahaya (kapan ke fasilitas kesehatan)
5) Sumber (maks 2, hanya bila kamu benar-benar memakai web search)

Gunakan bahasa Indonesia yang natural, singkat, dan empatik.`,
    },
  ];

  if (photoDataUrl) {
    userContent.push({ type: "input_image", image_url: photoDataUrl });
  }

  const payload = await callVisionModel(
    [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "Kamu asisten edukasi kesehatan preventif untuk masyarakat Indonesia. Prioritaskan keselamatan, kejelasan, dan tindakan praktis.",
          },
        ],
      },
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "Jangan halusinasi data medis. Kalau informasi tidak cukup, jelaskan keterbatasannya dan beri saran aman.",
          },
        ],
      },
      {
        role: "user",
        content: userContent,
      },
    ],
    {
      allowWebSearch: true,
      temperature: 0.35,
      maxOutputTokens: 520,
    }
  );

  const outputText = parseOutputText(payload);
  if (!outputText) {
    throw new Error("EMPTY_AI_RESPONSE");
  }

  return { replyText: outputText };
}

export async function transcribeAudioWithAI(audioBlob: Blob): Promise<{ text: string }> {
  const model = import.meta.env.VITE_OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";
  const formData = new FormData();
  const file = new File([audioBlob], "voice-note.webm", {
    type: audioBlob.type || "audio/webm",
  });
  formData.append("file", file);
  formData.append("model", model);
  formData.append("language", "id");

  if (ENABLE_AI_PROXY) {
    try {
      const authHeader = await getAuthHeader();
      const response = await fetch(STT_URL, {
        method: "POST",
        headers: {
          Authorization: authHeader,
        },
        body: formData,
      });

      if (response.ok) {
        const payload = (await response.json()) as { text?: string };
        const text = payload.text?.trim() || "";
        if (!text) {
          throw new Error("EMPTY_STT_RESPONSE");
        }
        return { text };
      }

      const errorText = await response.text();
      const proxyError = buildApiError(response, errorText, "STT_API_ERROR");
      if (!canUseDirectOpenAI() || !canFallbackToDirect(proxyError)) {
        throw proxyError;
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (!canUseDirectOpenAI() || !canFallbackToDirect(error)) {
        throw error;
      }
    }
  }

  if (!canUseDirectOpenAI()) {
    throw new Error("AI_PROXY_DISABLED");
  }

  const directResponse = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DIRECT_OPENAI_KEY}`,
    },
    body: formData,
  });

  if (!directResponse.ok) {
    const errorText = await directResponse.text();
    throw buildApiError(directResponse, errorText, "STT_DIRECT_ERROR");
  }

  const directPayload = (await directResponse.json()) as { text?: string };
  const directText = directPayload.text?.trim() || "";
  if (!directText) {
    throw new Error("EMPTY_STT_RESPONSE");
  }

  return { text: directText };
}
