export const HEALTH_LOGO = "/logo-final.jpg";

const localOpenAiKey = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim() ?? "";
const localDirectAiEnabled =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
  localOpenAiKey.startsWith("sk-");

export const IS_AI_PROXY_ENABLED =
  (import.meta.env.VITE_ENABLE_AI_PROXY as string | undefined)?.trim().toLowerCase() === "true" ||
  localDirectAiEnabled;

export const API_BASE_URL = (
  import.meta.env.VITE_AI_PROXY_BASE_URL as string | undefined
)?.trim() || "/api";

export const AUTH_RESOLVE_URL = `${API_BASE_URL.replace(/\/$/, "")}/auth/resolve-login`;

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

export const USER_THEME_SPRITE_URL = "/theme-doctor-grid.png";

export const USER_THEME_TILE_OPTIONS = [
  { id: 1, label: "Panel 1", backgroundPosition: "0% 0%" },
  { id: 2, label: "Panel 2", backgroundPosition: "33.333% 0%" },
  { id: 3, label: "Panel 3", backgroundPosition: "66.666% 0%" },
  { id: 4, label: "Panel 4", backgroundPosition: "100% 0%" },
  { id: 5, label: "Panel 5", backgroundPosition: "0% 50%" },
  { id: 6, label: "Panel 6", backgroundPosition: "33.333% 50%" },
  { id: 7, label: "Panel 7", backgroundPosition: "66.666% 50%" },
  { id: 8, label: "Panel 8", backgroundPosition: "100% 50%" },
  { id: 9, label: "Panel 9", backgroundPosition: "0% 100%" },
  { id: 10, label: "Panel 10", backgroundPosition: "33.333% 100%" },
] as const;

export const DEFAULT_ACCENT_COLOR = "#2563eb";

export const DEFAULT_ADMIN_EDUCATION_ENTRIES = [
  {
    id: "edu-nutrisi",
    title: "Porsi Isi Piringku Harian",
    category: "nutrisi" as const,
    summary:
      "Panduan komposisi karbo, protein, sayur, buah, dan air putih untuk dewasa aktif.",
    status: "published" as const,
    updatedAt: Date.now(),
  },
  {
    id: "edu-aktivitas",
    title: "Aktivitas Fisik 30 Menit",
    category: "aktivitas" as const,
    summary:
      "Rangkaian aktivitas ringan-menengah agar target 8.000 langkah lebih mudah tercapai.",
    status: "published" as const,
    updatedAt: Date.now(),
  },
  {
    id: "edu-tidur",
    title: "Rutinitas Tidur 7-9 Jam",
    category: "tidur" as const,
    summary:
      "Checklist kebiasaan malam untuk kualitas tidur dan pemulihan tubuh yang konsisten.",
    status: "draft" as const,
    updatedAt: Date.now(),
  },
];

export const ADMIN_SETTINGS_SECTIONS = [
  "general",
  "access",
  "notifications",
  "risk",
  "data",
  "integrations",
  "compliance",
  "ux",
  "audit",
] as const;

export const THEME_COLORS = {
  admin: "#0f172a",
  darkText: "#e2e8f0",
  lightText: "#1e293b",
} as const;

export const DEFAULT_USER_PREFERENCES = {
  themeMode: "light" as const,
  accentColor: DEFAULT_ACCENT_COLOR,
  userThemeSourceMode: "doctor_tiles" as const,
  userThemeTileId: 1,
  reminderEnabled: false,
  reminderTime: "20:00",
  reminderMessage: "Waktunya input data kesehatan harian kamu.",
  reminderSoundEnabled: true,
  warningNotificationEnabled: true,
  sleepScheduleEnabled: true,
  sleepStartTime: "22:00",
  wakeTime: "06:00",
  maxAwakeHours: 16,
  sleepAutoSyncEnabled: true,
  adminDashboardDensity: "cozy" as const,
  userProfileVisibility: "private" as const,
  userShareAnonymizedInsights: true,
  userWeeklyDigestEnabled: true,
} as const;

export const DEFAULT_ADMIN_SETTINGS = {
  timezone: "Asia/Jakarta",
  locale: "id-ID",
  maintenanceMode: false,
  operationalStart: "08:00",
  operationalEnd: "20:00",
  sessionTimeoutMin: 45,
  require2FA: false,
  allowNewDevice: true,
  quietHourStart: "22:00",
  quietHourEnd: "06:00",
  escalationHours: 24,
  riskSleepMin: 7,
  riskSleepMax: 9,
  riskStepsMin: 8000,
  riskHeartRateMin: 60,
  riskHeartRateMax: 100,
  riskSystolicMax: 120,
  dataRetentionDays: 365,
  autoAnonymizeDays: 730,
  allowCsvExport: true,
  backupSchedule: "weekly" as const,
  aiProxyEnabled: true,
  webhookEnabled: false,
  webhookUrl: "",
  retryPolicy: 3,
  requireReasonSensitive: true,
  defaultLanding: "Dashboard Ringkas",
} as const;
