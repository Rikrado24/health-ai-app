/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_VISION_MODEL?: string;
  readonly VITE_OPENAI_VISION_FALLBACK_MODELS?: string;
  readonly VITE_OPENAI_STT_MODEL?: string;
  readonly VITE_OPENAI_ENABLE_WEB_SEARCH?: string;
  readonly VITE_AI_PROXY_BASE_URL?: string;
  readonly VITE_ENABLE_AI_PROXY?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_FIREBASE_DATABASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
