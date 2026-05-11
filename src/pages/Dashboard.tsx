import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { communicateWithVisionAI, transcribeAudioWithAI } from "../services/aiVision";
import useLocalStorage from "../hooks/useLocalStorage";
import { assessKemenkesMetrics } from "../services/kemenkesStandards";
import { playDeviceAlarmTone, stopDeviceAlarmTone } from "../services/deviceAlarm";
import { RingStatCard } from "../components/dashboard/RingStatCard";
import {
  normalizeHex,
  formatMealsDisplay,
  parseStructuredMeals,
  evaluateNutritionPortion,
  clampPercent,
  parseTimeToMinutes,
  getSleepDurationFromSchedule,
  isInSleepWindow,
  getLastWakeDateTime,
  formatDayDateTime,
  calculateBmi,
  scoreBmiIdeal,
  scoreSleepDuration,
  scoreHeartRate,
  scoreBloodPressure,
  downloadExcelCsv,
} from "../utils/dashboardUtils";
import {
  HEALTH_LOGO,
  IS_AI_PROXY_ENABLED,
  USER_THEME_SPRITE_URL,
  USER_THEME_TILE_OPTIONS,
} from "../utils/dashboardConstants";
import type {
  HealthData,
  DashboardProps,
  PersonalPeriodPoint,
  PersonalPeriodRecord,
  SleepAutoSyncQueueItem,
  AdminEducationEntry,
  AdminBroadcastLog,
  AdminTimelineEntry,
  AdminSettingsChangeLog,
  SpeechRecognitionEventLike,
  SpeechRecognitionLike,
  SpeechWindow,
} from "../types/dashboard";

export type { HealthData } from "../types/dashboard";

const Dashboard = ({
  data,
  latest,
  userDirectory,
  userGender,
  userDisplayName,
  userEmail,
  role,
  adminScope,
  adminRoster: incomingAdminRoster,
  superAdminRoster: incomingSuperAdminRoster,
  gpsSyncStatus,
  gpsTrackingSchedule,
  isGpsTrackingActiveNow,
  onManualUserInput,
  onRequestGpsSyncNow,
  onClearGpsQueue,
  onGpsTrackingScheduleChange,
  activitySessionActive,
  activitySessionSummary,
  onStartActivitySession,
  onStopActivitySession,
  onSignOut,
}: DashboardProps) => {
  // Provide default values for optional props
  const safeUserDirectory = useMemo(() => userDirectory ?? [], [userDirectory]);
  const safeUserGender = userGender ?? "tidak_ditentukan";
  const safeUserDisplayName = userDisplayName ?? "Pengguna";
  const safeUserEmail = userEmail ?? "";
  const safeRole = role ?? "user";
  const safeAdminScope = adminScope ?? "none";
  const safeAdminRoster = useMemo(() => incomingAdminRoster ?? [], [incomingAdminRoster]);
  const safeSuperAdminRoster = useMemo(() => incomingSuperAdminRoster ?? [], [incomingSuperAdminRoster]);
  const safeGpsSyncStatus = useMemo(
    () =>
      gpsSyncStatus ?? {
        isOnline: navigator.onLine,
        pendingSyncCount: 0,
        lastSampleAtMs: null,
        isFlushing: false,
        lastFlushAtMs: null,
        lastFlushResult: "idle" as const,
        lastFlushError: null,
        lastFlushedCount: 0,
      },
    [gpsSyncStatus]
  );
  const safeOnManualUserInput = useCallback<NonNullable<DashboardProps["onManualUserInput"]>>(
    async (payload) => {
      if (onManualUserInput) {
        await onManualUserInput(payload);
      }
    },
    [onManualUserInput]
  );
  const safeOnRequestGpsSyncNow = useCallback<NonNullable<DashboardProps["onRequestGpsSyncNow"]>>(
    async () => {
      if (onRequestGpsSyncNow) {
        await onRequestGpsSyncNow();
      }
    },
    [onRequestGpsSyncNow]
  );
  const safeOnClearGpsQueue = useCallback<NonNullable<DashboardProps["onClearGpsQueue"]>>(() => {
    onClearGpsQueue?.();
  }, [onClearGpsQueue]);
  const safeGpsTrackingSchedule = useMemo(
    () =>
      gpsTrackingSchedule ?? {
        mode: "scheduled" as const,
        days: [0, 6],
        startTime: "05:30",
        endTime: "09:30",
      },
    [gpsTrackingSchedule]
  );
  const safeIsGpsTrackingActiveNow = isGpsTrackingActiveNow ?? false;
  const safeActivitySessionActive = activitySessionActive ?? false;
  const safeActivitySessionSummary = useMemo(
    () =>
      activitySessionSummary ?? {
        startedAtMs: null,
        updatedAtMs: null,
        steps: 0,
        distanceMeters: 0,
        calories: 0,
      },
    [activitySessionSummary]
  );
  const safeOnGpsTrackingScheduleChange = useCallback<
    NonNullable<DashboardProps["onGpsTrackingScheduleChange"]>
  >(
    (patch) => {
      onGpsTrackingScheduleChange?.(patch);
    },
    [onGpsTrackingScheduleChange]
  );
  const safeOnStartActivitySession = useCallback(() => {
    onStartActivitySession?.();
  }, [onStartActivitySession]);
  const safeOnStopActivitySession = useCallback(() => {
    onStopActivitySession?.();
  }, [onStopActivitySession]);

  type NavIconName = "home" | "data" | "education" | "alerts" | "settings" | "history" | "more";
  const trackingDayOptions = [
    { value: 1, label: "Sen" },
    { value: 2, label: "Sel" },
    { value: 3, label: "Rab" },
    { value: 4, label: "Kam" },
    { value: 5, label: "Jum" },
    { value: 6, label: "Sab" },
    { value: 0, label: "Min" },
  ] as const;
  const renderNavIcon = (icon: NavIconName) => {
    if (icon === "home") {
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
        </svg>
      );
    }
    if (icon === "data") {
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 5h16v14H4z" />
          <path d="M4 10h16" />
          <path d="M9 10v9" />
        </svg>
      );
    }
    if (icon === "education") {
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 8l9-4 9 4-9 4-9-4z" />
          <path d="M7 10v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4" />
        </svg>
      );
    }
    if (icon === "alerts") {
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3l9 16H3L12 3z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      );
    }
    if (icon === "settings") {
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 8a4 4 0 100 8 4 4 0 000-8z" />
          <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 01-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 01-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 012.8-2.8l.1.1a1.6 1.6 0 001.8.3h.1a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.2a1.6 1.6 0 001 1.5h.1a1.6 1.6 0 001.8-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8v.1a1.6 1.6 0 001.5 1H21a2 2 0 010 4h-.2a1.6 1.6 0 00-1.5 1z" />
        </svg>
      );
    }
    if (icon === "history") {
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 12a9 9 0 109-9 9.8 9.8 0 00-7 3" />
          <path d="M3 4v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="5" cy="12" r="1.2" />
        <circle cx="12" cy="12" r="1.2" />
        <circle cx="19" cy="12" r="1.2" />
      </svg>
    );
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 1023px)").matches;
  });
  const [commOpen, setCommOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [message, setMessage] = useState("");
  const [commReply, setCommReply] = useState("");
  const [commError, setCommError] = useState("");
  const [manualStatus, setManualStatus] = useState("");
  const [manualStatusTone, setManualStatusTone] = useState<"info" | "success" | "error">("info");
  const [manualHeartRateInput, setManualHeartRateInput] = useState(() =>
    latest?.heartRate && latest.heartRate > 0 ? String(latest.heartRate) : ""
  );
  const [manualBloodPressureInput, setManualBloodPressureInput] = useState(() => {
    const current = String(latest?.bloodPressure ?? "").trim();
    return current && current !== "0/0" ? current : "";
  });
  const [manualMealsInput, setManualMealsInput] = useState(() => {
    const current = String(latest?.meals ?? "").trim();
    return current && current !== "-" ? current : "";
  });
  const [toastState, setToastState] = useState<{ message: string; tone: "info" | "success" | "error" } | null>(null);
  const [userAge, setUserAge] = useLocalStorage<number>("user-age-years", 25);
  const [themeMode, setThemeMode] = useLocalStorage<"light" | "dark">("ui-theme-mode", "light");
  const [accentColor, setAccentColor] = useLocalStorage<string>("ui-accent-color", "#2563eb");
  const [userThemeSourceMode, setUserThemeSourceMode] = useLocalStorage<"gradient" | "doctor_tiles">(
    "user-theme-source-mode",
    "doctor_tiles"
  );
  const [userThemeTileId, setUserThemeTileId] = useLocalStorage<number>("user-theme-tile-id", 1);
  const [userThemeSpriteUrl] = useLocalStorage<string>("user-theme-sprite-url", USER_THEME_SPRITE_URL);
  const [userThemeImageReady, setUserThemeImageReady] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useLocalStorage<boolean>("daily-reminder-enabled", false);
  const [reminderTime, setReminderTime] = useLocalStorage<string>("daily-reminder-time", "20:00");
  const [reminderMessage, setReminderMessage] = useLocalStorage<string>(
    "daily-reminder-message",
    "Waktunya melakukan pemantauan kesehatan harian Anda."
  );
  const [reminderSoundEnabled, setReminderSoundEnabled] = useLocalStorage<boolean>(
    "daily-reminder-sound-enabled",
    true
  );
  const [warningNotificationEnabled, setWarningNotificationEnabled] = useLocalStorage<boolean>(
    "warning-notification-enabled",
    true
  );
  const [sleepScheduleEnabled, setSleepScheduleEnabled] = useLocalStorage<boolean>("sleep-schedule-enabled", true);
  const [sleepStartTime, setSleepStartTime] = useLocalStorage<string>("sleep-start-time", "22:00");
  const [wakeTime, setWakeTime] = useLocalStorage<string>("wake-time", "06:00");
  const [maxAwakeHours, setMaxAwakeHours] = useLocalStorage<number>("max-awake-hours", 16);
  const [lastReminderDate, setLastReminderDate] = useLocalStorage<string>("daily-reminder-last-date", "");
  const [lastWarningDate, setLastWarningDate] = useLocalStorage<string>("warning-last-date", "");
  const [lastRestReminderStamp, setLastRestReminderStamp] = useLocalStorage<string>("rest-reminder-stamp", "");
  const [onboardingSeen, setOnboardingSeen] = useLocalStorage<boolean>("mobile-onboarding-seen", false);
  const [userProfileVisibility, setUserProfileVisibility] = useLocalStorage<"private" | "tim_pendamping">(
    "user-profile-visibility",
    "private"
  );
  const [userShareAnonymizedInsights, setUserShareAnonymizedInsights] = useLocalStorage<boolean>(
    "user-share-anonymized-insights",
    true
  );
  const [userWeeklyDigestEnabled, setUserWeeklyDigestEnabled] = useLocalStorage<boolean>("user-weekly-digest-enabled", true);
  const [reminderStatus, setReminderStatus] = useState("");
  const [sleepScheduleStatus, setSleepScheduleStatus] = useState("");
  const [sleepAutoSyncEnabled, setSleepAutoSyncEnabled] = useLocalStorage<boolean>("sleep-auto-sync-enabled", true);
  const [lastSleepAutoSyncDate, setLastSleepAutoSyncDate] = useLocalStorage<string>("sleep-auto-sync-last-date", "");
  const [sleepAutoSyncQueue, setSleepAutoSyncQueue] = useLocalStorage<SleepAutoSyncQueueItem[]>(
    "sleep-auto-sync-queue",
    []
  );
  const [sleepAutoSyncStatus, setSleepAutoSyncStatus] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [fallbackRecording, setFallbackRecording] = useState(false);
  const [phoneNow, setPhoneNow] = useState(() => new Date());
  const [adminFollowUpMap, setAdminFollowUpMap] = useLocalStorage<Record<string, "baru" | "diproses" | "selesai">>(
    "admin-follow-up-map",
    {}
  );
  const [adminEducationLibrary, setAdminEducationLibrary] = useLocalStorage<AdminEducationEntry[]>(
    "admin-education-library",
    [
      {
        id: "edu-nutrisi",
        title: "Porsi Isi Piringku Harian",
        category: "nutrisi",
        summary: "Panduan komposisi karbo, protein, sayur, buah, dan air putih untuk dewasa aktif.",
        status: "published",
        updatedAt: Date.now(),
      },
      {
        id: "edu-aktivitas",
        title: "Aktivitas Fisik 30 Menit",
        category: "aktivitas",
        summary: "Rangkaian aktivitas ringan-menengah agar target 8.000 langkah lebih mudah tercapai.",
        status: "published",
        updatedAt: Date.now(),
      },
      {
        id: "edu-tidur",
        title: "Rutinitas Tidur 7-9 Jam",
        category: "tidur",
        summary: "Checklist kebiasaan malam untuk kualitas tidur dan pemulihan tubuh yang konsisten.",
        status: "draft",
        updatedAt: Date.now(),
      },
    ]
  );
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [adminRiskFilter, setAdminRiskFilter] = useState<"semua" | "tinggi" | "sedang" | "rendah">("semua");
  const [adminUserSort, setAdminUserSort] = useState<"risk" | "recent" | "records">("risk");
  const [adminAlertStatusFilter, setAdminAlertStatusFilter] = useState<"semua" | "baru" | "diproses" | "selesai">(
    "semua"
  );
  const [adminEducationFilter, setAdminEducationFilter] = useState<"semua" | AdminEducationEntry["category"]>("semua");
  const [adminBroadcastSegment, setAdminBroadcastSegment] = useState<
    "semua" | "risiko_tinggi" | "risiko_sedang" | "alert_terbuka"
  >("semua");
  const [adminBroadcastMessage, setAdminBroadcastMessage] = useState("");
  const [adminBroadcastLogs, setAdminBroadcastLogs] = useLocalStorage<AdminBroadcastLog[]>("admin-broadcast-logs", []);
  const [adminTimeline, setAdminTimeline] = useLocalStorage<AdminTimelineEntry[]>("admin-follow-up-timeline", []);
  const [adminSettingsSection, setAdminSettingsSection] = useState<
    "general" | "access" | "notifications" | "risk" | "data" | "integrations" | "compliance" | "ux" | "audit"
  >("access");
  const [adminChangeReason, setAdminChangeReason] = useState("");
  const [adminConfigLogs, setAdminConfigLogs] = useLocalStorage<AdminSettingsChangeLog[]>("admin-config-change-logs", []);
  const [adminTimezone, setAdminTimezone] = useLocalStorage<string>("admin-timezone", "Asia/Jakarta");
  const [adminLocale, setAdminLocale] = useLocalStorage<string>("admin-locale", "id-ID");
  const [adminMaintenanceMode, setAdminMaintenanceMode] = useLocalStorage<boolean>("admin-maintenance-mode", false);
  const [adminOperationalStart, setAdminOperationalStart] = useLocalStorage<string>("admin-operational-start", "08:00");
  const [adminOperationalEnd, setAdminOperationalEnd] = useLocalStorage<string>("admin-operational-end", "20:00");
  const [adminSessionTimeoutMin, setAdminSessionTimeoutMin] = useLocalStorage<number>("admin-session-timeout-min", 45);
  const [adminRequire2FA, setAdminRequire2FA] = useLocalStorage<boolean>("admin-require-2fa", false);
  const [adminAllowNewDevice, setAdminAllowNewDevice] = useLocalStorage<boolean>("admin-allow-new-device", true);
  const [adminQuietHourStart, setAdminQuietHourStart] = useLocalStorage<string>("admin-quiet-hour-start", "22:00");
  const [adminQuietHourEnd, setAdminQuietHourEnd] = useLocalStorage<string>("admin-quiet-hour-end", "06:00");
  const [adminEscalationHours, setAdminEscalationHours] = useLocalStorage<number>("admin-escalation-hours", 24);
  const [adminRiskSleepMin, setAdminRiskSleepMin] = useLocalStorage<number>("admin-risk-sleep-min", 7);
  const [adminRiskSleepMax, setAdminRiskSleepMax] = useLocalStorage<number>("admin-risk-sleep-max", 9);
  const [adminRiskStepsMin, setAdminRiskStepsMin] = useLocalStorage<number>("admin-risk-steps-min", 8000);
  const [adminRiskHeartRateMin, setAdminRiskHeartRateMin] = useLocalStorage<number>("admin-risk-hr-min", 60);
  const [adminRiskHeartRateMax, setAdminRiskHeartRateMax] = useLocalStorage<number>("admin-risk-hr-max", 100);
  const [adminRiskSystolicMax, setAdminRiskSystolicMax] = useLocalStorage<number>("admin-risk-systolic-max", 120);
  const [adminDataRetentionDays, setAdminDataRetentionDays] = useLocalStorage<number>("admin-data-retention-days", 365);
  const [adminAutoAnonymizeDays, setAdminAutoAnonymizeDays] = useLocalStorage<number>("admin-auto-anonymize-days", 730);
  const [adminAllowCsvExport, setAdminAllowCsvExport] = useLocalStorage<boolean>("admin-allow-csv-export", true);
  const [adminBackupSchedule, setAdminBackupSchedule] = useLocalStorage<"daily" | "weekly" | "monthly">(
    "admin-backup-schedule",
    "weekly"
  );
  const [adminAiProxyEnabled, setAdminAiProxyEnabled] = useLocalStorage<boolean>("admin-ai-proxy-enabled", true);
  const [adminWebhookEnabled, setAdminWebhookEnabled] = useLocalStorage<boolean>("admin-webhook-enabled", false);
  const [adminWebhookUrl, setAdminWebhookUrl] = useLocalStorage<string>("admin-webhook-url", "");
  const [adminRetryPolicy, setAdminRetryPolicy] = useLocalStorage<number>("admin-retry-policy", 3);
  const [adminRequireReasonSensitive, setAdminRequireReasonSensitive] = useLocalStorage<boolean>(
    "admin-require-reason-sensitive",
    true
  );
  const [adminDashboardDensity, setAdminDashboardDensity] = useLocalStorage<"compact" | "cozy">(
    "admin-dashboard-density",
    "cozy"
  );
  const [adminDefaultLanding, setAdminDefaultLanding] = useLocalStorage<string>("admin-default-landing", "Dashboard Ringkas");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const commSectionRef = useRef<HTMLElement | null>(null);
  const manualInputSectionRef = useRef<HTMLDivElement | null>(null);
  const manualHeartRateInputRef = useRef<HTMLInputElement | null>(null);
  const manualBloodPressureInputRef = useRef<HTMLInputElement | null>(null);
  const manualMealsInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fallbackRecorderRef = useRef<MediaRecorder | null>(null);
  const fallbackStreamRef = useRef<MediaStream | null>(null);
  const fallbackChunksRef = useRef<Blob[]>([]);
  const sleepAutoSyncPendingRef = useRef(false);
  const sleepQueueFlushPendingRef = useRef(false);

  const {
    weeklySteps,
    avgSleep,
    riskScore,
    riskLevel,
    riskColor,
    educationItems,
    activeAlerts,
    effectiveReminderMessage,
    warningBody,
    totalCaloriesWeek,
    avgHeartRateWeek,
    avgSleepWeek,
    maxStepsWeek,
    minStepsWeek,
  } = useMemo(() => {
    const weeklyStepsValue = data.slice(-7).reduce((sum, item) => sum + item.steps, 0);
    const avgSleepValue =
      data.length > 0
        ? (data.reduce((sum, item) => sum + item.sleep, 0) / data.length).toFixed(1)
        : "0.0";

    const kemenkes = assessKemenkesMetrics(latest, { gender: safeUserGender, age: userAge });
    const riskScoreValue = kemenkes.riskScore;
    const riskLevelValue = kemenkes.riskLevel;
    const riskColorValue =
      riskLevelValue === "Tinggi"
        ? "text-rose-600"
        : riskLevelValue === "Sedang"
        ? "text-amber-600"
        : "text-emerald-600";
    const riskNotesValue = kemenkes.riskNotes;
    const educationItemsValue = kemenkes.educationItems;
    const alerts = [
      {
        id: "bp",
        title: "Tekanan darah perlu dipantau",
        detail: `Terbaca ${latest?.bloodPressure ?? "0/0"} (standar Kemenkes: normal < 120/80).`,
        active: kemenkes.bloodPressureStatus !== "baik",
        level: kemenkes.bloodPressureStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
      {
        id: "sleep",
        title: "Durasi tidur belum ideal",
        detail: `Durasi tidur ${latest?.sleep ?? 0} jam (anjuran dewasa 7-9 jam).`,
        active: kemenkes.sleepStatus !== "baik",
        level: kemenkes.sleepStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
      {
        id: "steps",
        title: "Aktivitas fisik rendah",
        detail: `Langkah ${(latest?.steps ?? 0).toLocaleString("id-ID")} (~${kemenkes.activityMinutes} menit, target >= 30 menit/hari).`,
        active: kemenkes.stepsStatus !== "baik",
        level: kemenkes.stepsStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
      {
        id: "hr",
        title: "Detak jantung perlu evaluasi",
        detail: `Detak ${latest?.heartRate ?? 0} bpm (normal dewasa 60-100 bpm).`,
        active: kemenkes.heartRateStatus !== "baik",
        level: kemenkes.heartRateStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
      {
        id: "bmi",
        title: "Indeks massa tubuh perlu koreksi",
        detail: `IMT ${kemenkes.bmi > 0 ? kemenkes.bmi.toFixed(1) : "0.0"} (target 18,5-25).`,
        active: kemenkes.bmiStatus !== "baik",
        level: kemenkes.bmiStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
      {
        id: "calories",
        title: "Asupan kalori belum seimbang",
        detail: `Kalori ${latest?.calories ?? 0} kkal (estimasi kebutuhan ${kemenkes.energyNeedKcal} kkal/hari).`,
        active: kemenkes.caloriesStatus !== "baik",
        level: kemenkes.caloriesStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
      {
        id: "meals",
        title: "Pola makan perlu dilengkapi",
        detail: `Menu terakhir: ${formatMealsDisplay(latest?.meals ?? "-")}. Cek komposisi karbo, protein, sayur, buah.`,
        active: kemenkes.mealStatus !== "baik",
        level: kemenkes.mealStatus === "tinggi" ? "Tinggi" : "Sedang",
      },
    ];
    const activeAlertsValue = alerts.filter((item) => item.active);
    const personalizedReminderMessage = latest
      ? `Ringkasan hari ini: langkah ${(latest.steps ?? 0).toLocaleString("id-ID")}, tidur ${latest.sleep ?? 0} jam, detak ${latest.heartRate ?? 0} bpm, tekanan ${latest.bloodPressure ?? "0/0"}. Kategori risiko ${riskLevelValue}.`
      : "Belum ada data kesehatan. Silakan lakukan pengukuran terlebih dahulu.";
    const effectiveReminderMessageValue =
      reminderMessage.trim().length > 0
        ? `${reminderMessage.trim()} ${personalizedReminderMessage}`
        : personalizedReminderMessage;
    const warningBodyValue =
      activeAlertsValue.length > 0
        ? `${activeAlertsValue
            .slice(0, 2)
            .map((item) => item.title)
            .join(", ")}. ${personalizedReminderMessage}`
        : personalizedReminderMessage;

    const recentForReport = data.slice(-7);
    const totalCaloriesWeekValue = recentForReport.reduce((sum, item) => sum + item.calories, 0);
    const avgHeartRateWeekValue =
      recentForReport.length > 0
        ? Math.round(recentForReport.reduce((sum, item) => sum + item.heartRate, 0) / recentForReport.length)
        : 0;
    const avgSleepWeekValue =
      recentForReport.length > 0
        ? (recentForReport.reduce((sum, item) => sum + item.sleep, 0) / recentForReport.length).toFixed(1)
        : "0.0";
    const maxStepsWeekValue = recentForReport.length > 0 ? Math.max(...recentForReport.map((item) => item.steps)) : 0;
    const minStepsWeekValue = recentForReport.length > 0 ? Math.min(...recentForReport.map((item) => item.steps)) : 0;

    return {
      weeklySteps: weeklyStepsValue,
      avgSleep: avgSleepValue,
      riskScore: riskScoreValue,
      riskLevel: riskLevelValue,
      riskColor: riskColorValue,
      riskNotes: riskNotesValue,
      educationItems: educationItemsValue,
      activeAlerts: activeAlertsValue,
      effectiveReminderMessage: effectiveReminderMessageValue,
      warningBody: warningBodyValue,
      totalCaloriesWeek: totalCaloriesWeekValue,
      avgHeartRateWeek: avgHeartRateWeekValue,
      avgSleepWeek: avgSleepWeekValue,
      maxStepsWeek: maxStepsWeekValue,
      minStepsWeek: minStepsWeekValue,
    };
  }, [data, latest, reminderMessage, userAge, safeUserGender]);
  const currentAdminRole = useMemo<"super_admin" | "operator">(() => {
    return safeAdminScope === "super_admin" ? "super_admin" : "operator";
  }, [safeAdminScope]);
  const sidebarMenu = useMemo(
    () =>
      safeRole === "admin"
        ? [
            "Dashboard Ringkas",
            "Manajemen Pengguna",
            "Monitoring Risiko",
            "Alert & Tindak Lanjut",
            "Konten Edukasi",
            "Broadcast Notifikasi",
            "Timeline Tindak Lanjut",
            "Riwayat & Audit Log",
            "Laporan & Ekspor",
            ...(currentAdminRole === "super_admin" ? ["Manajemen Role"] : []),
            "Pengaturan Sistem",
          ]
        : ["Beranda", "Hasil Edukasi", "Peringatan Saya", "Riwayat", "Pengaturan"],
    [currentAdminRole, safeRole]
  );
  const adminMenuGroups = useMemo(
    () =>
      safeRole === "admin"
        ? [
            {
              title: "Monitoring",
              items: ["Dashboard Ringkas", "Monitoring Risiko", "Alert & Tindak Lanjut"],
            },
            {
              title: "Operasional",
              items: ["Manajemen Pengguna", "Broadcast Notifikasi", "Konten Edukasi", "Timeline Tindak Lanjut"],
            },
            {
              title: "Tata Kelola",
              items: [
                "Riwayat & Audit Log",
                "Laporan & Ekspor",
                ...(currentAdminRole === "super_admin" ? ["Manajemen Role"] : []),
                "Pengaturan Sistem",
              ],
            },
          ]
        : [],
    [currentAdminRole, safeRole]
  );
  const interfaceMode = useMemo<"admin_web" | "admin_mobile" | "user_web" | "user_mobile">(() => {
    if (safeRole === "admin") return isMobileViewport ? "admin_mobile" : "admin_web";
    return isMobileViewport ? "user_mobile" : "user_web";
  }, [isMobileViewport, safeRole]);
  const interfaceProfile = useMemo(
    () =>
      ({
        admin_web: {
          label: "Admin Web",
          summary:
            "Dasbor web admin menampilkan ringkasan data pasien dan analitik kesehatan untuk pemantauan operasional yang efisien.",
        },
        admin_mobile: {
          label: "Admin Mobile",
          summary:
            "Aplikasi seluler admin berfokus pada ringkasan pasien, indikator perhatian, dan input cepat untuk tindak lanjut.",
        },
        user_web: {
          label: "Pengguna Web",
          summary:
            "Dasbor web pengguna menampilkan metrik kesehatan pribadi secara komprehensif agar progres kesehatan mudah dipantau.",
        },
        user_mobile: {
          label: "Pengguna Seluler",
          summary:
            "Aplikasi seluler pengguna dirancang untuk pemantauan kesehatan harian yang cepat, jelas, dan mudah digunakan.",
        },
      })[interfaceMode],
    [interfaceMode]
  );
  const modeClass = `mode-${interfaceMode.replace("_", "-")}`;
  const defaultMenu = safeRole === "admin" ? "Dashboard Ringkas" : "Beranda";
  const [activeMenu, setActiveMenu] = useState(defaultMenu);
  const menuHistoryRef = useRef<string[]>([defaultMenu]);
  const isOverview = [safeRole === "admin" ? "Dashboard Ringkas" : "Beranda"].includes(activeMenu);
  const isUsersPage = safeRole === "admin" && activeMenu === "Manajemen Pengguna";
  const isRiskPage = safeRole === "admin" && activeMenu === "Monitoring Risiko";
  const isAdminAlertsPage = safeRole === "admin" && activeMenu === "Alert & Tindak Lanjut";
  const isAdminAuditPage = safeRole === "admin" && activeMenu === "Riwayat & Audit Log";
  const isAdminReportsPage = safeRole === "admin" && activeMenu === "Laporan & Ekspor";
  const isAdminEducationPage = safeRole === "admin" && activeMenu === "Konten Edukasi";
  const isAdminBroadcastPage = safeRole === "admin" && activeMenu === "Broadcast Notifikasi";
  const isAdminRolePage = safeRole === "admin" && currentAdminRole === "super_admin" && activeMenu === "Manajemen Role";
  const isAdminTimelinePage = safeRole === "admin" && activeMenu === "Timeline Tindak Lanjut";
  const isAiResultPage = safeRole === "user" && activeMenu === "Hasil Edukasi";
  const isHistoryPage = safeRole === "user" && activeMenu === "Riwayat";
  const isAlertsPage = safeRole === "user" && activeMenu === "Peringatan Saya";
  const isReportsPage = isAdminReportsPage;
  const isSettingsPage = safeRole === "admin" ? activeMenu === "Pengaturan Sistem" : activeMenu === "Pengaturan";
  const isManualInputPage = safeRole === "user" && activeMenu === "Data Saya";
  const { normalizedAccent } = useMemo(() => {
    const normalized = normalizeHex(accentColor);
    return {
      normalizedAccent: normalized,
    };
  }, [accentColor]);
  const activeUserThemeTile = useMemo(
    () => USER_THEME_TILE_OPTIONS.find((item) => item.id === userThemeTileId) ?? USER_THEME_TILE_OPTIONS[0],
    [userThemeTileId]
  );
  const isUserImageThemeMode = safeRole === "user" && userThemeSourceMode === "doctor_tiles";
  const isUserImageThemeActive = isUserImageThemeMode && userThemeImageReady;
  const isDark = false;
  const themeClass = safeRole === "admin" ? "theme-admin-clean" : "theme-user-gold-soft";
  const useOperationalLayout = safeRole === "user" || adminDashboardDensity === "compact" || isMobileViewport;
  const shellSpacingClass =
    interfaceMode === "admin_mobile"
      ? "px-2.5 py-3 pb-24 sm:px-3 sm:py-4 md:pb-5 lg:px-6"
      : interfaceMode === "user_mobile"
        ? "px-3 py-3 pb-24 sm:px-4 sm:py-4 md:pb-5 lg:px-6"
        : useOperationalLayout
          ? "px-3 py-3 pb-24 sm:px-4 sm:py-4 md:pb-5 lg:px-6"
          : "px-4 py-6 pb-28 sm:px-6 md:pb-6 lg:px-10";
  const frameSpacingClass =
    interfaceMode === "admin_mobile"
      ? "max-w-6xl space-y-3"
      : interfaceMode === "user_mobile"
        ? "max-w-6xl space-y-4"
        : useOperationalLayout
          ? "max-w-6xl space-y-4"
          : "max-w-6xl space-y-6";
  const welcomeSectionClass =
    interfaceMode === "admin_mobile"
      ? "rounded-2xl p-3.5"
      : interfaceMode === "user_mobile"
        ? "rounded-2xl p-4"
        : useOperationalLayout
          ? "rounded-2xl p-4 lg:p-5"
          : "rounded-[2rem] p-6 lg:p-8";
  const commSectionClass =
    interfaceMode === "admin_mobile"
      ? "rounded-2xl p-3.5"
      : interfaceMode === "user_mobile"
        ? "rounded-2xl p-4"
        : useOperationalLayout
          ? "rounded-2xl p-4"
          : "rounded-[2rem] p-5";
  const contentSectionClass =
    interfaceMode === "admin_mobile"
      ? "rounded-2xl p-3.5 lg:p-4"
      : interfaceMode === "user_mobile"
        ? "rounded-2xl p-4 lg:p-5"
        : useOperationalLayout
          ? "rounded-2xl p-4 lg:p-5"
          : "rounded-[2rem] p-5 lg:p-6";
  const layoutGridClass =
    interfaceMode === "admin_web"
      ? "grid min-h-[560px] sm:min-h-[620px] lg:grid-cols-[320px_1fr]"
      : interfaceMode === "user_web"
        ? "grid min-h-[500px] sm:min-h-[600px] lg:grid-cols-[300px_1fr]"
        : "grid min-h-[460px] sm:min-h-[580px] lg:grid-cols-[300px_1fr]";
  const userPageHeaderClass =
    "rounded-2xl border border-amber-100 bg-gradient-to-r from-white to-amber-50/80 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm";
  const userPageStatCardClass =
    "rounded-2xl border border-amber-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm";
  const userPageSurfaceClass =
    "rounded-2xl border border-amber-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm";
  const isAdminMobileMode = interfaceMode === "admin_mobile";
  const isUserMobileMode = interfaceMode === "user_mobile";
  const overviewLayoutClass =
    safeRole === "admin"
      ? isAdminMobileMode
        ? "grid gap-3"
        : "grid gap-4 xl:grid-cols-[1fr_280px]"
      : isUserMobileMode
        ? "grid gap-3"
        : safeRole === "user" && isUserImageThemeActive
          ? "grid grid-cols-1 gap-4"
          : "grid gap-4 xl:grid-cols-[1fr_280px]";
  const overviewCardGridClass =
    safeRole === "admin"
      ? isAdminMobileMode
        ? "stagger-children grid grid-cols-2 gap-2.5"
        : "stagger-children grid gap-3 sm:grid-cols-2 2xl:grid-cols-4"
      : isUserMobileMode
        ? "stagger-children grid grid-cols-2 gap-2.5"
      : safeRole === "user" && isUserImageThemeActive
        ? "stagger-children grid gap-3 md:grid-cols-2"
        : "stagger-children grid gap-3 sm:grid-cols-2 2xl:grid-cols-4";
  const aiInsightPreview =
    commReply.trim() || "Belum ada ringkasan edukasi kesehatan. Buka menu Ringkasan AI Kesehatan lalu kirim pertanyaan.";
  const latestMealsDisplay = formatMealsDisplay(latest?.meals ?? "-");
  const sleepScheduleMetrics = useMemo(() => {
    const nowMinutes = phoneNow.getHours() * 60 + phoneNow.getMinutes();
    const sleepStartMinutes = parseTimeToMinutes(sleepStartTime);
    const wakeMinutes = parseTimeToMinutes(wakeTime);
    const estimatedSleepHours = getSleepDurationFromSchedule(sleepStartTime, wakeTime);
    const inSleepWindow = isInSleepWindow(nowMinutes, sleepStartMinutes, wakeMinutes);
    const awakeSince = getLastWakeDateTime(phoneNow, wakeMinutes);
    const wakeDateKey = `${awakeSince.getFullYear()}-${String(awakeSince.getMonth() + 1).padStart(2, "0")}-${String(
      awakeSince.getDate()
    ).padStart(2, "0")}`;
    const awakeHours = Math.max(0, Number(((phoneNow.getTime() - awakeSince.getTime()) / (1000 * 60 * 60)).toFixed(1)));
    const overAwakeLimit = awakeHours >= maxAwakeHours;

    return {
      estimatedSleepHours,
      inSleepWindow,
      awakeHours,
      wakeDateKey,
      overAwakeLimit,
      nowLabel: phoneNow.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
      dateLabel: phoneNow.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
      reminderStampBase: `${phoneNow.getFullYear()}-${String(phoneNow.getMonth() + 1).padStart(2, "0")}-${String(
        phoneNow.getDate()
      ).padStart(2, "0")}`,
    };
  }, [maxAwakeHours, phoneNow, sleepStartTime, wakeTime]);
  const personalDataTables = useMemo(() => {
    const now = new Date();
    const toMillis = (item: HealthData, index: number) => item.timestamp?.toMillis?.() ?? item.timestamp?.toDate?.().getTime?.() ?? index;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const buildRecords = (days: number): PersonalPeriodRecord[] => {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - (days - 1));
      const startMs = start.getTime();

      return data
        .map((item, index) => {
          const millis = toMillis(item, index);
          return { item, millis };
        })
        .filter((entry) => entry.millis >= startMs)
        .sort((a, b) => b.millis - a.millis)
        .map(({ item, millis }) => {
          const parts = formatDayDateTime(millis);
          return {
            id: item.id,
            millis,
            dayLabel: parts.dayLabel,
            dateLabel: parts.dateLabel,
            timeLabel: parts.timeLabel,
            steps: Number(item.steps ?? 0),
            height: Number(item.height ?? 0),
            weight: Number(item.weight ?? 0),
            calories: Number(item.calories ?? 0),
            sleep: Number(item.sleep ?? 0),
            heartRate: Number(item.heartRate ?? 0),
            bloodPressure: String(item.bloodPressure ?? "0/0"),
            meals: String(item.meals ?? "-"),
          };
        });
    };

    const toDailyPoints = (records: PersonalPeriodRecord[]) => {
      const byDate = new Map<string, PersonalPeriodPoint>();
      records.forEach((row) => {
        const stamp = new Date(row.millis);
        const key = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(
          2,
          "0"
        )}`;
        if (!byDate.has(key)) {
          byDate.set(key, {
            dateKey: key,
            label: stamp.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "2-digit" }),
            steps: row.steps,
            sleep: row.sleep,
            calories: row.calories,
          });
        }
      });
      return Array.from(byDate.values());
    };

    const classifyLifestyle = (rows: PersonalPeriodPoint[], totalDays: number) => {
      if (rows.length === 0) return { label: "Tidak Bagus", note: "Belum ada data masuk pada periode ini." };
      const totalSteps = rows.reduce((sum, row) => sum + row.steps, 0);
      const avgSteps = totalSteps / rows.length;
      const avgSleep = rows.reduce((sum, row) => sum + row.sleep, 0) / rows.length;
      const coverage = rows.length / totalDays;
      const isGood = avgSteps >= 7000 && avgSleep >= 7 && avgSleep <= 9 && coverage >= 0.6;
      return {
        label: isGood ? "Bagus" : "Tidak Bagus",
        note: `Rata-rata langkah ${Math.round(avgSteps).toLocaleString("id-ID")}/hari, tidur ${avgSleep.toFixed(
          1
        )} jam, data tercatat ${rows.length}/${totalDays} hari.`,
      };
    };

    const weekRecords = buildRecords(7);
    const monthRecords = buildRecords(30);
    const weekDailyPoints = toDailyPoints(weekRecords);
    const monthDailyPoints = toDailyPoints(monthRecords);
    const weekSleepAvg =
      weekDailyPoints.length > 0
        ? (weekDailyPoints.reduce((sum, point) => sum + point.sleep, 0) / weekDailyPoints.length).toFixed(1)
        : "0.0";
    const monthSleepAvg =
      monthDailyPoints.length > 0
        ? (monthDailyPoints.reduce((sum, point) => sum + point.sleep, 0) / monthDailyPoints.length).toFixed(1)
        : "0.0";
    const weeklyLifestyle = classifyLifestyle(weekDailyPoints, 7);
    const monthlyLifestyle = classifyLifestyle(monthDailyPoints, 30);

    return {
      weekRecords,
      monthRecords,
      weekSleepAvg,
      monthSleepAvg,
      weekStepsTotal: weekDailyPoints.reduce((sum, point) => sum + point.steps, 0),
      monthStepsTotal: monthDailyPoints.reduce((sum, point) => sum + point.steps, 0),
      weeklyLifestyle,
      monthlyLifestyle,
    };
  }, [data]);
  const nutritionIndicators = useMemo(() => {
    const parsed = parseStructuredMeals(latest?.meals ?? "");
    if (!parsed) return [];
    return [
      { label: "Karbo", value: `${parsed.karbo} porsi`, status: evaluateNutritionPortion("karbo", parsed.karbo) },
      {
        label: "Protein",
        value: `${parsed.protein} porsi`,
        status: evaluateNutritionPortion("protein", parsed.protein),
      },
      { label: "Sayur", value: `${parsed.sayur} porsi`, status: evaluateNutritionPortion("sayur", parsed.sayur) },
      { label: "Buah", value: `${parsed.buah} porsi`, status: evaluateNutritionPortion("buah", parsed.buah) },
      { label: "Air", value: `${parsed.air} gelas`, status: evaluateNutritionPortion("air", parsed.air) },
    ];
  }, [latest?.meals]);
  const overviewCards = useMemo(() => {
    const steps = latest?.steps ?? 0;
    const height = latest?.height ?? 0;
    const weight = latest?.weight ?? 0;
    const calories = latest?.calories ?? 0;
    const sleep = latest?.sleep ?? 0;
    const heartRate = latest?.heartRate ?? 0;
    const rawBloodPressure = String(latest?.bloodPressure ?? "").trim();
    const bloodPressure = rawBloodPressure && rawBloodPressure !== "0/0" ? rawBloodPressure : "-";
    const bmi = calculateBmi(weight, height);
    const bmiScore = scoreBmiIdeal(bmi);
    const bmrTarget = Math.round(
      safeUserGender === "pria"
        ? 10 * (weight > 0 ? weight : 60) + 6.25 * (height > 0 ? height : 165) - 5 * (userAge > 0 ? userAge : 25) + 5
        : safeUserGender === "wanita"
          ? 10 * (weight > 0 ? weight : 60) + 6.25 * (height > 0 ? height : 155) - 5 * (userAge > 0 ? userAge : 25) - 161
          : (10 * (weight > 0 ? weight : 60) + 6.25 * (height > 0 ? height : 165) - 5 * (userAge > 0 ? userAge : 25) + 5 +
              (10 * (weight > 0 ? weight : 60) + 6.25 * (height > 0 ? height : 155) - 5 * (userAge > 0 ? userAge : 25) - 161)) /
              2
    );
    const caloriesScore = bmrTarget > 0 && calories > 0 ? clampPercent(100 - (Math.abs(calories - bmrTarget) / bmrTarget) * 100) : 0;
    const sleepScore = scoreSleepDuration(sleep);
    const heartRateScore = scoreHeartRate(heartRate);
    const bloodPressureScore = scoreBloodPressure(bloodPressure);
    const metricPrimary = "#d9aa48";
    const metricSecondary = "#60a5fa";
    const nutritionScore =
      nutritionIndicators.length > 0
        ? clampPercent(
            (nutritionIndicators.reduce((sum, item) => {
              if (item.status === "baik") return sum + 1;
              if (item.status === "waspada") return sum + 0.5;
              return sum;
            }, 0) /
              nutritionIndicators.length) *
              100
          )
        : 0;

    return [
      {
        title: "Langkah",
        value: steps.toLocaleString("id-ID"),
        caption: "Target 8.000 langkah",
        percent: steps > 0 ? (steps / 8000) * 100 : 0,
        color: metricPrimary,
      },
      {
        title: "Tinggi Badan",
        value: `${height} cm`,
        caption: "Data profil",
        percent: height > 0 ? 100 : 0,
        color: metricPrimary,
      },
      {
        title: "Berat Badan",
        value: `${weight} kg`,
        caption: `Mendekati IMT ideal (IMT ${bmi > 0 ? bmi.toFixed(1) : "0.0"})`,
        percent: bmiScore,
        color: metricPrimary,
      },
      {
        title: "Kalori",
        value: `${calories}`,
        caption: `Target BMR ~${bmrTarget} kkal`,
        percent: caloriesScore,
        color: metricPrimary,
      },
      {
        title: "Durasi Tidur",
        value: `${sleep} j`,
        caption: "Target 7-9 jam tidur",
        percent: sleepScore,
        color: metricSecondary,
      },
      {
        title: "Detak Jantung",
        value: heartRate > 0 ? `${heartRate} bpm` : "-",
        caption: "Target 60-100 bpm",
        percent: heartRateScore,
        color: metricSecondary,
      },
      {
        title: "Tekanan Darah",
        value: bloodPressure,
        caption: "Target <120/<80",
        percent: bloodPressureScore,
        color: metricSecondary,
      },
      {
        title: "Pola Makan",
        value: latestMealsDisplay,
        caption: "Skor Isi Piringku",
        percent: nutritionScore,
        color: metricSecondary,
      },
    ];
  }, [latest, latestMealsDisplay, nutritionIndicators, userAge, safeUserGender]);
  const userDailyFocusMessage = useMemo(() => {
    if (riskLevel === "Rendah") {
      return "Kondisi kamu stabil. Pertahankan pola tidur dan aktivitas harian.";
    }
    if (riskLevel === "Sedang") {
      return "Ada beberapa indikator yang perlu diperhatikan. Fokus pada tidur dan hidrasi hari ini.";
    }
    return "Perlu perhatian lebih. Prioritaskan istirahat, pola makan seimbang, dan pantau gejala.";
  }, [riskLevel]);
  const adminUserRows = useMemo(() => {
    const toMillis = (item: HealthData, index: number) =>
      item.timestamp?.toMillis?.() ?? item.timestamp?.toDate?.().getTime?.() ?? index;
    const grouped = new Map<
      string,
      {
        ownerEmail: string;
        latest: HealthData;
        latestMillis: number;
        recordCount: number;
      }
    >();

    data.forEach((item, index) => {
      const ownerEmail = (item.ownerEmail ?? "").trim() || "tanpa-email";
      const emailKey = ownerEmail.toLowerCase();
      const millis = toMillis(item, index);
      const existing = grouped.get(emailKey);
      if (!existing) {
        grouped.set(emailKey, {
          ownerEmail,
          latest: item,
          latestMillis: millis,
          recordCount: 1,
        });
        return;
      }
      existing.recordCount += 1;
      if (millis >= existing.latestMillis) {
        existing.latest = item;
        existing.latestMillis = millis;
      }
    });

    if (safeRole === "admin") {
      safeUserDirectory.forEach((profile) => {
        const ownerEmail = (profile.ownerEmail ?? "").trim();
        if (!ownerEmail) return;
        const emailKey = ownerEmail.toLowerCase();
        if (grouped.has(emailKey)) return;

        const fallbackMillis = profile.lastLoginAtMs ?? profile.updatedAtMs ?? profile.createdAtMs ?? 0;
        grouped.set(emailKey, {
          ownerEmail,
          latest: {
            id: `profile-${emailKey}`,
            steps: 0,
            height: 0,
            weight: 0,
            calories: 0,
            sleep: 0,
            heartRate: 0,
            bloodPressure: "0/0",
            meals: "-",
            ownerEmail,
            ownerUid: profile.ownerUid || "",
            source: "profile_only",
            timestamp: null,
          },
          latestMillis: fallbackMillis,
          recordCount: 0,
        });
      });
    }

    return Array.from(grouped.values())
      .map((entry) => {
        if (entry.recordCount === 0) {
          return {
            ownerEmail: entry.ownerEmail,
            latest: entry.latest,
            lastSeenLabel: entry.latestMillis > 0 ? new Date(entry.latestMillis).toLocaleString("id-ID") : "Baru daftar/login",
            recordCount: 0,
            riskScore: 0,
            riskLevel: "Rendah" as const,
            riskNotes: ["Belum ada data kesehatan yang masuk."],
            hasActiveAlert: false,
          };
        }
        const metrics = assessKemenkesMetrics(entry.latest, { gender: "tidak_ditentukan", age: 30 });
        return {
          ownerEmail: entry.ownerEmail,
          latest: entry.latest,
          lastSeenLabel: new Date(entry.latestMillis).toLocaleString("id-ID"),
          recordCount: entry.recordCount,
          riskScore: metrics.riskScore,
          riskLevel: metrics.riskLevel,
          riskNotes: metrics.riskNotes,
          hasActiveAlert: metrics.riskLevel !== "Rendah",
        };
      })
      .sort((a, b) => {
        if (a.riskScore === b.riskScore) return b.recordCount - a.recordCount;
        return b.riskScore - a.riskScore;
      });
  }, [data, safeRole, safeUserDirectory]);
  const adminAlerts = useMemo(
    () =>
      adminUserRows
        .filter((item) => item.hasActiveAlert)
        .map((item, index) => ({
          id: `${item.ownerEmail}-${index}`,
          ownerEmail: item.ownerEmail,
          level: item.riskLevel === "Tinggi" ? "Tinggi" : "Sedang",
          score: item.riskScore,
          note: item.riskNotes[0] ?? "Butuh tindak lanjut admin.",
          status: adminFollowUpMap[item.ownerEmail] ?? "baru",
        }))
        .sort((a, b) => b.score - a.score),
    [adminFollowUpMap, adminUserRows]
  );
  const adminAuditLogs = useMemo(() => {
    const rows = data
      .map((item, index) => {
        const millis = item.timestamp?.toMillis?.() ?? item.timestamp?.toDate?.().getTime?.() ?? index;
        return {
          id: item.id,
          ownerEmail: item.ownerEmail ?? "-",
          source: item.source ?? "unknown",
          createdAt: millis,
          detail: `Langkah ${Number(item.steps ?? 0).toLocaleString("id-ID")}, tidur ${Number(item.sleep ?? 0)} jam, detak ${Number(
            item.heartRate ?? 0
          )} bpm`,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return rows.slice(0, 80);
  }, [data]);
  const userHistoryRecords = useMemo(() => {
    const allowedSources = new Set([
      "manual_user_input",
      "device_vitals",
      "device_activity",
      "location_tracker",
      "location_tracker_offline_sync",
    ]);
    return [...data]
      .filter((item) => allowedSources.has(String(item.source ?? "")))
      .sort((a, b) => {
        const at = a.timestamp?.toMillis?.() ?? a.timestamp?.toDate?.().getTime?.() ?? 0;
        const bt = b.timestamp?.toMillis?.() ?? b.timestamp?.toDate?.().getTime?.() ?? 0;
        return bt - at;
      });
  }, [data]);
  const adminKpi = useMemo(() => {
    const totalUsers = adminUserRows.length;
    const highRiskUsers = adminUserRows.filter((item) => item.riskLevel === "Tinggi").length;
    const mediumRiskUsers = adminUserRows.filter((item) => item.riskLevel === "Sedang").length;
    const activeAlerts = adminAlerts.filter((item) => item.status !== "selesai").length;
    return { totalUsers, highRiskUsers, mediumRiskUsers, activeAlerts };
  }, [adminAlerts, adminUserRows]);
  const adminOverviewCards = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    const todayMeasurements = data.filter((item) => {
      const millis = item.timestamp?.toMillis?.() ?? item.timestamp?.toDate?.().getTime?.() ?? 0;
      return millis >= startOfDay && millis < endOfDay;
    }).length;
    return [
      {
        title: "Total Pasien",
        value: adminKpi.totalUsers.toLocaleString("id-ID"),
        caption: "Pengguna terpantau",
        percent: clampPercent((adminKpi.totalUsers / Math.max(adminKpi.totalUsers, 1)) * 100),
        color: "#c8953c",
      },
      {
        title: "Pengukuran Hari Ini",
        value: todayMeasurements.toLocaleString("id-ID"),
        caption: "Catatan harian masuk",
        percent: clampPercent((todayMeasurements / Math.max(12, todayMeasurements)) * 100),
        color: "#2563eb",
      },
      {
        title: "Data Perlu Perhatian",
        value: adminKpi.activeAlerts.toLocaleString("id-ID"),
        caption: "Peringatan belum selesai",
        percent: clampPercent((adminKpi.activeAlerts / Math.max(adminKpi.totalUsers, 1)) * 100),
        color: "#dc2626",
      },
      {
        title: "Kasus Risiko Tinggi",
        value: adminKpi.highRiskUsers.toLocaleString("id-ID"),
        caption: "Prioritas tindak lanjut",
        percent: clampPercent((adminKpi.highRiskUsers / Math.max(adminKpi.totalUsers, 1)) * 100),
        color: "#7c3aed",
      },
    ];
  }, [adminKpi, data]);
  const userMobileOverviewCards = useMemo(
    () => [
      {
        title: "Langkah",
        value: (latest?.steps ?? 0).toLocaleString("id-ID"),
        caption: "Target 8.000",
        percent: latest?.steps ? (latest.steps / 8000) * 100 : 0,
        color: "#c8953c",
      },
      {
        title: "Tidur",
        value: `${latest?.sleep ?? 0} j`,
        caption: "Target 7-9 jam",
        percent: scoreSleepDuration(latest?.sleep ?? 0),
        color: "#2563eb",
      },
      {
        title: "Detak",
        value: latest?.heartRate ? `${latest.heartRate} bpm` : "-",
        caption: "Rentang 60-100",
        percent: scoreHeartRate(latest?.heartRate ?? 0),
        color: "#0ea5e9",
      },
      {
        title: "Tekanan",
        value: latest?.bloodPressure && latest.bloodPressure !== "0/0" ? latest.bloodPressure : "-",
        caption: "Target <120/<80",
        percent: scoreBloodPressure(latest?.bloodPressure ?? "0/0"),
        color: "#16a34a",
      },
    ],
    [latest]
  );
  const displayedOverviewCards = useMemo(() => {
    if (safeRole === "admin") return adminOverviewCards;
    if (isUserMobileMode) return userMobileOverviewCards;
    return overviewCards;
  }, [adminOverviewCards, isUserMobileMode, overviewCards, safeRole, userMobileOverviewCards]);
  const adminPatientPreviewRows = useMemo(
    () =>
      adminUserRows.slice(0, 6).map((item) => ({
        ownerEmail: item.ownerEmail,
        status: item.riskLevel === "Tinggi" || item.riskLevel === "Sedang" ? "Perlu Perhatian" : "Normal",
        statusTone: item.riskLevel === "Tinggi" || item.riskLevel === "Sedang" ? "warning" : "normal",
        pulse: item.latest.heartRate > 0 ? `${item.latest.heartRate} bpm` : "-",
      })),
    [adminUserRows]
  );
  const filteredAdminUsers = useMemo(() => {
    const search = adminUserSearch.trim().toLowerCase();
    const rows = adminUserRows.filter((item) => {
      const matchSearch = search.length === 0 || item.ownerEmail.toLowerCase().includes(search);
      const matchRisk =
        adminRiskFilter === "semua" ||
        (adminRiskFilter === "tinggi" && item.riskLevel === "Tinggi") ||
        (adminRiskFilter === "sedang" && item.riskLevel === "Sedang") ||
        (adminRiskFilter === "rendah" && item.riskLevel === "Rendah");
      return matchSearch && matchRisk;
    });
    if (adminUserSort === "recent") {
      return [...rows].sort((a, b) => {
        const at = a.latest.timestamp?.toMillis?.() ?? a.latest.timestamp?.toDate?.().getTime?.() ?? 0;
        const bt = b.latest.timestamp?.toMillis?.() ?? b.latest.timestamp?.toDate?.().getTime?.() ?? 0;
        return bt - at;
      });
    }
    if (adminUserSort === "records") {
      return [...rows].sort((a, b) => b.recordCount - a.recordCount);
    }
    return [...rows].sort((a, b) => b.riskScore - a.riskScore);
  }, [adminRiskFilter, adminUserRows, adminUserSearch, adminUserSort]);
  const filteredAdminAlerts = useMemo(
    () =>
      adminAlerts.filter((item) => {
        if (adminAlertStatusFilter === "semua") return true;
        return item.status === adminAlertStatusFilter;
      }),
    [adminAlertStatusFilter, adminAlerts]
  );
  const filteredAdminEducation = useMemo(
    () =>
      adminEducationLibrary.filter((item) => {
        if (adminEducationFilter === "semua") return true;
        return item.category === adminEducationFilter;
      }),
    [adminEducationFilter, adminEducationLibrary]
  );
  const adminCompletionRate = useMemo(() => {
    if (adminAlerts.length === 0) return 100;
    const done = adminAlerts.filter((item) => item.status === "selesai").length;
    return Math.round((done / adminAlerts.length) * 100);
  }, [adminAlerts]);
  const adminBroadcastTargets = useMemo(() => {
    if (adminBroadcastSegment === "risiko_tinggi") return adminUserRows.filter((item) => item.riskLevel === "Tinggi");
    if (adminBroadcastSegment === "risiko_sedang") return adminUserRows.filter((item) => item.riskLevel === "Sedang");
    if (adminBroadcastSegment === "alert_terbuka") {
      const alerted = new Set(adminAlerts.filter((item) => item.status !== "selesai").map((item) => item.ownerEmail));
      return adminUserRows.filter((item) => alerted.has(item.ownerEmail));
    }
    return adminUserRows;
  }, [adminAlerts, adminBroadcastSegment, adminUserRows]);
  const adminRoster = useMemo(() => {
    const merged = new Set<string>(safeAdminRoster);
    const currentEmail = safeUserEmail.trim().toLowerCase();
    if (safeRole === "admin" && currentEmail) merged.add(currentEmail);
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [safeAdminRoster, safeRole, safeUserEmail]);
  const adminRoleByEmail = useMemo(
    () =>
      Object.fromEntries(
        adminRoster.map((email) => [email, safeSuperAdminRoster.includes(email) ? "super_admin" : "operator"])
      ) as Record<string, "super_admin" | "operator">,
    [adminRoster, safeSuperAdminRoster]
  );
  const adminSystemHealth = useMemo(() => {
    const warnings: string[] = [];
    if (!adminAiProxyEnabled) warnings.push("AI Proxy nonaktif");
    if (adminWebhookEnabled && adminWebhookUrl.trim().length === 0) warnings.push("Webhook aktif tanpa URL");
    if (adminDataRetentionDays < 90) warnings.push("Retensi data terlalu pendek");
    if (adminEscalationHours > 48) warnings.push("Escalation terlalu lambat");
    if (adminRequire2FA === false) warnings.push("2FA admin belum diwajibkan");
    return {
      status: warnings.length === 0 ? "Sehat" : warnings.length <= 2 ? "Waspada" : "Kritis",
      warnings,
    };
  }, [
    adminAiProxyEnabled,
    adminDataRetentionDays,
    adminEscalationHours,
    adminRequire2FA,
    adminWebhookEnabled,
    adminWebhookUrl,
  ]);
  const openCommunication = useCallback(() => {
    setCommOpen(true);
    setTimeout(() => {
      commSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);
  const onboardingItems = useMemo(
    () => [
      {
        title: "Pantau dari Beranda",
        detail: "Cek ringkasan langkah, tidur, detak, dan tekanan darah di halaman utama.",
        actionLabel: "Buka Beranda",
        onAction: () => setActiveMenu(safeRole === "admin" ? "Dashboard Ringkas" : "Beranda"),
      },
      {
        title: "Pantau riwayat kesehatan",
        detail: "Buka Riwayat untuk meninjau catatan pengukuran kesehatan dan konsistensi kebiasaan harian.",
        actionLabel: "Buka Riwayat",
        onAction: () => setActiveMenu(safeRole === "admin" ? "Dashboard Ringkas" : "Riwayat"),
      },
      {
        title: "Tanya Edukasi & atur pengingat",
        detail: "Gunakan Ringkasan AI Kesehatan untuk edukasi cepat, lalu aktifkan pengingat di Pengaturan.",
        actionLabel: "Buka Ringkasan AI Kesehatan",
        onAction: () => openCommunication(),
      },
    ],
    [safeRole, openCommunication]
  );
  const showOnboarding = !onboardingSeen && safeRole === "user";

  const closeOnboarding = () => {
    setOnboardingSeen(true);
    setOnboardingStep(0);
  };

  const nextOnboarding = () => {
    if (onboardingStep >= onboardingItems.length - 1) {
      closeOnboarding();
      return;
    }
    setOnboardingStep((prev) => prev + 1);
  };

  const speak = (text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  };

  const toggleMic = () => {
    if (!IS_AI_PROXY_ENABLED) {
      setCommError("Mode gratis aktif: fitur AI mikrofon dinonaktifkan.");
      return;
    }

    if (listening) {
      if (fallbackRecording && fallbackRecorderRef.current) {
        fallbackRecorderRef.current.stop();
      } else {
        recognitionRef.current?.stop();
      }
      setListening(false);
      return;
    }

    const speechApi = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;

    if (speechApi) {
      const recognition = new speechApi();
      recognition.lang = "id-ID";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        const transcript = Array.from(event.results)
          .map((r) => r[0].transcript)
          .join(" ")
          .trim();
        setMessage(transcript);
        setCommError("");
      };

      recognition.onerror = () => {
        setCommError("Input mikrofon gagal. Coba lagi atau ketik manual.");
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setCommError("Browser belum mendukung mode mikrofon otomatis di perangkat ini.");
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        fallbackStreamRef.current = stream;
        fallbackChunksRef.current = [];

        const preferredMime =
          MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
            ? "audio/webm;codecs=opus"
            : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const recorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime }) : new MediaRecorder(stream);
        fallbackRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            fallbackChunksRef.current.push(event.data);
          }
        };

        recorder.onstop = async () => {
          setFallbackRecording(false);
          setListening(false);

          stream.getTracks().forEach((track) => track.stop());
          fallbackStreamRef.current = null;

          const blob = new Blob(fallbackChunksRef.current, { type: preferredMime || "audio/webm" });
          fallbackChunksRef.current = [];
          if (blob.size === 0) {
            setCommError("Rekaman kosong. Coba ulangi dan bicara lebih dekat ke mikrofon.");
            return;
          }

          try {
            setCommError("Mentranskrip suara...");
            const result = await transcribeAudioWithAI(blob);
            setMessage((prev) => {
              const prefix = prev.trim();
              return prefix ? `${prefix} ${result.text}` : result.text;
            });
            setCommError("");
          } catch (error) {
            if (error instanceof Error && error.message === "AI_PROXY_DISABLED") {
              setCommError("Mode gratis aktif: fitur AI mikrofon dinonaktifkan.");
            } else
            if (error instanceof Error && error.message === "AI_BACKEND_UNAVAILABLE") {
              setCommError("Backend AI belum aktif. Isi VITE_OPENAI_API_KEY lokal atau aktifkan endpoint /api.");
            } else
            if (error instanceof Error && (error.message === "AUTH_REQUIRED" || error.message === "UNAUTHORIZED")) {
              setCommError("Sesi login tidak valid. Silakan login ulang lalu coba lagi.");
            } else if (error instanceof Error && error.message === "RATE_LIMITED") {
              setCommError("Transkripsi suara kena limit (429). Coba lagi beberapa saat.");
            } else {
              setCommError("Transkripsi mikrofon gagal. Coba ulangi atau ketik manual.");
            }
          }
        };

        recorder.start();
        setFallbackRecording(true);
        setListening(true);
        setCommError("Mode rekam aktif. Tekan Stop Mic setelah selesai bicara.");
      })
      .catch(() => {
        setCommError("Akses mikrofon ditolak. Izinkan mikrofon di browser lalu coba lagi.");
      });
  };

  const handleCommunicate = async () => {
    if (!IS_AI_PROXY_ENABLED) {
      setCommError("Mode gratis aktif: fitur edukasi AI dinonaktifkan.");
      return;
    }

    if (!message.trim()) {
      setCommError("Isi pertanyaan atau nyalakan mic dulu.");
      return;
    }

    try {
      setThinking(true);
      setCommError("");
      const result = await communicateWithVisionAI({
        userMessage: message.trim(),
        latest,
      });
      setCommReply(result.replyText);
      speak(result.replyText);
    } catch (error) {
      if (error instanceof Error && error.message === "AI_PROXY_DISABLED") {
        setCommError("Mode gratis aktif: fitur edukasi AI dinonaktifkan.");
      } else
      if (error instanceof Error && error.message === "AI_BACKEND_UNAVAILABLE") {
        setCommError("Backend AI belum aktif. Isi VITE_OPENAI_API_KEY lokal atau aktifkan endpoint /api.");
      } else
      if (error instanceof Error && (error.message === "AUTH_REQUIRED" || error.message === "UNAUTHORIZED")) {
        setCommError("Sesi login tidak valid. Silakan login ulang lalu coba lagi.");
      } else if (error instanceof Error && error.message === "RATE_LIMITED") {
        setCommError("Permintaan edukasi kena limit (429). Tunggu sebentar lalu coba lagi.");
      } else {
        setCommError("Edukasi belum merespons. Coba kirim ulang beberapa detik lagi.");
      }
    } finally {
      setThinking(false);
    }
  };

  const showToast = useCallback((message: string, tone: "info" | "success" | "error" = "info") => {
    setToastState({ message, tone });
  }, []);

  const exportPersonalRecords = (period: "week" | "month") => {
    const records = period === "week" ? personalDataTables.weekRecords : personalDataTables.monthRecords;
    if (records.length === 0) {
      setManualStatusTone("error");
      setManualStatus(`Belum ada data ${period === "week" ? "mingguan" : "bulanan"} untuk disimpan.`);
      showToast("Belum ada data untuk diekspor.", "error");
      return;
    }

    const headers = ["Hari", "Tanggal", "Jam", "Langkah", "Tinggi", "Berat", "Tidur", "Detak", "Darah", "Kalori", "Makan"];
    const rows = records.map((row) => [
      row.dayLabel,
      row.dateLabel,
      row.timeLabel,
      row.steps,
      `${row.height} cm`,
      `${row.weight} kg`,
      `${row.sleep} jam`,
      `${row.heartRate} bpm`,
      row.bloodPressure,
      row.calories,
      formatMealsDisplay(row.meals),
    ]);

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(
      2,
      "0"
    )}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const filename = `data-saya-${period === "week" ? "mingguan-7hari" : "bulanan-30hari"}-${stamp}.csv`;

    downloadExcelCsv(filename, headers, rows);
    setManualStatusTone("success");
    setManualStatus(`File ${filename} berhasil disimpan. Bisa dibuka dengan Excel.`);
    showToast(`Ekspor berhasil: ${filename}`, "success");
  };
  const exportAdminReport = (kind: "users" | "alerts" | "audit") => {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(
      2,
      "0"
    )}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    if (kind === "users") {
      const headers = ["Email", "Status Risiko", "Skor Risiko", "Jumlah Catatan", "Terakhir Update"];
      const rows = adminUserRows.map((item) => [item.ownerEmail, item.riskLevel, item.riskScore, item.recordCount, item.lastSeenLabel]);
      const filename = `admin-pengguna-${stamp}.csv`;
      downloadExcelCsv(filename, headers, rows);
      setManualStatusTone("success");
      setManualStatus(`File ${filename} berhasil disimpan.`);
      showToast(`Ekspor berhasil: ${filename}`, "success");
      return;
    }
    if (kind === "alerts") {
      const headers = ["Email", "Prioritas", "Skor", "Status Follow Up", "Catatan"];
      const rows = adminAlerts.map((item) => [item.ownerEmail, item.level, item.score, item.status, item.note]);
      const filename = `admin-alert-${stamp}.csv`;
      downloadExcelCsv(filename, headers, rows);
      setManualStatusTone("success");
      setManualStatus(`File ${filename} berhasil disimpan.`);
      showToast(`Ekspor berhasil: ${filename}`, "success");
      return;
    }
    const headers = ["Waktu", "Email", "Sumber", "Detail"];
    const rows = adminAuditLogs.map((item) => [
      new Date(item.createdAt).toLocaleString("id-ID"),
      item.ownerEmail,
      item.source,
      item.detail,
    ]);
    const filename = `admin-audit-log-${stamp}.csv`;
    downloadExcelCsv(filename, headers, rows);
    setManualStatusTone("success");
    setManualStatus(`File ${filename} berhasil disimpan.`);
    showToast(`Ekspor berhasil: ${filename}`, "success");
  };
  const setAlertFollowUpStatus = (ownerEmail: string, status: "baru" | "diproses" | "selesai") => {
    const current = adminFollowUpMap[ownerEmail] ?? "baru";
    if (current === status) return;
    setAdminFollowUpMap((prev) => ({ ...prev, [ownerEmail]: status }));
    setAdminTimeline((prev) => [
      {
        id: `${Date.now()}-${ownerEmail}`,
        ownerEmail,
        fromStatus: current,
        toStatus: status,
        createdAt: Date.now(),
        actorEmail: safeUserEmail || "admin",
      },
      ...prev,
    ]);
  };
  const toggleEducationStatus = (id: string) => {
    setAdminEducationLibrary((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: item.status === "published" ? "draft" : "published", updatedAt: Date.now() }
          : item
      )
    );
  };
  const commitAdminSetting = ({
    area,
    field,
    oldValue,
    newValue,
    sensitive = false,
    apply,
  }: {
    area: string;
    field: string;
    oldValue: string | number | boolean;
    newValue: string | number | boolean;
    sensitive?: boolean;
    apply: () => void;
  }) => {
    if (String(oldValue) === String(newValue)) return;
    let reasonText = adminChangeReason.trim();
    if (sensitive && adminRequireReasonSensitive && reasonText.length === 0) {
      const promptedAlasan = window.prompt(`Masukkan alasan perubahan untuk "${field}":`, "");
      if (!promptedAlasan || promptedAlasan.trim().length === 0) {
        setSettingsStatus(`Perubahan "${field}" dibatalkan karena alasan belum diisi.`);
        return;
      }
      reasonText = promptedAlasan.trim();
    }
    apply();
    const log: AdminSettingsChangeLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      area,
      field,
      oldValue: String(oldValue),
      newValue: String(newValue),
      sensitive,
      reason: sensitive ? reasonText || "-" : "-",
      actorEmail: safeUserEmail || "admin",
      changedAt: Date.now(),
    };
    setAdminConfigLogs((prev) => [log, ...prev].slice(0, 300));
    setSettingsStatus(`Pengaturan "${field}" berhasil diperbarui.`);
    if (sensitive) setAdminChangeReason("");
  };
  const runSettingsNotificationPreview = async () => {
    if (!("Notification" in window)) {
      playReminderSound();
      alert(effectiveReminderMessage);
      setSettingsStatus("Browser tidak mendukung Notification API. Menggunakan fallback alert.");
      return;
    }

    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSettingsStatus("Izin notifikasi belum diberikan. Pratinjau dibatalkan.");
        return;
      }
    }

    if (Notification.permission === "granted") {
      new Notification(safeRole === "admin" ? "Pratinjau Pengaturan Sistem" : "Pratinjau Pengingat Harian", {
        body: effectiveReminderMessage,
      });
      playReminderSound();
      setSettingsStatus("Pratinjau notifikasi berhasil dikirim.");
      return;
    }

    setSettingsStatus("Izin notifikasi ditolak oleh browser.");
  };
  const resetReminderConfig = () => {
    setReminderEnabled(false);
    setReminderTime("20:00");
    setReminderMessage("Waktunya melakukan pemantauan kesehatan harian Anda.");
    setReminderSoundEnabled(true);
    setWarningNotificationEnabled(true);
    setSleepScheduleEnabled(true);
    setSleepStartTime("22:00");
    setWakeTime("06:00");
    setMaxAwakeHours(16);
    setSleepAutoSyncEnabled(true);
    setSettingsStatus("Konfigurasi pengingat berhasil direset ke default.");
  };
  const resetDisplayConfig = () => {
    setThemeMode("light");
    setAccentColor("#2563eb");
    setSettingsStatus("Tema dan warna aksen dikembalikan ke default.");
  };
  const resetUserPreferenceConfig = () => {
    resetReminderConfig();
    resetDisplayConfig();
    setUserAge(25);
    setUserThemeSourceMode("doctor_tiles");
    setUserThemeTileId(1);
    setUserProfileVisibility("private");
    setUserShareAnonymizedInsights(true);
    setUserWeeklyDigestEnabled(true);
    setSettingsStatus("Pengaturan pengguna berhasil dikembalikan ke default.");
  };
  const sendAdminBroadcast = () => {
    const message = adminBroadcastMessage.trim();
    if (!message) {
      setManualStatus("Pesan broadcast tidak boleh kosong.");
      return;
    }
    const count = adminBroadcastTargets.length;
    const entry: AdminBroadcastLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      segment: adminBroadcastSegment,
      message,
      recipientCount: count,
      createdAt: Date.now(),
    };
    setAdminBroadcastLogs((prev) => [entry, ...prev].slice(0, 30));
    setAdminBroadcastMessage("");
    setManualStatus(`Broadcast tersimpan untuk ${count} pengguna (${adminBroadcastSegment}).`);
  };
  const playReminderSound = useCallback(() => {
    if (!reminderSoundEnabled) return;
    void (async () => {
      const played = await playDeviceAlarmTone(12000);
      if (!played && "vibrate" in navigator) {
        navigator.vibrate([180, 120, 240]);
      }
    })();
  }, [reminderSoundEnabled]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      fallbackRecorderRef.current?.stop();
      fallbackStreamRef.current?.getTracks().forEach((track) => track.stop());
      window.speechSynthesis?.cancel();
      void stopDeviceAlarmTone();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPhoneNow(new Date());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (userThemeSourceMode !== "doctor_tiles") {
      setUserThemeImageReady(false);
      return;
    }
    const image = new Image();
    image.onload = () => {
      setUserThemeImageReady(true);
    };
    image.onerror = () => {
      setUserThemeImageReady(false);
    };
    image.src = userThemeSpriteUrl;
  }, [userThemeSourceMode, userThemeSpriteUrl]);

  useEffect(() => {
    if (safeRole === "user" && userThemeSourceMode !== "doctor_tiles") {
      setUserThemeSourceMode("doctor_tiles");
    }
  }, [safeRole, userThemeSourceMode, setUserThemeSourceMode]);

  useEffect(() => {
    menuHistoryRef.current = [safeRole === "admin" ? "Dashboard Ringkas" : "Beranda"];
    setActiveMenu(safeRole === "admin" ? "Dashboard Ringkas" : "Beranda");
  }, [safeRole]);
  useEffect(() => {
    if (!sidebarMenu.includes(activeMenu)) {
      setActiveMenu(sidebarMenu[0]);
    }
  }, [activeMenu, sidebarMenu]);
  useEffect(() => {
    const stack = menuHistoryRef.current;
    if (stack[stack.length - 1] !== activeMenu) {
      stack.push(activeMenu);
      if (stack.length > 30) {
        stack.splice(0, stack.length - 30);
      }
    }
  }, [activeMenu]);

  useEffect(() => {
    if (!reminderEnabled) return;

    const checkReminder = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;

      if (`${hh}:${mm}` === reminderTime && lastReminderDate !== today) {
        const fireFallback = () => {
          playReminderSound();
          window.alert(effectiveReminderMessage);
          setReminderStatus(`Pengingat aktif pada ${reminderTime} (${today})`);
          setLastReminderDate(today);
        };

        if ("Notification" in window) {
          if (Notification.permission === "granted") {
            playReminderSound();
            new Notification("Pengingat Edukasi Kesehatan", { body: effectiveReminderMessage });
            setReminderStatus(`Notifikasi terkirim pada ${reminderTime} (${today})`);
            setLastReminderDate(today);
          } else if (Notification.permission === "default") {
            Notification.requestPermission().then((permission) => {
              if (permission === "granted") {
                playReminderSound();
                new Notification("Pengingat Edukasi Kesehatan", { body: effectiveReminderMessage });
                setReminderStatus(`Notifikasi terkirim pada ${reminderTime} (${today})`);
                setLastReminderDate(today);
              } else {
                fireFallback();
              }
            });
          } else {
            fireFallback();
          }
        } else {
          fireFallback();
        }
      }
    };

    checkReminder();
    const timer = window.setInterval(checkReminder, 30000);
    return () => window.clearInterval(timer);
  }, [
    effectiveReminderMessage,
    lastReminderDate,
    reminderEnabled,
    reminderTime,
    setLastReminderDate,
    playReminderSound,
  ]);

  useEffect(() => {
    if (!warningNotificationEnabled || activeAlerts.length === 0) return;

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;
    if (lastWarningDate === today) return;

    const notifyFallback = () => {
      playReminderSound();
      window.alert(`Peringatan kesehatan: ${warningBody}`);
      setLastWarningDate(today);
    };

    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        playReminderSound();
        new Notification("Peringatan Kesehatan", {
          body: warningBody,
        });
        setLastWarningDate(today);
      } else if (Notification.permission === "default") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            playReminderSound();
            new Notification("Peringatan Kesehatan", {
              body: warningBody,
            });
            setLastWarningDate(today);
          } else {
            notifyFallback();
          }
        });
      } else {
        notifyFallback();
      }
    } else {
      notifyFallback();
    }
  }, [activeAlerts, lastWarningDate, setLastWarningDate, warningBody, warningNotificationEnabled, playReminderSound]);

  useEffect(() => {
    if (!sleepScheduleEnabled) return;

    const shouldNotifyRest = sleepScheduleMetrics.inSleepWindow || sleepScheduleMetrics.overAwakeLimit;
    if (!shouldNotifyRest) {
      setSleepScheduleStatus(
        `Status oke. Jam HP ${sleepScheduleMetrics.nowLabel}, durasi jadwal tidur ${sleepScheduleMetrics.estimatedSleepHours} jam.`
      );
      return;
    }

    const reason = sleepScheduleMetrics.inSleepWindow ? "sleep-window" : "awake-limit";
    const stamp = `${sleepScheduleMetrics.reminderStampBase}-${reason}`;
    if (lastRestReminderStamp === stamp) return;

    const restBody = sleepScheduleMetrics.inSleepWindow
      ? `Sudah lewat jadwal tidur (${sleepStartTime}). Waktunya istirahat agar durasi tidur ${sleepScheduleMetrics.estimatedSleepHours} jam tetap tercapai.`
      : `Kamu sudah bangun ${sleepScheduleMetrics.awakeHours} jam (batas ${maxAwakeHours} jam). Istirahat dulu ya.`;

    const notifyFallback = () => {
      playReminderSound();
      window.alert(`Pengingat Istirahat: ${restBody}`);
      setSleepScheduleStatus(`Pengingat istirahat terkirim (${sleepScheduleMetrics.nowLabel}).`);
      setLastRestReminderStamp(stamp);
    };

    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        playReminderSound();
        new Notification("Waktunya Istirahat", { body: restBody });
        setSleepScheduleStatus(`Notifikasi istirahat terkirim (${sleepScheduleMetrics.nowLabel}).`);
        setLastRestReminderStamp(stamp);
      } else if (Notification.permission === "default") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            playReminderSound();
            new Notification("Waktunya Istirahat", { body: restBody });
            setSleepScheduleStatus(`Notifikasi istirahat terkirim (${sleepScheduleMetrics.nowLabel}).`);
            setLastRestReminderStamp(stamp);
          } else {
            notifyFallback();
          }
        });
      } else {
        notifyFallback();
      }
    } else {
      notifyFallback();
    }
  }, [
    lastRestReminderStamp,
    maxAwakeHours,
    playReminderSound,
    setLastRestReminderStamp,
    sleepScheduleEnabled,
    sleepScheduleMetrics.awakeHours,
    sleepScheduleMetrics.estimatedSleepHours,
    sleepScheduleMetrics.inSleepWindow,
    sleepScheduleMetrics.nowLabel,
    sleepScheduleMetrics.overAwakeLimit,
    sleepScheduleMetrics.reminderStampBase,
    sleepStartTime,
  ]);

  useEffect(() => {
    if (safeRole !== "user") return;
    if (!sleepScheduleEnabled || !sleepAutoSyncEnabled) return;
    if (sleepScheduleMetrics.inSleepWindow) return;
    if (sleepAutoSyncPendingRef.current) return;

    const syncDate = sleepScheduleMetrics.wakeDateKey;
    if (lastSleepAutoSyncDate === syncDate) return;
    if (sleepAutoSyncQueue.some((item) => item.dateKey === syncDate)) {
      setSleepAutoSyncStatus(`Menunggu online untuk sinkron tidur tanggal ${syncDate}.`);
      return;
    }

    const sleepHours = sleepScheduleMetrics.estimatedSleepHours;
    if (!Number.isFinite(sleepHours) || sleepHours <= 0) return;
    const meals = String(latest?.meals ?? "-");

    const enqueueSleepSync = () => {
      setSleepAutoSyncQueue((prev) => {
        if (prev.some((item) => item.dateKey === syncDate)) return prev;
        return [
          ...prev,
          {
            dateKey: syncDate,
            sleep: sleepHours,
            meals,
            createdAt: Date.now(),
          },
        ];
      });
      setSleepAutoSyncStatus(`Offline. Durasi tidur ${sleepHours} jam dimasukkan antrean sinkron.`);
    };

    if (!navigator.onLine) {
      enqueueSleepSync();
      return;
    }

    let cancelled = false;
    sleepAutoSyncPendingRef.current = true;

    void safeOnManualUserInput({
      sleep: sleepHours,
      meals,
      heartRate: Number(latest?.heartRate ?? 0),
      bloodPressure: String(latest?.bloodPressure ?? "0/0"),
    })
      .then(() => {
        if (cancelled) return;
        setLastSleepAutoSyncDate(syncDate);
        setSleepAutoSyncStatus(`Durasi tidur ${sleepHours} jam tersimpan otomatis (${syncDate}).`);
      })
      .catch(() => {
        if (cancelled) return;
        enqueueSleepSync();
      })
      .finally(() => {
        sleepAutoSyncPendingRef.current = false;
      });

    return () => {
      cancelled = true;
      sleepAutoSyncPendingRef.current = false;
    };
  }, [
    lastSleepAutoSyncDate,
    latest?.bloodPressure,
    latest?.heartRate,
    latest?.meals,
    safeOnManualUserInput,
    safeRole,
    setLastSleepAutoSyncDate,
    setSleepAutoSyncQueue,
    sleepAutoSyncEnabled,
    sleepAutoSyncQueue,
    sleepScheduleEnabled,
    sleepScheduleMetrics.estimatedSleepHours,
    sleepScheduleMetrics.inSleepWindow,
    sleepScheduleMetrics.wakeDateKey,
  ]);

  useEffect(() => {
    if (safeRole !== "user") return;
    if (!sleepAutoSyncEnabled || sleepAutoSyncQueue.length === 0) return;

    const flushQueue = async () => {
      if (!navigator.onLine || sleepQueueFlushPendingRef.current) return;
      sleepQueueFlushPendingRef.current = true;

      const pending = [...sleepAutoSyncQueue];
      const remaining: SleepAutoSyncQueueItem[] = [];

      for (const item of pending) {
        try {
          await safeOnManualUserInput({
            sleep: item.sleep,
            meals: item.meals,
            heartRate: Number(latest?.heartRate ?? 0),
            bloodPressure: String(latest?.bloodPressure ?? "0/0"),
          });
          setLastSleepAutoSyncDate(item.dateKey);
          setSleepAutoSyncStatus(`Sinkron antrean berhasil untuk tanggal ${item.dateKey}.`);
        } catch {
          remaining.push(item);
        }
      }

      if (remaining.length !== pending.length) {
        setSleepAutoSyncQueue(remaining);
      }
      if (remaining.length > 0) {
        setSleepAutoSyncStatus(`Masih ada ${remaining.length} data tidur menunggu koneksi stabil.`);
      }

      sleepQueueFlushPendingRef.current = false;
    };

    void flushQueue();
    window.addEventListener("online", flushQueue);
    return () => {
      window.removeEventListener("online", flushQueue);
    };
  }, [
    latest?.bloodPressure,
    latest?.heartRate,
    safeOnManualUserInput,
    safeRole,
    setLastSleepAutoSyncDate,
    setSleepAutoSyncQueue,
    sleepAutoSyncEnabled,
    sleepAutoSyncQueue,
  ]);

  const handleGoBack = () => {
    const stack = menuHistoryRef.current;
    if (stack.length > 1) {
      stack.pop();
      const previous = stack[stack.length - 1];
      if (previous && sidebarMenu.includes(previous)) {
        setActiveMenu(previous);
        return;
      }
    }

    if (activeMenu !== defaultMenu) {
      setActiveMenu(defaultMenu);
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };
  const focusManualFieldByMetric = useCallback((metric: "heartRate" | "bloodPressure" | "meals") => {
    if (metric === "heartRate") {
      manualHeartRateInputRef.current?.focus();
      return;
    }
    if (metric === "bloodPressure") {
      manualBloodPressureInputRef.current?.focus();
      return;
    }
    manualMealsInputRef.current?.focus();
  }, []);
  const openManualInputFromCard = useCallback(
    (metric: "heartRate" | "bloodPressure" | "meals") => {
      const latestHeartRate = Number(latest?.heartRate ?? 0);
      const latestBloodPressure = String(latest?.bloodPressure ?? "").trim();
      const latestMeals = String(latest?.meals ?? "").trim();

      if (metric === "heartRate" && latestHeartRate > 0) {
        setManualHeartRateInput(String(latestHeartRate));
      }
      if (metric === "bloodPressure" && latestBloodPressure && latestBloodPressure !== "0/0") {
        setManualBloodPressureInput(latestBloodPressure);
      }
      if (metric === "meals" && latestMeals && latestMeals !== "-") {
        setManualMealsInput(latestMeals);
      }

      setManualStatusTone("info");
      setManualStatus("Silakan lengkapi input manual lalu tekan Simpan Sinkronisasi.");
      manualInputSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.setTimeout(() => focusManualFieldByMetric(metric), 260);
    },
    [focusManualFieldByMetric, latest?.bloodPressure, latest?.heartRate, latest?.meals]
  );
  const handleSubmitManualSync = useCallback(async () => {
    const heartRate = Number.parseInt(manualHeartRateInput.trim(), 10);
    const bloodPressure = manualBloodPressureInput.trim();
    const meals = manualMealsInput.trim();
    const bloodPressurePattern = /^\d{2,3}\/\d{2,3}$/;

    if (!Number.isFinite(heartRate) || heartRate < 30 || heartRate > 220) {
      setManualStatusTone("error");
      setManualStatus("Detak jantung harus diisi angka 30-220 bpm.");
      manualHeartRateInputRef.current?.focus();
      return;
    }
    if (!bloodPressurePattern.test(bloodPressure)) {
      setManualStatusTone("error");
      setManualStatus("Tekanan darah wajib format sistolik/diastolik, contoh: 118/76.");
      manualBloodPressureInputRef.current?.focus();
      return;
    }
    if (!meals) {
      setManualStatusTone("error");
      setManualStatus("Pola makan tidak boleh kosong.");
      manualMealsInputRef.current?.focus();
      return;
    }

    try {
      await safeOnManualUserInput({
        sleep: Number(latest?.sleep ?? 0),
        meals,
        heartRate,
        bloodPressure,
      });
      setManualStatusTone("success");
      setManualStatus("Data detak jantung, tekanan darah, dan pola makan berhasil disinkronkan.");
      showToast("Sinkronisasi manual berhasil disimpan.", "success");
    } catch {
      setManualStatusTone("error");
      setManualStatus("Gagal menyimpan sinkronisasi manual. Coba ulangi beberapa saat lagi.");
    }
  }, [latest?.sleep, manualBloodPressureInput, manualHeartRateInput, manualMealsInput, safeOnManualUserInput, showToast]);
  const handleSyncGpsNow = () => {
    if (!safeGpsSyncStatus.isOnline) {
      showToast("GPS sedang offline. Nyalakan koneksi untuk sinkronisasi.", "error");
      return;
    }
    if (safeGpsSyncStatus.pendingSyncCount === 0) {
      showToast("Tidak ada antrean GPS untuk disinkronkan.", "info");
      return;
    }
    void safeOnRequestGpsSyncNow();
    showToast("Sinkronisasi GPS dimulai.", "info");
  };
  const handleClearGpsQueue = () => {
    const accepted = window.confirm("Kosongkan antrean sinkron GPS offline?");
    if (!accepted) return;
    safeOnClearGpsQueue();
    showToast("Antrean GPS offline berhasil dikosongkan.", "success");
  };
  const handleStartActivity = () => {
    safeOnStartActivitySession();
    showToast("Sesi aktivitas dimulai. Data aktivitas akan dicatat saat Anda bergerak.", "success");
  };
  const handleStopActivity = () => {
    safeOnStopActivitySession();
    showToast("Sesi aktivitas dihentikan.", "info");
  };

  const gpsLastSampleText =
    safeRole !== "user"
      ? "-"
      : safeGpsSyncStatus.lastSampleAtMs
        ? new Date(safeGpsSyncStatus.lastSampleAtMs).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "Belum ada";
  const gpsLastFlushText =
    safeRole !== "user"
      ? "-"
      : safeGpsSyncStatus.lastFlushAtMs
        ? new Date(safeGpsSyncStatus.lastFlushAtMs).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "Belum ada";
  const gpsFlushStatusText =
    safeGpsSyncStatus.lastFlushResult === "success"
      ? "Berhasil"
      : safeGpsSyncStatus.lastFlushResult === "error"
        ? "Gagal"
        : safeGpsSyncStatus.isFlushing
          ? "Menyinkronkan"
          : "Idle";
  const activitySessionStatusText = safeActivitySessionActive ? "Aktif" : "Belum Dimulai";
  const activitySessionSummaryText = safeActivitySessionSummary.steps > 0
    ? `${safeActivitySessionSummary.steps.toLocaleString("id-ID")} langkah • ${Math.round(
        safeActivitySessionSummary.distanceMeters
      ).toLocaleString("id-ID")} m • ${safeActivitySessionSummary.calories.toLocaleString("id-ID")} kkal`
    : "Belum ada langkah tercatat";
  const userPrimaryMobileNavItems = useMemo(
    () =>
      [
        { label: "Dasbor", menu: "Beranda", icon: "home" as NavIconName },
        { label: "Riwayat", menu: "Riwayat", icon: "history" as NavIconName },
        { label: "Analisis", menu: "Hasil Edukasi", icon: "education" as NavIconName },
        { label: "Peringatan", menu: "Peringatan Saya", icon: "alerts" as NavIconName },
        { label: "Profil", menu: "Pengaturan", icon: "settings" as NavIconName },
      ] as const,
    []
  );
  const adminPrimaryMobileNavItems = useMemo(
    () =>
      [
        { label: "Dasbor", menu: "Dashboard Ringkas", icon: "home" as NavIconName },
        { label: "Pasien", menu: "Manajemen Pengguna", icon: "data" as NavIconName },
        { label: "Input", menu: "Alert & Tindak Lanjut", icon: "alerts" as NavIconName },
        { label: "Laporan", menu: "Laporan & Ekspor", icon: "history" as NavIconName },
        { label: "Profil", menu: "Pengaturan Sistem", icon: "settings" as NavIconName },
      ] as const,
    []
  );
  const userMenuLabelMap: Record<string, string> = {
    Beranda: "Dasbor",
    "Hasil Edukasi": "Analisis",
    "Peringatan Saya": "Peringatan",
    Riwayat: "Riwayat",
    Pengaturan: "Pengaturan",
  };
  const adminMenuLabelMap: Record<string, string> = {
    "Dashboard Ringkas": "Dasbor",
    "Manajemen Pengguna": "Daftar Pasien",
    "Monitoring Risiko": "Analisis Risiko",
    "Alert & Tindak Lanjut": "Tindak Lanjut Pengukuran",
    "Konten Edukasi": "Edukasi",
    "Broadcast Notifikasi": "Notifikasi",
    "Timeline Tindak Lanjut": "Timeline",
    "Riwayat & Audit Log": "Riwayat",
    "Laporan & Ekspor": "Laporan & Ekspor",
    "Manajemen Role": "Hak Akses",
    "Pengaturan Sistem": "Profil Admin",
  };
  const getMenuLabel = (menu: string) => {
    if (safeRole === "admin") return adminMenuLabelMap[menu] ?? menu;
    return userMenuLabelMap[menu] ?? menu;
  };
  const getMenuIcon = (menu: string): NavIconName => {
    if (menu === "Beranda" || menu === "Dashboard Ringkas") return "home";
    if (menu === "Data Saya" || menu === "Manajemen Pengguna" || menu === "Monitoring Risiko") return "data";
    if (menu === "Hasil Edukasi" || menu === "Konten Edukasi") return "education";
    if (menu === "Peringatan Saya" || menu === "Alert & Tindak Lanjut" || menu === "Broadcast Notifikasi") return "alerts";
    if (menu === "Pengaturan" || menu === "Pengaturan Sistem" || menu === "Manajemen Role") return "settings";
    if (menu === "Riwayat" || menu === "Riwayat & Audit Log" || menu === "Laporan & Ekspor" || menu === "Timeline Tindak Lanjut") {
      return "history";
    }
    return "more";
  };
  const mobilePrimaryNavItems = useMemo(
    () => (safeRole === "admin" ? adminPrimaryMobileNavItems : userPrimaryMobileNavItems),
    [adminPrimaryMobileNavItems, safeRole, userPrimaryMobileNavItems]
  );
  const mobileDrawerMenuItems = useMemo(
    () => sidebarMenu.filter((menu) => !mobilePrimaryNavItems.some((item) => item.menu === menu)),
    [sidebarMenu, mobilePrimaryNavItems]
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeMenu]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!toastState) return;
    const timer = window.setTimeout(() => setToastState(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toastState]);

  return (
    <div
      className={`dashboard-shell dashboard-shell-safe dashboard-premium-v2 relative min-h-screen overflow-hidden ${shellSpacingClass} ${
        useOperationalLayout ? "dashboard-compact" : ""
      } ${
        safeRole === "user" && isUserImageThemeActive ? "dashboard-image-theme" : ""
      } ${themeClass} ${modeClass}`}
      style={{
        color: safeRole === "admin" ? "#0f172a" : isDark ? "#e2e8f0" : "#1e293b",
        background: safeRole === "user" && isUserImageThemeActive
          ? isDark
            ? `linear-gradient(160deg, rgba(11,18,32,0.75) 0%, rgba(15,27,51,0.72) 48%, rgba(16,26,44,0.76) 100%), url("${userThemeSpriteUrl}")`
            : `linear-gradient(165deg, rgba(243,247,251,0.72) 0%, rgba(248,250,252,0.7) 45%, rgba(238,245,247,0.74) 100%), url("${userThemeSpriteUrl}")`
          : interfaceMode === "admin_web"
            ? "radial-gradient(circle at 10% -5%, rgba(59,130,246,0.14), transparent 38%), radial-gradient(circle at 95% 12%, rgba(148,163,184,0.18), transparent 42%), linear-gradient(165deg, #f4f8fc 0%, #f8fafc 45%, #eef4fa 100%)"
            : interfaceMode === "admin_mobile"
              ? "radial-gradient(circle at 15% -10%, rgba(96,165,250,0.22), transparent 44%), radial-gradient(circle at 100% 15%, rgba(15,23,42,0.12), transparent 42%), linear-gradient(170deg, #eef4ff 0%, #f7faff 45%, #edf2ff 100%)"
              : interfaceMode === "user_web"
                ? "radial-gradient(circle at 10% -5%, rgba(217,170,72,0.18), transparent 40%), radial-gradient(circle at 90% 12%, rgba(56,189,248,0.12), transparent 38%), linear-gradient(165deg, #fffaf2 0%, #f8fbff 45%, #f4f8f7 100%)"
                : "radial-gradient(circle at 6% -8%, rgba(245,158,11,0.2), transparent 42%), radial-gradient(circle at 95% 8%, rgba(16,185,129,0.12), transparent 40%), linear-gradient(165deg, #fff7ea 0%, #fffdf8 45%, #f6faf8 100%)",
        backgroundSize: safeRole === "user" && isUserImageThemeActive ? `cover, 400% 300%` : undefined,
        backgroundPosition: safeRole === "user" && isUserImageThemeActive ? `center, ${activeUserThemeTile.backgroundPosition}` : undefined,
        backgroundRepeat: safeRole === "user" && isUserImageThemeActive ? "no-repeat, no-repeat" : undefined,
      }}
    >
      <div className="pointer-events-none absolute -left-16 -top-16 h-64 w-64 rounded-full bg-emerald-200/15 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-32 h-72 w-72 rounded-full bg-sky-200/15 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-white/20 via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.7)_1px,transparent_0)] [background-size:24px_24px]" />
      {toastState ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div
            className={`pointer-events-auto rounded-xl border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur-sm ${
              toastState.tone === "error"
                ? "border-rose-200 bg-rose-50/95 text-rose-700"
                : toastState.tone === "success"
                  ? "border-emerald-200 bg-emerald-50/95 text-emerald-700"
                  : "border-sky-200 bg-sky-50/95 text-sky-700"
            }`}
          >
            {toastState.message}
          </div>
        </div>
      ) : null}

      {showOnboarding ? (
        <div className="modal-enter fixed inset-0 z-50 bg-slate-900/45 p-4 sm:hidden">
          <div className="modal-enter absolute inset-x-4 bottom-4 rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
                  Onboarding {onboardingStep + 1}/{onboardingItems.length}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">{onboardingItems[onboardingStep].title}</h3>
                <p className="mt-2 text-sm text-slate-600">{onboardingItems[onboardingStep].detail}</p>
              </div>
              <button
                type="button"
                onClick={closeOnboarding}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600"
              >
                Lewati
              </button>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onboardingItems[onboardingStep].onAction}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {onboardingItems[onboardingStep].actionLabel}
              </button>
              <button
                type="button"
                onClick={nextOnboarding}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {onboardingStep >= onboardingItems.length - 1 ? "Selesai" : "Lanjut"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={`relative mx-auto w-full ${frameSpacingClass}`}>
        <section
          className={`dashboard-welcome-card ${welcomeSectionClass} shadow-[0_26px_80px_-38px_rgba(15,23,42,0.55)] backdrop-blur-lg ${
            isDark
              ? "border border-slate-600/70 bg-slate-900/78"
              : safeRole === "admin"
                ? interfaceMode === "admin_mobile"
                  ? "border border-blue-100/85 bg-gradient-to-r from-[#eef4ff]/95 to-white"
                  : "border border-white/80 bg-white/78"
                : interfaceMode === "user_mobile"
                  ? "border border-amber-100/80 bg-gradient-to-r from-[#fff7ea]/90 to-slate-50/95"
                  : "border border-amber-100/80 bg-gradient-to-r from-amber-50/65 to-slate-50/95"
          }`}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              {isMobileViewport ? (
                <div className="dashboard-mobile-topbar mb-3 flex items-center justify-between rounded-2xl border border-white/70 bg-white/85 px-3 py-2.5 shadow-[0_14px_28px_-20px_rgba(15,23,42,0.5)]">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">SehatAI</p>
                    <p className="text-sm font-semibold text-slate-900">
                      {safeRole === "admin" ? "SehatAI Admin" : "SehatAI Pengguna"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                      {renderNavIcon("alerts")}
                    </span>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xs font-semibold text-slate-700">
                      {safeUserDisplayName.slice(0, 1).toUpperCase() || "U"}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="dashboard-mode-chip mb-2 inline-flex items-center gap-2 rounded-full border border-slate-200/85 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                <span>{interfaceProfile.label}</span>
                <span className="h-1 w-1 rounded-full bg-slate-400" />
                <span>{safeRole === "admin" ? "Operasional" : "Personal"}</span>
              </div>
              <h1
                className={`text-2xl font-semibold tracking-tight [font-family:var(--font-display)] sm:text-4xl ${
                  isDark ? "text-slate-100" : "text-slate-900"
                }`}
              >
                {isAdminMobileMode || isUserMobileMode
                  ? `Halo ${safeUserDisplayName || (safeRole === "admin" ? "Admin" : "Pengguna")}`
                  : `Selamat Datang${safeUserDisplayName ? `, ${safeUserDisplayName}` : ""}`}
              </h1>
              <p
                className={`dashboard-mode-summary mt-2 max-w-2xl text-sm leading-relaxed sm:text-base ${
                  isDark ? "text-slate-300" : "text-slate-600"
                }`}
              >
                {interfaceProfile.summary}
              </p>
            </div>
            <div className="w-full lg:w-auto lg:max-w-3xl">
              {safeRole === "user" ? (
                isUserMobileMode ? (
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <div className="dashboard-status-pill min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-slate-700 shadow-sm">
                      Risiko: <span className={`font-semibold ${riskColor}`}>{riskLevel}</span>
                    </div>
                    <div
                      className={`dashboard-status-pill min-w-0 rounded-xl border px-3 py-1.5 text-[11px] font-medium leading-4 shadow-sm ${
                        safeGpsSyncStatus.lastFlushResult === "error"
                          ? "border-rose-200/90 bg-rose-50/95 text-rose-700"
                          : safeGpsSyncStatus.lastFlushResult === "success"
                            ? "border-emerald-200/90 bg-emerald-50/95 text-emerald-700"
                            : "border-slate-200/80 bg-white/90 text-slate-700"
                      }`}
                    >
                      Sinkron: {gpsFlushStatusText}
                    </div>
                  </div>
                ) : (
                  <div className="mb-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                    <div className="dashboard-status-pill min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-slate-700 shadow-sm sm:rounded-full sm:text-xs">
                      GPS: {safeGpsSyncStatus.isOnline ? "Online" : "Offline"}
                    </div>
                    <div className="dashboard-status-pill min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-slate-700 shadow-sm sm:rounded-full sm:text-xs">
                      Antrean sinkron: {safeGpsSyncStatus.pendingSyncCount}
                    </div>
                    <div className="dashboard-status-pill col-span-2 hidden min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-slate-700 shadow-sm sm:col-span-1 sm:block sm:rounded-full sm:text-xs">
                      Sampel terakhir: {gpsLastSampleText}
                    </div>
                    <div className="dashboard-status-pill col-span-2 hidden min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-slate-700 shadow-sm sm:col-span-1 sm:block sm:rounded-full sm:text-xs">
                      Sinkron terakhir: {gpsLastFlushText}
                    </div>
                    <div className="dashboard-status-pill hidden min-w-0 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[11px] font-medium leading-4 text-slate-700 shadow-sm sm:block sm:rounded-full sm:text-xs">
                      Item tersinkron: {safeGpsSyncStatus.lastFlushedCount}
                    </div>
                    <div
                      className={`dashboard-status-pill col-span-2 min-w-0 rounded-xl border px-3 py-1.5 text-[11px] font-medium leading-4 shadow-sm sm:col-span-1 sm:rounded-full sm:text-xs ${
                        safeGpsSyncStatus.lastFlushResult === "error"
                          ? "border-rose-200/90 bg-rose-50/95 text-rose-700"
                          : safeGpsSyncStatus.lastFlushResult === "success"
                            ? "border-emerald-200/90 bg-emerald-50/95 text-emerald-700"
                            : "border-slate-200/80 bg-white/90 text-slate-700"
                      }`}
                      title={safeGpsSyncStatus.lastFlushError ?? undefined}
                    >
                      Status sinkron: {gpsFlushStatusText}
                    </div>
                  </div>
                )
              ) : null}
              {safeRole === "user" ? (
                <div
                  className={`mb-2 rounded-xl border px-3 py-2 text-xs ${
                    safeActivitySessionActive
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200/80 bg-white/90 text-slate-700"
                  }`}
                >
                  Aktivitas: <span className="font-semibold">{activitySessionStatusText}</span> • {activitySessionSummaryText}
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
                {isMobileViewport && mobileDrawerMenuItems.length > 0 ? (
                  <button
                    onClick={() => setMobileMenuOpen(true)}
                    className="dashboard-action-btn inline-flex items-center justify-center gap-1 rounded-full border border-slate-200/80 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-lg lg:hidden"
                  >
                    {renderNavIcon("more")}
                    {safeRole === "admin" ? "Menu Admin" : "Menu Pengguna"}
                  </button>
                ) : null}
                {!isAdminMobileMode ? (
                  <button
                    onClick={handleGoBack}
                    className="dashboard-action-btn inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-lg"
                  >
                    Kembali
                  </button>
                ) : null}
                {!isAdminMobileMode ? (
                  <button
                    onClick={handleRefresh}
                    className="dashboard-action-btn inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-lg"
                  >
                    Muat Ulang
                  </button>
                ) : null}
                {safeRole === "user" ? (
                  <button
                    onClick={safeActivitySessionActive ? handleStopActivity : handleStartActivity}
                    className={`dashboard-action-btn inline-flex items-center justify-center rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${
                      safeActivitySessionActive
                        ? "border-rose-200/90 bg-rose-50/95 text-rose-700 hover:bg-rose-100"
                        : "border-emerald-200/90 bg-emerald-50/95 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {safeActivitySessionActive ? "Selesai Aktivitas" : "Mulai Aktivitas"}
                  </button>
                ) : null}
                {safeRole === "user" ? (
                  <button
                    onClick={handleSyncGpsNow}
                    disabled={!safeGpsSyncStatus.isOnline || safeGpsSyncStatus.pendingSyncCount === 0 || safeGpsSyncStatus.isFlushing}
                    className="dashboard-action-btn dashboard-action-btn-primary inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {safeGpsSyncStatus.isFlushing ? "Sinkronisasi..." : "Sinkronkan GPS"}
                  </button>
                ) : null}
                {safeRole === "user" && !isUserMobileMode ? (
                  <button
                    onClick={handleClearGpsQueue}
                    disabled={safeGpsSyncStatus.pendingSyncCount === 0 || safeGpsSyncStatus.isFlushing}
                    className="dashboard-action-btn dashboard-action-btn-danger col-span-2 inline-flex items-center justify-center rounded-full border border-rose-200/90 bg-rose-50/95 px-4 py-2 text-sm font-medium text-rose-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-rose-100 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-1"
                  >
                    Kosongkan Antrean
                  </button>
                ) : null}
                <button
                  onClick={onSignOut}
                  className="dashboard-action-btn inline-flex items-center justify-center rounded-full border border-slate-200/80 bg-white/90 px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white hover:shadow-lg"
                >
                  Keluar
                </button>
              </div>
            </div>
          </div>
        </section>

        {commOpen ? (
          <section
            ref={commSectionRef}
            className={`soft-fade-enter ${commSectionClass} border border-slate-200/80 bg-white/95 shadow-[0_26px_70px_-35px_rgba(15,23,42,0.58)] backdrop-blur-sm`}
          >
            <div className="mx-auto max-w-3xl">
              <h2 className="text-xl font-semibold text-slate-900 [font-family:var(--font-display)]">
                Mode Mikrofon
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {IS_AI_PROXY_ENABLED
                  ? "Bicara lewat mic atau ketik pesan, lalu sistem memberi Ringkasan AI Kesehatan dan dibacakan suara."
                  : "Mode gratis aktif: komunikasi AI dimatikan agar aplikasi tetap gratis tanpa backend berbayar."}
              </p>

              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Contoh: Tolong evaluasi kondisi saya dari data kesehatan hari ini"
                disabled={!IS_AI_PROXY_ENABLED}
                className="mt-4 h-28 w-full rounded-2xl border border-slate-200 p-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              />

              <div className="mt-3 flex gap-2">
                <button
                  onClick={toggleMic}
                  disabled={thinking || !IS_AI_PROXY_ENABLED}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-60"
                >
                  {listening ? "Stop Mic" : "Nyalakan Mic"}
                </button>
                <button
                  onClick={handleCommunicate}
                  disabled={thinking || !IS_AI_PROXY_ENABLED}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {thinking ? "Mengirim..." : "Kirim ke Edukasi"}
                </button>
              </div>

              {commError ? <p className="mt-3 text-sm text-rose-600">{commError}</p> : null}

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Ringkasan Rekomendasi Dokter</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                  {commReply || "Hasil komunikasi mikrofon + chat akan tampil di sini."}
                </p>
              </div>

              {latest ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Konteks data aktif: langkah {latest.steps}, tidur {latest.sleep} jam, detak {latest.heartRate} bpm.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        <section
          className={`dashboard-main-shell ${contentSectionClass} shadow-[0_20px_60px_-35px_rgba(15,23,42,0.35)] ${
            isDark
              ? "border border-slate-700 bg-slate-900/80"
              : isUserImageThemeActive
                ? "border border-cyan-200/45 bg-white/12 backdrop-blur-sm"
                : "border border-slate-200 bg-white"
          }`}
        >
          <div
            className={`overflow-hidden rounded-3xl ${
              isDark
                ? "border border-slate-700 bg-slate-800"
                : isUserImageThemeActive
                  ? "border border-cyan-200/40 bg-white/10"
                  : "border border-slate-200 bg-slate-100"
            }`}
          >
            <div className={layoutGridClass}>
              <aside
                className={`dashboard-nav-panel p-5 text-white ${isMobileViewport ? "hidden lg:block" : ""}`}
                style={{
                  background:
                    safeRole === "admin"
                      ? "linear-gradient(180deg, #2f548f 0%, #1f3f73 100%)"
                      : isUserImageThemeActive
                        ? "linear-gradient(180deg, rgba(10,43,97,0.62) 0%, rgba(9,34,78,0.58) 100%)"
                        : "linear-gradient(180deg, #1a2642 0%, #111b33 100%)",
                }}
              >
                <div className="mb-8">
                  <div className="mb-3 flex items-center gap-3">
                    <img
                      src={HEALTH_LOGO}
                      alt="Logo Health Edukasi"
                      className="h-10 w-10 rounded-xl border border-white/30 bg-white/10 object-cover"
                    />
                    <span
                    className={`text-sm font-semibold ${
                        safeRole === "admin" ? "text-white" : isUserImageThemeActive ? "text-cyan-100" : "text-slate-100"
                      }`}
                    >
                      {safeRole === "admin" ? "Health Edukasi" : "Health Personal"}
                    </span>
                  </div>
                  <p
                    className={`text-xs uppercase tracking-[0.2em] ${
                      safeRole === "admin" ? "text-slate-100" : isUserImageThemeActive ? "text-cyan-100" : "text-slate-200"
                    }`}
                  >
                    {safeRole === "admin" ? "Ringkasan AI Kesehatan" : "Area Pengguna"}
                  </p>
                  <h3 className="mt-1 text-xl font-semibold">{safeRole === "admin" ? "Health Monitor" : "Kesehatan Saya"}</h3>
                  <p
                    className={`mt-1 text-xs ${
                      safeRole === "admin" ? "text-slate-100/90" : isUserImageThemeActive ? "text-cyan-100/90" : "text-slate-200/90"
                    }`}
                  >
                    Mode:{" "}
                    {safeRole === "admin"
                      ? `Admin ${isMobileViewport ? "Mobile" : "Web"} (${currentAdminRole === "super_admin" ? "Super Admin" : "Operator"})`
                      : `User ${isMobileViewport ? "Mobile" : "Web"}`}
                  </p>
                </div>
                <nav className="stagger-children space-y-2 text-sm">
                  {safeRole === "admin"
                    ? adminMenuGroups.map((group) => (
                        <div key={group.title} className="mb-3 last:mb-0">
                          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-100/80">
                            {group.title}
                          </p>
                          <div className="space-y-2">
                            {group.items.map((item) => (
                              <button
                                key={getMenuLabel(item)}
                                onClick={() => setActiveMenu(item)}
                                className={`dashboard-nav-btn menu-item stagger-item w-full rounded-xl px-3 py-2 text-left ${
                                  activeMenu === item
                                    ? "menu-item-active font-medium text-white"
                                    : "text-slate-800 hover:bg-white/35 hover:text-slate-900"
                                }`}
                                style={activeMenu === item ? { backgroundColor: "rgba(96, 143, 214, 0.42)" } : undefined}
                              >
                                {getMenuLabel(item)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    : sidebarMenu.map((item) => (
                        <button
                          key={getMenuLabel(item)}
                          onClick={() => setActiveMenu(item)}
                          className={`dashboard-nav-btn menu-item stagger-item w-full rounded-xl px-3 py-2 text-left ${
                            activeMenu === item
                              ? "menu-item-active font-medium text-white"
                              : isUserImageThemeActive
                                ? "text-cyan-100 hover:bg-white/15 hover:text-white"
                                : "text-slate-200 hover:bg-white/15 hover:text-white"
                          }`}
                          style={
                            activeMenu === item
                              ? isUserImageThemeActive
                                ? { backgroundColor: "rgba(186,230,253,0.24)" }
                                : { backgroundColor: "rgba(217,170,72,0.22)" }
                              : undefined
                          }
                        >
                          {getMenuLabel(item)}
                        </button>
                      ))}
                  {safeRole === "user" ? (
                    <button
                      onClick={openCommunication}
                      className="dashboard-nav-btn menu-item stagger-item w-full rounded-xl bg-white/20 px-3 py-2 text-left font-medium text-white hover:bg-white/30"
                    >
                      Ringkasan AI Kesehatan
                    </button>
                  ) : null}
                </nav>
                {safeRole === "user" ? (
                  <div
                    className={`mt-4 w-full rounded-2xl border border-white/20 bg-white/10 p-3 text-left text-sm ${
                      isUserImageThemeActive ? "text-cyan-50" : "text-slate-100"
                    }`}
                  >
                    {aiInsightPreview}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-3 text-left">
                    <p className="text-xs uppercase tracking-wide text-blue-100">Operasional</p>
                    <p className="mt-1 text-sm font-semibold text-white">SLA Tindak Lanjut: {adminCompletionRate}%</p>
                    <p className="mt-1 text-xs text-blue-100/90">
                      {adminAlerts.filter((item) => item.status !== "selesai").length} peringatan masih terbuka.
                    </p>
                  </div>
                )}
              </aside>

              <div
                className={`p-4 sm:p-5 ${
                  isDark
                    ? "bg-slate-950/40"
                    : safeRole === "admin"
                      ? "bg-[#f3f5fb]"
                      : isUserImageThemeActive
                        ? "bg-white/[0.03]"
                        : "bg-gradient-to-b from-emerald-50/45 to-white"
                }`}
              >
                <div key={`${interfaceMode}-${activeMenu}`} className="dashboard-page-enter">
                {isOverview ? (
                  <div className={overviewLayoutClass}>
                    <div className="space-y-4">
                      <div
                        className={`rounded-2xl p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm ${
                          safeRole === "admin"
                            ? "border border-slate-200/80 bg-white/95"
                            : isUserImageThemeActive
                              ? "relative overflow-hidden border border-cyan-100/45 bg-white/16 text-cyan-50 shadow-[0_12px_30px_-24px_rgba(14,165,233,0.7)]"
                              : "border border-emerald-100 bg-gradient-to-r from-white to-emerald-50/80"
                        }`}
                      >
                        {safeRole === "user" && isUserImageThemeActive ? (
                          <>
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(255,255,255,0.23),transparent_40%),radial-gradient(circle_at_100%_100%,rgba(125,211,252,0.2),transparent_32%)]" />
                            <div className="relative">
                              <h2 className="text-3xl font-semibold leading-tight text-cyan-50 sm:text-4xl lg:text-5xl">Ringkasan Kesehatan</h2>
                              <p className="mt-2 text-base text-cyan-100/95 sm:text-xl lg:text-2xl">
                                Ringkasan kesehatan pribadi berdasarkan data terbaru Anda.
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <h2 className="text-xl font-semibold text-slate-900">
                              {safeRole === "admin"
                                ? "Dasbor Web Admin"
                                : interfaceMode === "user_web"
                                  ? "Dasbor Web Pengguna"
                                  : "Ringkasan Kesehatan"}
                            </h2>
                            <p className="text-sm text-slate-500">
                              {safeRole === "admin"
                                ? "Desain modern dan intuitif untuk pemantauan data pasien serta analitik kesehatan."
                                : "Antarmuka manajemen kesehatan yang intuitif untuk memantau progres kesehatan pribadi secara efisien."}
                            </p>
                          </>
                        )}
                      </div>
                      {safeRole === "user" && !latest ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          Data kesehatan terbaru belum tersedia, sehingga metrik masih 0. Silakan lakukan pengukuran melalui menu{" "}
                          <button
                            type="button"
                            onClick={() => setActiveMenu("Beranda")}
                            className="font-semibold underline underline-offset-2"
                          >
                            Dasbor
                          </button>
                          .
                        </div>
                      ) : null}
                      <div className={overviewCardGridClass}>
                        {displayedOverviewCards.map((card) => {
                          const manualTargetMetric =
                            card.title === "Detak Jantung"
                              ? ("heartRate" as const)
                              : card.title === "Tekanan Darah"
                                ? ("bloodPressure" as const)
                                : card.title === "Pola Makan"
                                  ? ("meals" as const)
                                  : null;

                          if (safeRole === "user" && manualTargetMetric) {
                            return (
                              <button
                                key={card.title}
                                type="button"
                                onClick={() => openManualInputFromCard(manualTargetMetric)}
                                className="stagger-item group block rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
                                title={`Klik untuk input manual ${card.title.toLowerCase()}`}
                              >
                                <div className="transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg">
                                  <RingStatCard
                                    title={card.title}
                                    value={card.value}
                                    caption={`${card.caption} • Klik untuk sinkron`}
                                    percent={card.percent}
                                    color={card.color}
                                    variant={safeRole === "user" && isUserImageThemeActive ? "glass" : "default"}
                                  />
                                </div>
                              </button>
                            );
                          }

                          return (
                            <div key={card.title} className="stagger-item">
                              <RingStatCard
                                title={card.title}
                                value={card.value}
                                caption={card.caption}
                                percent={card.percent}
                                color={card.color}
                                variant={safeRole === "user" && isUserImageThemeActive ? "glass" : "default"}
                              />
                            </div>
                          );
                        })}
                      </div>
                      {safeRole === "user" ? (
                        <div
                          ref={manualInputSectionRef}
                          className={`rounded-2xl border p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm ${
                            isUserImageThemeActive
                              ? "border-cyan-100/45 bg-white/16 text-cyan-50"
                              : "border-cyan-100 bg-gradient-to-r from-white to-cyan-50/70"
                          }`}
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <h3 className={`text-lg font-semibold ${isUserImageThemeActive ? "text-cyan-50" : "text-slate-900"}`}>
                              Sinkronisasi Input Manual
                            </h3>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                                isUserImageThemeActive
                                  ? "border-cyan-100/45 bg-cyan-100/20 text-cyan-50"
                                  : "border-cyan-200 bg-cyan-50 text-cyan-700"
                              }`}
                            >
                              Khusus Detak, Tekanan, Pola Makan
                            </span>
                          </div>
                          <p className={`text-sm ${isUserImageThemeActive ? "text-cyan-100/90" : "text-slate-600"}`}>
                            Klik kartu metrik di atas untuk langsung diarahkan ke kolom input terkait, lalu simpan agar analisis edukasi tetap
                            konsisten.
                          </p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="text-sm">
                              <span className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isUserImageThemeActive ? "text-cyan-100/85" : "text-slate-500"}`}>
                                Detak Jantung (bpm)
                              </span>
                              <input
                                ref={manualHeartRateInputRef}
                                type="number"
                                min={30}
                                max={220}
                                inputMode="numeric"
                                value={manualHeartRateInput}
                                onChange={(event) => setManualHeartRateInput(event.target.value)}
                                placeholder="Contoh: 78"
                                className={`w-full rounded-xl border px-3 py-2 text-sm ${
                                  isUserImageThemeActive
                                    ? "border-cyan-100/45 bg-white/10 text-cyan-50 placeholder:text-cyan-100/65"
                                    : "border-slate-200 bg-white text-slate-700"
                                }`}
                              />
                            </label>
                            <label className="text-sm">
                              <span className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isUserImageThemeActive ? "text-cyan-100/85" : "text-slate-500"}`}>
                                Tekanan Darah
                              </span>
                              <input
                                ref={manualBloodPressureInputRef}
                                type="text"
                                value={manualBloodPressureInput}
                                onChange={(event) => setManualBloodPressureInput(event.target.value.replace(/\s+/g, ""))}
                                placeholder="Contoh: 118/76"
                                className={`w-full rounded-xl border px-3 py-2 text-sm ${
                                  isUserImageThemeActive
                                    ? "border-cyan-100/45 bg-white/10 text-cyan-50 placeholder:text-cyan-100/65"
                                    : "border-slate-200 bg-white text-slate-700"
                                }`}
                              />
                            </label>
                            <label className="text-sm sm:col-span-2">
                              <span className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${isUserImageThemeActive ? "text-cyan-100/85" : "text-slate-500"}`}>
                                Pola Makan
                              </span>
                              <textarea
                                ref={manualMealsInputRef}
                                rows={3}
                                value={manualMealsInput}
                                onChange={(event) => setManualMealsInput(event.target.value)}
                                placeholder="Contoh: karbo:2,protein:2,sayur:3,buah:2,air:8"
                                className={`w-full rounded-xl border px-3 py-2 text-sm ${
                                  isUserImageThemeActive
                                    ? "border-cyan-100/45 bg-white/10 text-cyan-50 placeholder:text-cyan-100/65"
                                    : "border-slate-200 bg-white text-slate-700"
                                }`}
                              />
                            </label>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void handleSubmitManualSync()}
                              className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                                isUserImageThemeActive
                                  ? "border border-cyan-100/45 bg-cyan-200/20 text-cyan-50"
                                  : "bg-cyan-600 text-white"
                              }`}
                            >
                              Simpan Sinkronisasi
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setManualHeartRateInput(latest?.heartRate && latest.heartRate > 0 ? String(latest.heartRate) : "");
                                const bp = String(latest?.bloodPressure ?? "").trim();
                                const meals = String(latest?.meals ?? "").trim();
                                setManualBloodPressureInput(bp && bp !== "0/0" ? bp : "");
                                setManualMealsInput(meals && meals !== "-" ? meals : "");
                                setManualStatusTone("info");
                                setManualStatus("Form dikembalikan ke data terbaru.");
                              }}
                              className={`rounded-xl border px-4 py-2 text-sm font-semibold ${
                                isUserImageThemeActive
                                  ? "border-cyan-100/45 bg-white/10 text-cyan-50"
                                  : "border-slate-300 bg-white text-slate-700"
                              }`}
                            >
                              Ambil Data Terbaru
                            </button>
                          </div>
                          {manualStatus ? (
                            <p
                              className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                                manualStatusTone === "error"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : manualStatusTone === "success"
                                    ? isUserImageThemeActive
                                      ? "border-emerald-200/60 bg-emerald-200/20 text-emerald-50"
                                      : "border-emerald-100 bg-emerald-50/60 text-emerald-800"
                                    : isUserImageThemeActive
                                      ? "border-cyan-100/50 bg-cyan-100/20 text-cyan-50"
                                      : "border-sky-200 bg-sky-50 text-sky-700"
                              }`}
                            >
                              {manualStatus}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                    </div>

                    <div className="space-y-4">
                      <div
                        className={`rounded-2xl p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm ${
                          safeRole === "user" && isUserImageThemeActive
                            ? "border border-cyan-100/40 bg-white/14 text-cyan-50"
                            : "border border-slate-200/80 bg-white/95"
                        }`}
                      >
                        <h4 className={`text-lg font-semibold ${safeRole === "user" && isUserImageThemeActive ? "text-cyan-50" : "text-slate-900"}`}>
                          {safeRole === "admin" ? "Daftar Pasien" : isUserMobileMode ? "Ringkasan Harian" : "Ringkasan Metrik Kesehatan"}
                        </h4>
                        <p className={`mb-2 text-sm ${safeRole === "user" && isUserImageThemeActive ? "text-cyan-100/90" : "text-slate-500"}`}>
                          {safeRole === "admin"
                            ? "Status normal dan perlu perhatian dari data terbaru."
                            : isUserMobileMode
                              ? "Pantau indikator terpenting sebelum pengukuran kesehatan berikutnya."
                              : "Indikator visual utama untuk menjaga konsistensi kesehatan harian."}
                        </p>
                        {safeRole === "admin" ? (
                          <div className="rounded-xl border border-slate-200 bg-white">
                            <div className="border-b border-slate-200 px-3 py-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Daftar Pasien Terbaru</p>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {adminPatientPreviewRows.map((item) => (
                                <div key={`${item.ownerEmail}-${item.pulse}`} className="flex items-center justify-between px-3 py-2.5">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-slate-800">{item.ownerEmail}</p>
                                    <p className="text-xs text-slate-500">Detak: {item.pulse}</p>
                                  </div>
                                  <span
                                    className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                                      item.statusTone === "warning"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700"
                                    }`}
                                  >
                                    {item.status}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`overflow-x-auto rounded-xl ${
                              safeRole === "user" && isUserImageThemeActive ? "border border-cyan-100/35 bg-white/8" : "border border-slate-200"
                            }`}
                          >
                            <table className="min-w-full text-sm">
                              <thead
                                className={`text-left text-xs uppercase tracking-wide ${
                                  safeRole === "user" && isUserImageThemeActive ? "bg-white/10 text-cyan-100/85" : "bg-slate-50 text-slate-500"
                                }`}
                              >
                                <tr>
                                  <th className="px-3 py-2">Metrik</th>
                                  <th className="px-3 py-2">Nilai</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[
                                  { label: "Rata-rata tidur", value: `${avgSleep} jam` },
                                  { label: "Langkah 7 hari", value: weeklySteps.toLocaleString("id-ID") },
                                  { label: "Detak terbaru", value: `${latest?.heartRate ?? 0} bpm` },
                                  { label: "Tekanan darah", value: latest?.bloodPressure ?? "0/0" },
                                  { label: "Pola makan", value: latestMealsDisplay },
                                ].map((item) => (
                                  <tr
                                    key={item.label}
                                    className={`border-t ${
                                      safeRole === "user" && isUserImageThemeActive
                                        ? "border-cyan-100/20 text-cyan-50"
                                        : "border-slate-100 text-slate-700"
                                    }`}
                                  >
                                    <td className={`px-3 py-2 ${safeRole === "user" && isUserImageThemeActive ? "text-cyan-100/85" : "text-slate-500"}`}>
                                      {item.label}
                                    </td>
                                    <td className={`px-3 py-2 font-medium ${safeRole === "user" && isUserImageThemeActive ? "text-cyan-50" : "text-slate-800"}`}>
                                      {item.value}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {safeRole === "user" ? (
                          <div
                            className={`mt-3 rounded-xl px-3 py-2 text-xs ${
                              isUserImageThemeActive
                                ? "border border-cyan-100/45 bg-cyan-100/12 text-cyan-50"
                                : "border border-emerald-200 bg-emerald-50/70 text-emerald-800"
                            }`}
                          >
                            Fokus hari ini: {userDailyFocusMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : isManualInputPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-white to-emerald-50/80 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Data Pengukuran</h2>
                      <p className="text-sm text-slate-500">
                        Rekap sinkron data 7 hari dan 30 hari berdasarkan data yang masuk ke dashboard.
                      </p>
                    </div>

                    <div className="grid gap-4">
                      <div className="rounded-2xl border border-emerald-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-slate-900">Tabel Mingguan (7 Hari)</h3>
                            <p className="text-xs text-slate-500">
                              Total langkah: {personalDataTables.weekStepsTotal.toLocaleString("id-ID")} | Rata-rata tidur:{" "}
                              {personalDataTables.weekSleepAvg} jam
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <button
                              type="button"
                              onClick={() => exportPersonalRecords("week")}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap"
                            >
                              Simpan Excel
                            </button>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                                personalDataTables.weeklyLifestyle.label === "Bagus"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {personalDataTables.weeklyLifestyle.label}
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{personalDataTables.weeklyLifestyle.note}</p>
                        <div className="mt-3 overflow-x-auto rounded-xl border border-emerald-100">
                          <table className="min-w-[760px] sm:min-w-[980px] text-sm">
                            <thead className="bg-emerald-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-3 py-2">Hari</th>
                                <th className="px-3 py-2">Tanggal</th>
                                <th className="px-3 py-2">Jam</th>
                                <th className="px-3 py-2">Langkah</th>
                                <th className="px-3 py-2">Tinggi</th>
                                <th className="px-3 py-2">Berat</th>
                                <th className="px-3 py-2">Tidur</th>
                                <th className="px-3 py-2">Detak</th>
                                <th className="px-3 py-2">Darah</th>
                                <th className="px-3 py-2">Kalori</th>
                                <th className="px-3 py-2">Makan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {personalDataTables.weekRecords.length > 0 ? (
                                personalDataTables.weekRecords.map((row) => (
                                  <tr key={row.id} className="border-t border-slate-100 text-slate-700">
                                    <td className="px-3 py-2">{row.dayLabel}</td>
                                    <td className="px-3 py-2">{row.dateLabel}</td>
                                    <td className="px-3 py-2">{row.timeLabel}</td>
                                    <td className="px-3 py-2">{row.steps.toLocaleString("id-ID")}</td>
                                    <td className="px-3 py-2">{row.height} cm</td>
                                    <td className="px-3 py-2">{row.weight} kg</td>
                                    <td className="px-3 py-2">{row.sleep} jam</td>
                                    <td className="px-3 py-2">{row.heartRate} bpm</td>
                                    <td className="px-3 py-2">{row.bloodPressure}</td>
                                    <td className="px-3 py-2">{row.calories.toLocaleString("id-ID")}</td>
                                    <td className="px-3 py-2">{formatMealsDisplay(row.meals)}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={11} className="px-3 py-4 text-center text-slate-500">
                                    Belum ada data 7 hari terakhir.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-emerald-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <h3 className="text-lg font-semibold text-slate-900">Tabel Bulanan (30 Hari)</h3>
                            <p className="text-xs text-slate-500">
                              Total langkah: {personalDataTables.monthStepsTotal.toLocaleString("id-ID")} | Rata-rata tidur:{" "}
                              {personalDataTables.monthSleepAvg} jam
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                            <button
                              type="button"
                              onClick={() => exportPersonalRecords("month")}
                              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap"
                            >
                              Simpan Excel
                            </button>
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${
                                personalDataTables.monthlyLifestyle.label === "Bagus"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-rose-100 text-rose-700"
                              }`}
                            >
                              {personalDataTables.monthlyLifestyle.label}
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{personalDataTables.monthlyLifestyle.note}</p>
                        <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-emerald-100">
                          <table className="min-w-[760px] sm:min-w-[980px] text-sm">
                            <thead className="sticky top-0 bg-emerald-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                              <tr>
                                <th className="px-3 py-2">Hari</th>
                                <th className="px-3 py-2">Tanggal</th>
                                <th className="px-3 py-2">Jam</th>
                                <th className="px-3 py-2">Langkah</th>
                                <th className="px-3 py-2">Tinggi</th>
                                <th className="px-3 py-2">Berat</th>
                                <th className="px-3 py-2">Tidur</th>
                                <th className="px-3 py-2">Detak</th>
                                <th className="px-3 py-2">Darah</th>
                                <th className="px-3 py-2">Kalori</th>
                                <th className="px-3 py-2">Makan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {personalDataTables.monthRecords.length > 0 ? (
                                personalDataTables.monthRecords.map((row) => (
                                  <tr key={row.id} className="border-t border-slate-100 text-slate-700">
                                    <td className="px-3 py-2">{row.dayLabel}</td>
                                    <td className="px-3 py-2">{row.dateLabel}</td>
                                    <td className="px-3 py-2">{row.timeLabel}</td>
                                    <td className="px-3 py-2">{row.steps.toLocaleString("id-ID")}</td>
                                    <td className="px-3 py-2">{row.height} cm</td>
                                    <td className="px-3 py-2">{row.weight} kg</td>
                                    <td className="px-3 py-2">{row.sleep} jam</td>
                                    <td className="px-3 py-2">{row.heartRate} bpm</td>
                                    <td className="px-3 py-2">{row.bloodPressure}</td>
                                    <td className="px-3 py-2">{row.calories.toLocaleString("id-ID")}</td>
                                    <td className="px-3 py-2">{formatMealsDisplay(row.meals)}</td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={11} className="px-3 py-4 text-center text-slate-500">
                                    Belum ada data 30 hari terakhir.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-amber-100 bg-gradient-to-b from-white to-amber-50/55 p-5 shadow-[0_18px_40px_-26px_rgba(15,23,42,0.35)]">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-lg font-semibold text-slate-900">Input Manual Dinonaktifkan</h3>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          Mode Pengukuran
                        </span>
                      </div>
                      <p className="text-sm text-slate-600">
                        Bagian entri data manual sudah dihapus. Mulai sekarang data kesehatan dicatat hanya saat proses pengukuran
                        (device/sensor/aktivitas) agar data lebih konsisten.
                      </p>
                      <ul className="mt-3 space-y-1 text-xs text-slate-600">
                        <li>- Data tetap masuk otomatis ke tabel mingguan dan bulanan.</li>
                        <li>- Gunakan menu pengukuran/perangkat saat ingin menambah data baru.</li>
                      </ul>
                      {manualStatus ? (
                        <p
                          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                            manualStatusTone === "error"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : manualStatusTone === "success"
                                ? "border-emerald-100 bg-emerald-50/60 text-emerald-800"
                                : "border-sky-200 bg-sky-50 text-sky-700"
                          }`}
                        >
                          {manualStatus}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : isUsersPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-teal-100 bg-gradient-to-r from-white to-teal-50/75 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Daftar Pasien</h2>
                      <p className="text-sm text-slate-500">
                        Ringkasan pengguna dengan pencarian, filter risiko, dan sorting operasional.
                      </p>
                    </div>
                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4">
                      <input
                        type="text"
                        value={adminUserSearch}
                        onChange={(event) => setAdminUserSearch(event.target.value)}
                        placeholder="Cari email pengguna..."
                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                      />
                      <select
                        value={adminRiskFilter}
                        onChange={(event) => setAdminRiskFilter(event.target.value as "semua" | "tinggi" | "sedang" | "rendah")}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value="semua">Semua Risiko</option>
                        <option value="tinggi">Risiko Tinggi</option>
                        <option value="sedang">Risiko Sedang</option>
                        <option value="rendah">Risiko Rendah</option>
                      </select>
                      <select
                        value={adminUserSort}
                        onChange={(event) => setAdminUserSort(event.target.value as "risk" | "recent" | "records")}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value="risk">Urutkan: Skor Risiko</option>
                        <option value="recent">Urutkan: Update Terbaru</option>
                        <option value="records">Urutkan: Data Masuk</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => exportAdminReport("users")}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        Ekspor Data Pengguna
                      </button>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">No</th>
                            <th className="px-4 py-3">Email</th>
                            <th className="px-4 py-3">Risiko</th>
                            <th className="px-4 py-3">Skor</th>
                            <th className="px-4 py-3">Data Masuk</th>
                            <th className="px-4 py-3">Terakhir Update</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAdminUsers.length > 0 ? (
                            filteredAdminUsers.map((item, index) => (
                              <tr key={item.ownerEmail} className="border-t border-slate-100 text-slate-700">
                                <td className="px-4 py-3">{index + 1}</td>
                                <td className="px-4 py-3">{item.ownerEmail}</td>
                                <td className="px-4 py-3">
                                  <span
                                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                                      item.riskLevel === "Tinggi"
                                        ? "bg-rose-100 text-rose-700"
                                        : item.riskLevel === "Sedang"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-emerald-100 text-emerald-700"
                                    }`}
                                  >
                                    {item.riskLevel}
                                  </span>
                                </td>
                                <td className="px-4 py-3">{item.riskScore}</td>
                                <td className="px-4 py-3">{item.recordCount}</td>
                                <td className="px-4 py-3">{item.lastSeenLabel}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                                Belum ada data pengguna.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : isRiskPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-teal-100 bg-gradient-to-r from-white to-teal-50/75 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Analisis Risiko</h2>
                      <p className="text-sm text-slate-500">
                        Prioritaskan pengguna dengan risiko tertinggi untuk tindak lanjut.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border border-teal-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">User Risiko Tinggi</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900">{adminKpi.highRiskUsers}</p>
                        <p className="mt-1 text-xs text-slate-500">Per pengguna terakhir</p>
                      </div>
                      <div className="rounded-2xl border border-teal-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">User Risiko Sedang</p>
                        <p className="mt-2 text-3xl font-semibold text-amber-600">{adminKpi.mediumRiskUsers}</p>
                        <p className="mt-1 text-xs text-slate-500">Per pengguna terakhir</p>
                      </div>
                      <div className="rounded-2xl border border-teal-100/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Aksi Prioritas</p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">
                          {filteredAdminAlerts.length > 0
                            ? `Fokus ke ${Math.min(5, filteredAdminAlerts.length)} pengguna dengan skor tertinggi.`
                            : "Tidak ada alert aktif saat ini."}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-white to-amber-50/80 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h3 className="text-lg font-semibold text-slate-900">Daftar Risiko Tertinggi</h3>
                      <div className="mt-3 space-y-2">
                        {filteredAdminUsers.slice(0, 10).map((item) => (
                          <div key={item.ownerEmail} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {item.ownerEmail} - {item.riskLevel} (skor {item.riskScore}) - update {item.lastSeenLabel}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : isAiResultPage ? (
                  <div className="space-y-4">
                    <div className={userPageHeaderClass}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="text-xl font-semibold text-slate-900">Analisis</h2>
                          <p className="text-sm text-slate-500">
                            Rekomendasi otomatis berdasarkan data kesehatan terbaru Anda.
                          </p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          Mode {interfaceProfile.label}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <p className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs text-slate-600">
                          Evaluasi risiko berbasis indikator harian.
                        </p>
                        <p className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs text-slate-600">
                          Fokus pada tren tidur, jantung, dan tekanan darah.
                        </p>
                        <p className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs text-slate-600">
                          Susunan diselaraskan dengan referensi desain Canva.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Skor Risiko</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900">{riskScore}</p>
                        <p className="mt-1 text-xs text-slate-500">Berdasarkan standar Kemenkes</p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Kategori Risiko</p>
                        <p className={`mt-2 text-3xl font-semibold ${riskColor}`}>{riskLevel}</p>
                        <p className="mt-1 text-xs text-slate-500">Kategori risiko saat ini</p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Ringkasan Rekomendasi</p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">
                          Rekomendasi otomatis berbasis data untuk mendukung perbaikan kebiasaan harian.
                        </p>
                      </div>
                    </div>

                    <div className={userPageSurfaceClass}>
                      <h3 className="text-lg font-semibold text-slate-900">Ringkasan Klinis Pribadi</h3>
                      <div className="mt-3 space-y-2">
                        {[
                          `Langkah hari ini: ${(latest?.steps ?? 0).toLocaleString("id-ID")}`,
                          `Durasi tidur: ${latest?.sleep ?? 0} jam`,
                          `Detak jantung: ${latest?.heartRate ?? 0} bpm`,
                          `Tekanan darah: ${latest?.bloodPressure ?? "0/0"}`,
                          `Kalori estimasi: ${latest?.calories ?? 0} kkal`,
                        ].map((item) => (
                          <div key={item} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            {item}
                          </div>
                        ))}
                      </div>
                      {nutritionIndicators.length > 0 ? (
                        <div className="mt-4 rounded-xl border border-slate-200 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Indikator Gizi (Isi Piringku)
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {nutritionIndicators.map((item) => {
                              const badgeClass =
                                item.status === "baik"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : item.status === "waspada"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-rose-100 text-rose-700";
                              const label = item.status === "baik" ? "Baik" : item.status === "waspada" ? "Waspada" : "Tinggi";
                              return (
                                <div key={item.label} className="rounded-lg bg-slate-50 px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-slate-700">{item.label}</span>
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badgeClass}`}>{label}</span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-500">{item.value}</p>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Ringkasan AI Kesehatan</p>
                        <div className="mt-2 space-y-2">
                          {educationItems.map((item) => (
                            <p key={item} className="text-sm text-slate-700">
                              - {item}
                            </p>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                ) : isHistoryPage ? (
                  <div className="space-y-4">
                    <div className={userPageHeaderClass}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="text-xl font-semibold text-slate-900">Riwayat</h2>
                          <p className="text-sm text-slate-500">
                            Riwayat hasil pengukuran, olahraga, dan data kesehatan lain saat data baru masuk.
                          </p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          Mode {interfaceProfile.label}
                        </span>
                      </div>
                      <div className="mt-3 rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs text-slate-600">
                        Tampilan riwayat dirapikan agar mudah membaca urutan waktu, aktivitas, dan perubahan metrik kesehatan.
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Total Catatan</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">{userHistoryRecords.length}</p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Langkah 7 Hari</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                          {weeklySteps.toLocaleString("id-ID")}
                        </p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Rata-rata Tidur</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">{avgSleep} jam</p>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-2xl border border-amber-100 bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-amber-50/70 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Waktu</th>
                            <th className="px-4 py-3">Langkah</th>
                            <th className="px-4 py-3">Kalori</th>
                            <th className="px-4 py-3">Tidur</th>
                            <th className="px-4 py-3">Detak Jantung</th>
                            <th className="px-4 py-3">Tekanan Darah</th>
                            <th className="px-4 py-3">Asupan Makan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userHistoryRecords.length > 0 ? (
                            [...userHistoryRecords]
                              .slice(0, 50)
                              .map((item) => (
                                <tr key={item.id} className="border-t border-slate-100 text-slate-700">
                                  <td className="px-4 py-3">
                                    {item.timestamp?.toDate
                                      ? item.timestamp.toDate().toLocaleString("id-ID")
                                      : "Data tersimpan"}
                                  </td>
                                  <td className="px-4 py-3">{item.steps.toLocaleString("id-ID")}</td>
                                  <td className="px-4 py-3">{item.calories}</td>
                                  <td className="px-4 py-3">{item.sleep} jam</td>
                                  <td className="px-4 py-3">{item.heartRate} bpm</td>
                                  <td className="px-4 py-3">{item.bloodPressure}</td>
                                  <td className="px-4 py-3">{formatMealsDisplay(item.meals)}</td>
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                                Belum ada riwayat pengukuran atau olahraga.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : isAdminAlertsPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Tindak Lanjut Pengukuran</h2>
                      <p className="text-sm text-slate-500">Kelola prioritas peringatan dan status tindak lanjut per pengguna.</p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Peringatan Terbuka</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900">
                          {adminAlerts.filter((item) => item.status !== "selesai").length}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Diproses</p>
                        <p className="mt-2 text-3xl font-semibold text-amber-600">
                          {adminAlerts.filter((item) => item.status === "diproses").length}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Selesai</p>
                        <p className="mt-2 text-3xl font-semibold text-emerald-600">
                          {adminAlerts.filter((item) => item.status === "selesai").length}
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-3">
                      <select
                        value={adminAlertStatusFilter}
                        onChange={(event) =>
                          setAdminAlertStatusFilter(event.target.value as "semua" | "baru" | "diproses" | "selesai")
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value="semua">Semua Status</option>
                        <option value="baru">Baru</option>
                        <option value="diproses">Diproses</option>
                        <option value="selesai">Selesai</option>
                      </select>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        SLA penyelesaian: <span className="font-semibold text-slate-900">{adminCompletionRate}%</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => exportAdminReport("alerts")}
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                      >
                        Ekspor Peringatan
                      </button>
                    </div>

                    <div className="space-y-3">
                      {filteredAdminAlerts.length > 0 ? (
                        filteredAdminAlerts.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h3 className="text-base font-semibold text-slate-900">{item.ownerEmail}</h3>
                                <p className="text-xs text-slate-500">
                                  Prioritas {item.level} - skor {item.score}
                                </p>
                              </div>
                              <select
                                value={item.status}
                                onChange={(event) =>
                                  setAlertFollowUpStatus(
                                    item.ownerEmail,
                                    event.target.value as "baru" | "diproses" | "selesai"
                                  )
                                }
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
                              >
                                <option value="baru">Baru</option>
                                <option value="diproses">Diproses</option>
                                <option value="selesai">Selesai</option>
                              </select>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">{item.note}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                          Tidak ada peringatan pada filter ini.
                        </div>
                      )}
                    </div>
                  </div>
                ) : isAdminAuditPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Riwayat</h2>
                      <p className="text-sm text-slate-500">Jejak data terakhir untuk verifikasi aktivitas sistem.</p>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => exportAdminReport("audit")}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Ekspor Audit CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Waktu</th>
                            <th className="px-4 py-3">Email</th>
                            <th className="px-4 py-3">Sumber</th>
                            <th className="px-4 py-3">Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminAuditLogs.map((item) => (
                            <tr key={item.id} className="border-t border-slate-100 text-slate-700">
                              <td className="px-4 py-3">{new Date(item.createdAt).toLocaleString("id-ID")}</td>
                              <td className="px-4 py-3">{item.ownerEmail}</td>
                              <td className="px-4 py-3">{item.source}</td>
                              <td className="px-4 py-3">{item.detail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : isAlertsPage ? (
                  <div className="space-y-4">
                    <div className={userPageHeaderClass}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h2 className="text-xl font-semibold text-slate-900">{getMenuLabel(activeMenu)}</h2>
                          <p className="text-sm text-slate-500">
                            Peringatan otomatis berdasarkan data kesehatan terbaru.
                          </p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                          Mode {interfaceProfile.label}
                        </span>
                      </div>
                      <div className="mt-3 rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs text-slate-600">
                        Prioritaskan peringatan tingkat tinggi agar tindak lanjut dilakukan lebih cepat dan terukur.
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Peringatan Aktif</p>
                        <p className="mt-2 text-3xl font-semibold text-slate-900">{activeAlerts.length}</p>
                        <p className="mt-1 text-xs text-slate-500">Berdasarkan data terakhir</p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Prioritas Tertinggi</p>
                        <p className="mt-2 text-3xl font-semibold text-rose-600">
                          {activeAlerts.some((item) => item.level === "Tinggi") ? "Tinggi" : "Normal"}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">Status saat ini</p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Aksi</p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">
                          {activeAlerts.length > 0
                            ? "Tinjau peringatan prioritas tinggi."
                            : "Tidak ada peringatan aktif, kondisi saat ini relatif stabil."}
                        </p>
                      </div>
                    </div>

                    <div className="stagger-children space-y-3">
                      {activeAlerts.length > 0 ? (
                        activeAlerts.map((item) => (
                          <div
                            key={item.id}
                            className={`stagger-item ${userPageSurfaceClass}`}
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                              <span
                                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                  item.level === "Tinggi"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {item.level}
                              </span>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                          Tidak ada peringatan aktif dari data terbaru.
                        </div>
                      )}
                    </div>
                  </div>
                ) : isAdminEducationPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Edukasi</h2>
                      <p className="text-sm text-slate-500">Kelola materi edukasi yang ditampilkan ke pengguna.</p>
                    </div>
                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-4">
                      <select
                        value={adminEducationFilter}
                        onChange={(event) =>
                          setAdminEducationFilter(event.target.value as "semua" | AdminEducationEntry["category"])
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                      >
                        <option value="semua">Semua Kategori</option>
                        <option value="nutrisi">Nutrisi</option>
                        <option value="aktivitas">Aktivitas</option>
                        <option value="tidur">Tidur</option>
                        <option value="jantung">Jantung</option>
                      </select>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        Published:{" "}
                        <span className="font-semibold text-slate-900">
                          {adminEducationLibrary.filter((item) => item.status === "published").length}
                        </span>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        Draft:{" "}
                        <span className="font-semibold text-slate-900">
                          {adminEducationLibrary.filter((item) => item.status === "draft").length}
                        </span>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                        Ditampilkan: <span className="font-semibold text-slate-900">{filteredAdminEducation.length}</span>
                      </div>
                    </div>
                    <div className="stagger-children space-y-3">
                      {filteredAdminEducation.length > 0 ? (
                        filteredAdminEducation.map((item) => (
                          <div
                            key={item.id}
                            className="stagger-item rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                                <p className="text-xs uppercase tracking-wide text-slate-500">
                                  {item.category} - update {new Date(item.updatedAt).toLocaleDateString("id-ID")}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleEducationStatus(item.id)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                  item.status === "published"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {item.status === "published" ? "Published" : "Draft"}
                              </button>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">{item.summary}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                          Tidak ada konten edukasi pada filter kategori ini.
                        </div>
                      )}
                    </div>
                  </div>
                ) : isAdminBroadcastPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Notifikasi</h2>
                      <p className="text-sm text-slate-500">Kirim pesan massal ke segmen pengguna yang dipilih.</p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <label className="text-xs uppercase tracking-wide text-slate-500">Segment Target</label>
                        <select
                          value={adminBroadcastSegment}
                          onChange={(event) =>
                            setAdminBroadcastSegment(
                              event.target.value as "semua" | "risiko_tinggi" | "risiko_sedang" | "alert_terbuka"
                            )
                          }
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                        >
                          <option value="semua">Semua Pengguna</option>
                          <option value="risiko_tinggi">Risiko Tinggi</option>
                          <option value="risiko_sedang">Risiko Sedang</option>
                          <option value="alert_terbuka">Peringatan Terbuka</option>
                        </select>
                        <label className="mt-4 block text-xs uppercase tracking-wide text-slate-500">Pesan Broadcast</label>
                        <textarea
                          value={adminBroadcastMessage}
                          onChange={(event) => setAdminBroadcastMessage(event.target.value)}
                          placeholder="Contoh: Mohon input data tidur malam ini sebelum pukul 21.00."
                          className="mt-1 h-28 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                        />
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs text-slate-500">Estimasi penerima: {adminBroadcastTargets.length} pengguna</p>
                          <button
                            type="button"
                            onClick={sendAdminBroadcast}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                          >
                            Simpan Broadcast
                          </button>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <h3 className="text-sm font-semibold text-slate-900">Riwayat Broadcast</h3>
                        <div className="mt-3 space-y-2">
                          {adminBroadcastLogs.length > 0 ? (
                            adminBroadcastLogs.slice(0, 8).map((item) => (
                              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                <p className="text-xs text-slate-500">
                                  {new Date(item.createdAt).toLocaleString("id-ID")} - {item.segment}
                                </p>
                                <p className="text-sm text-slate-700">{item.message}</p>
                                <p className="text-xs text-slate-500">{item.recipientCount} penerima</p>
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-slate-500">Belum ada riwayat broadcast.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : isAdminRolePage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Hak Akses</h2>
                      <p className="text-sm text-slate-500">
                        Hak akses admin dibaca dari session backend agar role tidak bisa diubah dari browser.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      Perbarui roster admin dari konfigurasi backend dan refresh sesi login agar perubahan akses diterapkan
                      dengan aman.
                    </div>
                    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Email Admin</th>
                            <th className="px-4 py-3">safeRole</th>
                            <th className="px-4 py-3">Aksi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminRoster.map((email) => (
                            <tr key={email} className="border-t border-slate-100 text-slate-700">
                              <td className="px-4 py-3">
                                {email} {email === safeUserEmail.toLowerCase() ? "(akun aktif)" : ""}
                              </td>
                              <td className="px-4 py-3">
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                  {adminRoleByEmail[email] === "super_admin" ? "Super Admin" : "Operator"}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="text-xs text-slate-400">Dikelola backend</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : isAdminTimelinePage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Timeline</h2>
                      <p className="text-sm text-slate-500">Riwayat perubahan status alert oleh admin.</p>
                    </div>
                    <div className="space-y-3">
                      {adminTimeline.length > 0 ? (
                        adminTimeline.slice(0, 100).map((entry) => (
                          <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-xs text-slate-500">{new Date(entry.createdAt).toLocaleString("id-ID")}</p>
                            <p className="mt-1 text-sm text-slate-800">
                              <span className="font-semibold">{entry.actorEmail}</span> mengubah{" "}
                              <span className="font-semibold">{entry.ownerEmail}</span> dari{" "}
                              <span className="font-semibold">{entry.fromStatus}</span> ke{" "}
                              <span className="font-semibold">{entry.toStatus}</span>.
                            </p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                          Belum ada riwayat tindak lanjut.
                        </div>
                      )}
                    </div>
                  </div>
                ) : isReportsPage ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      <h2 className="text-xl font-semibold text-slate-900">Laporan & Ekspor</h2>
                      <p className="text-sm text-slate-500">
                        Rekap performa sistem dan ekspor data operasional admin.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => exportAdminReport("users")}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Ekspor Data Pengguna
                      </button>
                      <button
                        type="button"
                        onClick={() => exportAdminReport("alerts")}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Ekspor Peringatan
                      </button>
                      <button
                        type="button"
                        onClick={() => exportAdminReport("audit")}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                      >
                        Ekspor Audit
                      </button>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Total Langkah (7 hari)</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                          {weeklySteps.toLocaleString("id-ID")}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Total Kalori (7 hari)</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">
                          {totalCaloriesWeek.toLocaleString("id-ID")}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Rata-rata Tidur</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">{avgSleepWeek} jam</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Rata-rata Detak</p>
                        <p className="mt-2 text-2xl font-semibold text-slate-900">{avgHeartRateWeek} bpm</p>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <h3 className="text-lg font-semibold text-slate-900">Ringkasan Aktivitas</h3>
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-600">Langkah tertinggi</span>
                            <span className="font-semibold text-slate-900">
                              {maxStepsWeek.toLocaleString("id-ID")}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-600">Langkah terendah</span>
                            <span className="font-semibold text-slate-900">
                              {minStepsWeek.toLocaleString("id-ID")}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-600">Jumlah data masuk</span>
                            <span className="font-semibold text-slate-900">{data.length}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                            <span className="text-slate-600">Peringatan aktif</span>
                            <span className="font-semibold text-slate-900">{adminAlerts.length}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                        <h3 className="text-lg font-semibold text-slate-900">Catatan Admin</h3>
                        <div className="mt-3 space-y-2 text-sm text-slate-700">
                          <p className="rounded-lg bg-slate-50 px-3 py-2">
                            Total pengguna terpantau: <span className="font-semibold">{adminKpi.totalUsers}</span>.
                          </p>
                          <p className="rounded-lg bg-slate-50 px-3 py-2">
                            Peringatan terbuka: <span className="font-semibold">{adminKpi.activeAlerts}</span>. Fokus ke risiko tinggi terlebih dulu.
                          </p>
                          <p className="rounded-lg bg-slate-50 px-3 py-2">
                            Ringkasan Edukasi: {aiInsightPreview}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : isSettingsPage ? (
                  <div className="space-y-4">
                    <div className={`${safeRole === "admin" ? "rounded-2xl border border-slate-200/80 bg-white/95" : userPageHeaderClass} p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm`}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-xl font-semibold text-slate-900">
                            {safeRole === "admin" ? "Pengaturan Sistem" : "Pengaturan"}
                          </h2>
                          <p className="text-sm text-slate-500">
                            {safeRole === "admin"
                              ? "Kelola konfigurasi operasional dashboard, notifikasi, dan personalisasi tampilan."
                              : "Kelola pengingat harian, jadwal tidur, dan tampilan dashboard."}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">Mode tampilan aktif: {interfaceProfile.label}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {safeRole === "admin" ? (
                            <>
                              <button
                                type="button"
                                onClick={runSettingsNotificationPreview}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                Test Notifikasi
                              </button>
                              <button
                                type="button"
                                onClick={resetDisplayConfig}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                Reset Tampilan
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={runSettingsNotificationPreview}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                              >
                                Test Pengingat
                              </button>
                              <button
                                type="button"
                                onClick={resetUserPreferenceConfig}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700"
                              >
                                Reset Preferensi Pribadi
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {safeRole === "admin" ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Notifikasi Browser</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {"Notification" in window ? Notification.permission : "Tidak didukung"}
                            </p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Peringatan Aktif Operasional</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">{adminKpi.activeAlerts}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">SLA Tindak Lanjut</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">{adminCompletionRate}% selesai</p>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-white p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">Tema Dashboard</p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {themeMode === "dark" ? "Gelap" : "Terang"} / {normalizedAccent}
                            </p>
                          </div>
                        </div>
                        {settingsStatus ? (
                          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                            {settingsStatus}
                          </p>
                        ) : null}
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                            <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">Kontrol Notifikasi Operasional</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                  Pengaturan yang dipakai untuk pratinjau dan pemantauan dari akun admin.
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                                Operasional
                              </span>
                            </div>
                            <div className="mt-4 space-y-3">
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={warningNotificationEnabled}
                                  onChange={(event) => setWarningNotificationEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Aktifkan notifikasi peringatan kesehatan
                              </label>
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={reminderSoundEnabled}
                                  onChange={(event) => setReminderSoundEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Aktifkan nada alarm saat pratinjau notifikasi
                              </label>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Pesan Standar</p>
                                <textarea
                                  value={reminderMessage}
                                  onChange={(event) => setReminderMessage(event.target.value)}
                                  className="h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                Pratinjau operasional: {effectiveReminderMessage}
                              </div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_38px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                            <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-3 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <h3 className="text-lg font-semibold text-slate-900">Tampilan Admin Standar</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                  Tampilan admin diset otomatis agar kontras, rapi, dan konsisten untuk operasional harian.
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                                Tampilan
                              </span>
                            </div>
                            <div className="mt-4 space-y-3">
                              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-700">
                                Mode tampilan aktif: <span className="font-semibold">Admin Clean</span>
                              </div>
                              <ul className="space-y-2 text-sm text-slate-600">
                                <li>Kontras teks ditingkatkan untuk keterbacaan.</li>
                                <li>Warna antarmuka diseragamkan untuk konsistensi panel admin.</li>
                                <li>Efek visual berlebih dikurangi agar fokus ke data operasional.</li>
                              </ul>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="mb-3 flex flex-wrap gap-2">
                            {[
                              { key: "access", label: "Akun Admin" },
                              { key: "ux", label: "Dasbor Admin" },
                              { key: "notifications", label: "Notifikasi Operasional" },
                              { key: "compliance", label: "Alur Kerja Admin" },
                              { key: "audit", label: "Audit Aktivitas" },
                              ...(currentAdminRole === "super_admin"
                                ? ([
                                    { key: "general", label: "Konsol Sistem" },
                                    { key: "risk", label: "Mesin Risiko" },
                                    { key: "data", label: "Tata Kelola Data" },
                                    { key: "integrations", label: "Integrasi Sistem" },
                                  ] as const)
                                : []),
                            ].map((item) => (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() =>
                                  setAdminSettingsSection(
                                    item.key as
                                      | "general"
                                      | "access"
                                      | "notifications"
                                      | "risk"
                                      | "data"
                                      | "integrations"
                                      | "compliance"
                                      | "ux"
                                      | "audit"
                                  )
                                }
                                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                                  adminSettingsSection === item.key
                                    ? "bg-slate-900 text-white"
                                    : "border border-slate-200 bg-white text-slate-700"
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                            <input
                              type="text"
                              value={adminChangeReason}
                              onChange={(event) => setAdminChangeReason(event.target.value)}
                              placeholder="Alasan perubahan sensitif (wajib bila policy aktif)"
                              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                            />
                            <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={adminRequireReasonSensitive}
                                onChange={(event) =>
                                  commitAdminSetting({
                                    area: "Compliance",
                                    field: "Wajib Alasan untuk Perubahan Sensitif",
                                    oldValue: adminRequireReasonSensitive,
                                    newValue: event.target.checked,
                                    apply: () => setAdminRequireReasonSensitive(event.target.checked),
                                  })
                                }
                              />
                              Wajib alasan sensitif
                            </label>
                          </div>
                        </div>
                        {adminSettingsSection === "general" && currentAdminRole === "super_admin" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Sistem Umum</h3>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Zona Waktu</p>
                                  <input
                                    type="text"
                                    value={adminTimezone}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "General",
                                        field: "Timezone",
                                        oldValue: adminTimezone,
                                        newValue: event.target.value,
                                        apply: () => setAdminTimezone(event.target.value),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Lokal</p>
                                  <input
                                    type="text"
                                    value={adminLocale}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "General",
                                        field: "Locale",
                                        oldValue: adminLocale,
                                        newValue: event.target.value,
                                        apply: () => setAdminLocale(event.target.value),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={adminMaintenanceMode}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "General",
                                        field: "Maintenance Mode",
                                        oldValue: adminMaintenanceMode,
                                        newValue: event.target.checked,
                                        sensitive: true,
                                        apply: () => setAdminMaintenanceMode(event.target.checked),
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  Aktifkan mode pemeliharaan
                                </label>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Rentang Operasional</h3>
                              <div className="mt-3 space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Mulai</p>
                                    <input
                                      type="time"
                                      value={adminOperationalStart}
                                      onChange={(event) =>
                                        commitAdminSetting({
                                          area: "General",
                                          field: "Operational Start",
                                          oldValue: adminOperationalStart,
                                          newValue: event.target.value,
                                          apply: () => setAdminOperationalStart(event.target.value),
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                    />
                                  </div>
                                  <div>
                                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Selesai</p>
                                    <input
                                      type="time"
                                      value={adminOperationalEnd}
                                      onChange={(event) =>
                                        commitAdminSetting({
                                          area: "General",
                                          field: "Operational End",
                                          oldValue: adminOperationalEnd,
                                          newValue: event.target.value,
                                          apply: () => setAdminOperationalEnd(event.target.value),
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Halaman Awal</p>
                                  <select
                                    value={adminDefaultLanding}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "General",
                                        field: "Default Landing",
                                        oldValue: adminDefaultLanding,
                                        newValue: event.target.value,
                                        apply: () => setAdminDefaultLanding(event.target.value),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                  >
                                    <option value="Dashboard Ringkas">Dashboard Ringkas</option>
                                    <option value="Monitoring Risiko">Monitoring Risiko</option>
                                    <option value="Alert & Tindak Lanjut">Alert & Tindak Lanjut</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "access" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Akses & Sesi</h3>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Batas Waktu Sesi (menit)</p>
                                  <input
                                    type="number"
                                    min={5}
                                    max={240}
                                    value={adminSessionTimeoutMin}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Access",
                                        field: "Session Timeout",
                                        oldValue: adminSessionTimeoutMin,
                                        newValue: Number(event.target.value || 45),
                                        sensitive: true,
                                        apply: () => setAdminSessionTimeoutMin(Number(event.target.value || 45)),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={adminRequire2FA}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Access",
                                        field: "Require 2FA",
                                        oldValue: adminRequire2FA,
                                        newValue: event.target.checked,
                                        sensitive: true,
                                        apply: () => setAdminRequire2FA(event.target.checked),
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  Wajibkan 2FA untuk seluruh admin
                                </label>
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={adminAllowNewDevice}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Access",
                                        field: "Allow New Device Login",
                                        oldValue: adminAllowNewDevice,
                                        newValue: event.target.checked,
                                        sensitive: true,
                                        apply: () => setAdminAllowNewDevice(event.target.checked),
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  Izinkan login dari perangkat baru
                                </label>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Admin Roster</h3>
                              <div className="mt-3 space-y-2 text-sm text-slate-700">
                                {adminRoster.slice(0, 12).map((email) => (
                                  <div key={email} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                                    <span>{email}</span>
                                    <span className="text-xs text-slate-500">
                                      {adminRoleByEmail[email] === "super_admin" ? "super_admin" : "operator"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "notifications" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Kebijakan Notifikasi</h3>
                              <div className="mt-3 space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Awal Mode Senyap</p>
                                    <input
                                      type="time"
                                      value={adminQuietHourStart}
                                      onChange={(event) =>
                                        commitAdminSetting({
                                          area: "Notifications",
                                          field: "Quiet Hour Start",
                                          oldValue: adminQuietHourStart,
                                          newValue: event.target.value,
                                          apply: () => setAdminQuietHourStart(event.target.value),
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                    />
                                  </div>
                                  <div>
                                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Akhir Mode Senyap</p>
                                    <input
                                      type="time"
                                      value={adminQuietHourEnd}
                                      onChange={(event) =>
                                        commitAdminSetting({
                                          area: "Notifications",
                                          field: "Quiet Hour End",
                                          oldValue: adminQuietHourEnd,
                                          newValue: event.target.value,
                                          apply: () => setAdminQuietHourEnd(event.target.value),
                                        })
                                      }
                                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Eskalasi (jam)</p>
                                  <input
                                    type="number"
                                    min={1}
                                    max={72}
                                    value={adminEscalationHours}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Notifications",
                                        field: "Escalation Hours",
                                        oldValue: adminEscalationHours,
                                        newValue: Number(event.target.value || 24),
                                        apply: () => setAdminEscalationHours(Number(event.target.value || 24)),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Templat</h3>
                              <textarea
                                value={reminderMessage}
                                onChange={(event) =>
                                  commitAdminSetting({
                                    area: "Notifications",
                                    field: "Reminder Template",
                                    oldValue: reminderMessage,
                                    newValue: event.target.value,
                                    apply: () => setReminderMessage(event.target.value),
                                  })
                                }
                                className="mt-3 h-28 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                              />
                              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                Pratinjau: {effectiveReminderMessage}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "risk" && currentAdminRole === "super_admin" ? (
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-slate-900">Konfigurasi Mesin Risiko</h3>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Tidur Minimal (jam)</p>
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  value={adminRiskSleepMin}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Risk",
                                      field: "Sleep Min",
                                      oldValue: adminRiskSleepMin,
                                      newValue: Number(event.target.value || 7),
                                      sensitive: true,
                                      apply: () => setAdminRiskSleepMin(Number(event.target.value || 7)),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Tidur Maksimal (jam)</p>
                                <input
                                  type="number"
                                  min={4}
                                  max={16}
                                  value={adminRiskSleepMax}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Risk",
                                      field: "Sleep Max",
                                      oldValue: adminRiskSleepMax,
                                      newValue: Number(event.target.value || 9),
                                      sensitive: true,
                                      apply: () => setAdminRiskSleepMax(Number(event.target.value || 9)),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Langkah Minimal</p>
                                <input
                                  type="number"
                                  min={1000}
                                  max={20000}
                                  value={adminRiskStepsMin}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Risk",
                                      field: "Steps Min",
                                      oldValue: adminRiskStepsMin,
                                      newValue: Number(event.target.value || 8000),
                                      sensitive: true,
                                      apply: () => setAdminRiskStepsMin(Number(event.target.value || 8000)),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Detak Jantung Minimal</p>
                                <input
                                  type="number"
                                  min={30}
                                  max={120}
                                  value={adminRiskHeartRateMin}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Risk",
                                      field: "Heart Rate Min",
                                      oldValue: adminRiskHeartRateMin,
                                      newValue: Number(event.target.value || 60),
                                      sensitive: true,
                                      apply: () => setAdminRiskHeartRateMin(Number(event.target.value || 60)),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Detak Jantung Maksimal</p>
                                <input
                                  type="number"
                                  min={60}
                                  max={180}
                                  value={adminRiskHeartRateMax}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Risk",
                                      field: "Heart Rate Max",
                                      oldValue: adminRiskHeartRateMax,
                                      newValue: Number(event.target.value || 100),
                                      sensitive: true,
                                      apply: () => setAdminRiskHeartRateMax(Number(event.target.value || 100)),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Sistolik Maksimal</p>
                                <input
                                  type="number"
                                  min={90}
                                  max={180}
                                  value={adminRiskSystolicMax}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Risk",
                                      field: "Systolic Max",
                                      oldValue: adminRiskSystolicMax,
                                      newValue: Number(event.target.value || 120),
                                      sensitive: true,
                                      apply: () => setAdminRiskSystolicMax(Number(event.target.value || 120)),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "data" && currentAdminRole === "super_admin" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Tata Kelola Data</h3>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Retensi Data (hari)</p>
                                  <input
                                    type="number"
                                    min={30}
                                    max={3650}
                                    value={adminDataRetentionDays}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Data",
                                        field: "Retention Days",
                                        oldValue: adminDataRetentionDays,
                                        newValue: Number(event.target.value || 365),
                                        sensitive: true,
                                        apply: () => setAdminDataRetentionDays(Number(event.target.value || 365)),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Anonimisasi Otomatis (hari)</p>
                                  <input
                                    type="number"
                                    min={30}
                                    max={3650}
                                    value={adminAutoAnonymizeDays}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Data",
                                        field: "Auto Anonymize Days",
                                        oldValue: adminAutoAnonymizeDays,
                                        newValue: Number(event.target.value || 730),
                                        sensitive: true,
                                        apply: () => setAdminAutoAnonymizeDays(Number(event.target.value || 730)),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={adminAllowCsvExport}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Data",
                                        field: "Allow CSV Export",
                                        oldValue: adminAllowCsvExport,
                                        newValue: event.target.checked,
                                        sensitive: true,
                                        apply: () => setAdminAllowCsvExport(event.target.checked),
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  Izinkan ekspor CSV dari panel admin
                                </label>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Kebijakan Cadangan Data</h3>
                              <div className="mt-3 space-y-3">
                                <select
                                  value={adminBackupSchedule}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "Data",
                                      field: "Backup Schedule",
                                      oldValue: adminBackupSchedule,
                                      newValue: event.target.value,
                                      apply: () =>
                                        setAdminBackupSchedule(event.target.value as "daily" | "weekly" | "monthly"),
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                >
                                  <option value="daily">Harian</option>
                                  <option value="weekly">Mingguan</option>
                                  <option value="monthly">Bulanan</option>
                                </select>
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                  Backup aktif: {adminBackupSchedule}. Retensi: {adminDataRetentionDays} hari.
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "integrations" && currentAdminRole === "super_admin" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">API dan Webhook</h3>
                              <div className="mt-3 space-y-3">
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={adminAiProxyEnabled}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Integrations",
                                        field: "AI Proxy Enabled",
                                        oldValue: adminAiProxyEnabled,
                                        newValue: event.target.checked,
                                        sensitive: true,
                                        apply: () => setAdminAiProxyEnabled(event.target.checked),
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  Aktifkan AI Proxy
                                </label>
                                <label className="flex items-center gap-3 text-sm text-slate-700">
                                  <input
                                    type="checkbox"
                                    checked={adminWebhookEnabled}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Integrations",
                                        field: "Webhook Enabled",
                                        oldValue: adminWebhookEnabled,
                                        newValue: event.target.checked,
                                        sensitive: true,
                                        apply: () => setAdminWebhookEnabled(event.target.checked),
                                      })
                                    }
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                  Aktifkan webhook notifikasi eksternal
                                </label>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Webhook URL</p>
                                  <input
                                    type="text"
                                    value={adminWebhookUrl}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Integrations",
                                        field: "Webhook URL",
                                        oldValue: adminWebhookUrl,
                                        newValue: event.target.value,
                                        apply: () => setAdminWebhookUrl(event.target.value),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Kebijakan Coba Ulang</p>
                                  <input
                                    type="number"
                                    min={0}
                                    max={10}
                                    value={adminRetryPolicy}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Integrations",
                                        field: "Retry Policy",
                                        oldValue: adminRetryPolicy,
                                        newValue: Number(event.target.value || 3),
                                        apply: () => setAdminRetryPolicy(Number(event.target.value || 3)),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Kesehatan Integrasi</h3>
                              <div className="mt-3 space-y-2">
                                {adminSystemHealth.warnings.length > 0 ? (
                                  adminSystemHealth.warnings.map((item) => (
                                    <p key={item} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                      {item}
                                    </p>
                                  ))
                                ) : (
                                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                    Semua integrasi utama dalam kondisi baik.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "compliance" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Alur Tindak Lanjut</h3>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Eskalasi (jam)</p>
                                  <input
                                    type="number"
                                    min={1}
                                    max={72}
                                    value={adminEscalationHours}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "Workflow",
                                        field: "Escalation Hours",
                                        oldValue: adminEscalationHours,
                                        newValue: Number(event.target.value || 24),
                                        apply: () => setAdminEscalationHours(Number(event.target.value || 24)),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">SLA Selesai</p>
                                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                                    {adminCompletionRate}% alert sudah berstatus selesai.
                                  </p>
                                </div>
                                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                  Perubahan sensitif dicatat dengan alasan: {adminRequireReasonSensitive ? "Aktif" : "Nonaktif"}.
                                </p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Aktivitas Tindak Lanjut Terakhir</h3>
                              <div className="mt-3 space-y-2">
                                {adminTimeline
                                  .slice(0, 6)
                                  .map((item) => (
                                    <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                                      {new Date(item.createdAt).toLocaleString("id-ID")} - {item.ownerEmail} ({item.fromStatus} {"->"}{" "}
                                      {item.toStatus})
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "ux" ? (
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Preferensi Antarmuka Admin</h3>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Kerapatan Dasbor</p>
                                  <select
                                    value={adminDashboardDensity}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "UX",
                                        field: "Kerapatan Dasbor",
                                        oldValue: adminDashboardDensity,
                                        newValue: event.target.value,
                                        apply: () => setAdminDashboardDensity(event.target.value as "compact" | "cozy"),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                  >
                                    <option value="cozy">Lapang</option>
                                    <option value="compact">Padat</option>
                                  </select>
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Tema</p>
                                  <select
                                    value={themeMode}
                                    onChange={(event) =>
                                      commitAdminSetting({
                                        area: "UX",
                                        field: "Theme",
                                        oldValue: themeMode,
                                        newValue: event.target.value,
                                        apply: () => setThemeMode(event.target.value as "light" | "dark"),
                                      })
                                    }
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                  >
                                    <option value="light">Terang</option>
                                    <option value="dark">Gelap</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <h3 className="text-sm font-semibold text-slate-900">Aksen</h3>
                              <div className="mt-3 space-y-3">
                                <input
                                  type="color"
                                  value={normalizedAccent}
                                  onChange={(event) =>
                                    commitAdminSetting({
                                      area: "UX",
                                      field: "Warna Aksen",
                                      oldValue: normalizedAccent,
                                      newValue: event.target.value,
                                      apply: () => setAccentColor(event.target.value),
                                    })
                                  }
                                  className="h-10 w-14 rounded border border-slate-200 bg-white p-1"
                                />
                                <p className="text-xs text-slate-600">Aksen aktif: {normalizedAccent}</p>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {adminSettingsSection === "audit" ? (
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <h3 className="text-sm font-semibold text-slate-900">Audit dan Riwayat Perubahan</h3>
                              <span className="text-xs text-slate-500">{adminConfigLogs.length} log</span>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="px-3 py-2">Waktu</th>
                                    <th className="px-3 py-2">Area</th>
                                    <th className="px-3 py-2">Field</th>
                                    <th className="px-3 py-2">Perubahan</th>
                                    <th className="px-3 py-2">Pelaku</th>
                                    <th className="px-3 py-2">Alasan</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {adminConfigLogs.slice(0, 120).map((log) => (
                                    <tr key={log.id} className="border-t border-slate-100 text-slate-700">
                                      <td className="px-3 py-2">{new Date(log.changedAt).toLocaleString("id-ID")}</td>
                                      <td className="px-3 py-2">{log.area}</td>
                                      <td className="px-3 py-2">{log.field}</td>
                                      <td className="px-3 py-2">
                                        {log.oldValue} -&gt; {log.newValue}
                                      </td>
                                      <td className="px-3 py-2">{log.actorEmail}</td>
                                      <td className="px-3 py-2">{log.reason}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <div className={userPageHeaderClass}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="text-lg font-semibold text-slate-900">Akun & Preferensi</h3>
                              <p className="mt-1 text-xs text-slate-500">
                                Halaman ini khusus untuk pengaturan pribadi pengguna, bukan pengaturan operasional admin.
                              </p>
                            </div>
                            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
                              Mode Pengguna
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                              Nama: <span className="font-semibold text-slate-900">{safeUserDisplayName || "-"}</span>
                            </p>
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                              Email: <span className="font-semibold text-slate-900">{safeUserEmail || "-"}</span>
                            </p>
                            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                              Sinkron tidur terakhir:{" "}
                              <span className="font-semibold text-slate-900">{lastSleepAutoSyncDate || "belum ada"}</span>
                            </p>
                          </div>
                        </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Notifikasi Browser</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {"Notification" in window ? Notification.permission : "Tidak didukung"}
                        </p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Pengingat Harian</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {reminderEnabled ? `Aktif (${reminderTime})` : "Nonaktif"}
                        </p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Jadwal Tidur</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {sleepScheduleEnabled ? `${sleepStartTime} - ${wakeTime}` : "Nonaktif"}
                        </p>
                      </div>
                      <div className={userPageStatCardClass}>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Tema Tampilan</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {themeMode === "dark" ? "Gelap" : "Terang"} /{" "}
                          {userThemeSourceMode === "doctor_tiles"
                            ? userThemeImageReady
                              ? `Gambar ${activeUserThemeTile.id}`
                              : "Gambar belum aktif"
                            : "Gradien"}
                        </p>
                      </div>
                    </div>
                    {settingsStatus ? (
                      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                        {settingsStatus}
                      </p>
                    ) : null}

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className={userPageSurfaceClass}>
                        <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">Alarm dan Pengingat</h3>
                            <p className="mt-1 text-xs text-slate-500">Atur jadwal, bunyi alarm, dan notifikasi kesehatan harian.</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                            Pengingat Harian
                          </span>
                        </div>

                        <div className="mt-4 space-y-4">
                          <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3">
                            <label className="flex items-center gap-3 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={reminderEnabled}
                                onChange={(event) => setReminderEnabled(event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              Aktifkan pengingat harian
                            </label>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Waktu</p>
                                <input
                                  type="time"
                                  value={reminderTime}
                                  onChange={(event) => setReminderTime(event.target.value)}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Status Notifikasi</p>
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
                                  {"Notification" in window ? Notification.permission : "Tidak didukung peramban"}
                                </div>
                              </div>
                            </div>
                            <div>
                              <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Pesan</p>
                              <textarea
                                value={reminderMessage}
                                onChange={(event) => setReminderMessage(event.target.value)}
                                className="h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={reminderSoundEnabled}
                                  onChange={(event) => setReminderSoundEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Aktifkan nada alarm bawaan HP
                              </label>
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={warningNotificationEnabled}
                                  onChange={(event) => setWarningNotificationEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Aktifkan notifikasi peringatan kesehatan
                              </label>
                            </div>
                            <p className="text-xs text-slate-500">
                              Android (Capacitor) akan memakai ringtone alarm default perangkat.
                            </p>
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                              Pratinjau pesan: {effectiveReminderMessage}
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 p-3">
                            <h4 className="text-sm font-semibold text-slate-800">Jadwal Pelacakan Aktivitas</h4>
                            <p className="mt-1 text-xs text-slate-500">
                              Pelacakan GPS aktif saat Anda mengaktifkannya. Cocok untuk jadwal kerja Senin-Jumat dan aktivitas fisik akhir pekan.
                            </p>
                            <div className="mt-3 space-y-3">
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Mode Pelacakan</p>
                                <select
                                  value={safeGpsTrackingSchedule.mode}
                                  onChange={(event) =>
                                    safeOnGpsTrackingScheduleChange({
                                      mode: event.target.value as "always" | "scheduled",
                                    })
                                  }
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                >
                                  <option value="always">Selalu aktif</option>
                                  <option value="scheduled">Sesuai jadwal</option>
                                </select>
                              </div>
                              {safeGpsTrackingSchedule.mode === "scheduled" ? (
                                <>
                                  <div>
                                    <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Hari Aktif Pelacakan</p>
                                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                                      {trackingDayOptions.map((item) => {
                                        const isSelected = safeGpsTrackingSchedule.days.includes(item.value);
                                        return (
                                          <label
                                            key={item.value}
                                            className={`flex items-center justify-center rounded-lg border px-2 py-2 text-xs font-medium ${
                                              isSelected
                                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                : "border-slate-200 bg-white text-slate-600"
                                            }`}
                                          >
                                            <input
                                              type="checkbox"
                                              className="sr-only"
                                              checked={isSelected}
                                              onChange={() => {
                                                const nextDays = isSelected
                                                  ? safeGpsTrackingSchedule.days.filter((day) => day !== item.value)
                                                  : [...safeGpsTrackingSchedule.days, item.value];
                                                safeOnGpsTrackingScheduleChange({ days: nextDays });
                                              }}
                                            />
                                            {item.label}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <div>
                                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Mulai Pelacakan</p>
                                      <input
                                        type="time"
                                        value={safeGpsTrackingSchedule.startTime}
                                        onChange={(event) =>
                                          safeOnGpsTrackingScheduleChange({ startTime: event.target.value })
                                        }
                                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                      />
                                    </div>
                                    <div>
                                      <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Selesai Pelacakan</p>
                                      <input
                                        type="time"
                                        value={safeGpsTrackingSchedule.endTime}
                                        onChange={(event) =>
                                          safeOnGpsTrackingScheduleChange({ endTime: event.target.value })
                                        }
                                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                      />
                                    </div>
                                  </div>
                                </>
                              ) : null}
                              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                                Status pelacakan saat ini:{" "}
                                <span className={safeIsGpsTrackingActiveNow ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                                  {safeIsGpsTrackingActiveNow ? "Aktif" : "Nonaktif (di luar jadwal)"}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 p-3">
                            <h4 className="text-sm font-semibold text-slate-800">Jadwal Tidur (Jam HP)</h4>
                            <p className="mt-1 text-xs text-slate-500">
                              Jam lokal HP sekarang: {sleepScheduleMetrics.nowLabel} - {sleepScheduleMetrics.dateLabel}
                            </p>
                            <div className="mt-3 space-y-3">
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={sleepScheduleEnabled}
                                  onChange={(event) => setSleepScheduleEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Aktifkan pengingat waktu istirahat
                              </label>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Mulai Tidur</p>
                                  <input
                                    type="time"
                                    value={sleepStartTime}
                                    onChange={(event) => setSleepStartTime(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                                <div>
                                  <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Jam Bangun</p>
                                  <input
                                    type="time"
                                    value={wakeTime}
                                    onChange={(event) => setWakeTime(event.target.value)}
                                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                  />
                                </div>
                              </div>
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Batas Bangun Maksimum (jam)</p>
                                <input
                                  type="number"
                                  min={8}
                                  max={24}
                                  step={1}
                                  value={maxAwakeHours}
                                  onChange={(event) => setMaxAwakeHours(Number(event.target.value || 16))}
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                />
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                Durasi tidur terjadwal: {sleepScheduleMetrics.estimatedSleepHours} jam. Durasi bangun saat ini:{" "}
                                {sleepScheduleMetrics.awakeHours} jam.
                              </div>
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={sleepAutoSyncEnabled}
                                  onChange={(event) => setSleepAutoSyncEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Simpan otomatis durasi tidur saat jam bangun terlewati
                              </label>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                                  Sinkron terakhir: {lastSleepAutoSyncDate || "belum ada"}.
                                </p>
                                <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                                  Koneksi: {navigator.onLine ? "Daring" : "Luring"} | Antrean: {sleepAutoSyncQueue.length} data.
                                </p>
                              </div>
                              {sleepAutoSyncStatus ? (
                                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                                  {sleepAutoSyncStatus}
                                </p>
                              ) : null}
                              {sleepScheduleStatus ? (
                                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                  {sleepScheduleStatus}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          {reminderStatus ? (
                            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                              {reminderStatus}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className={userPageSurfaceClass}>
                        <div className="flex flex-col gap-2 border-b border-slate-200/80 pb-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900">Preferensi Pribadi</h3>
                            <p className="mt-1 text-xs text-slate-500">
                              Kelola privasi data, preferensi ringkasan, dan personalisasi tampilan pengguna.
                            </p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                            Profil Pengguna
                          </span>
                        </div>
                        <div className="mt-4 space-y-4">
                          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                            <h4 className="text-sm font-semibold text-slate-800">Privasi Data Pribadi</h4>
                            <div className="mt-3 space-y-3">
                              <div>
                                <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Visibilitas Profil</p>
                                <select
                                  value={userProfileVisibility}
                                  onChange={(event) =>
                                    setUserProfileVisibility(event.target.value as "private" | "tim_pendamping")
                                  }
                                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                                >
                                  <option value="private">Privat (hanya saya)</option>
                                  <option value="tim_pendamping">Tim pendamping kesehatan</option>
                                </select>
                              </div>
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={userShareAnonymizedInsights}
                                  onChange={(event) => setUserShareAnonymizedInsights(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Izinkan data anonim digunakan untuk analisis aplikasi
                              </label>
                              <label className="flex items-center gap-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={userWeeklyDigestEnabled}
                                  onChange={(event) => setUserWeeklyDigestEnabled(event.target.checked)}
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                Terima ringkasan kesehatan mingguan
                              </label>
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Usia (tahun) untuk rumus BMR</p>
                            <input
                              type="number"
                              min={10}
                              max={120}
                              step={1}
                              value={userAge}
                              onChange={(event) => setUserAge(Number(event.target.value || 25))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                            />
                          </div>
                          <div>
                            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Tema</p>
                            <select
                              value={themeMode}
                              onChange={(event) => setThemeMode(event.target.value as "light" | "dark")}
                              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                            >
                              <option value="light">Terang</option>
                              <option value="dark">Gelap</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200/80 bg-white/95 p-6 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                    <h2 className="text-xl font-semibold text-slate-900">{getMenuLabel(activeMenu)}</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Halaman {getMenuLabel(activeMenu)} sedang disiapkan. Selanjutnya fitur dapat dilengkapi sesuai kebutuhan Anda.
                    </p>
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      {isMobileViewport ? <div className="h-28 lg:hidden" aria-hidden="true" /> : null}
      {isMobileViewport && mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Tutup menu"
            className="absolute inset-0 bg-slate-900/45"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="dashboard-mobile-drawer absolute inset-y-0 left-0 w-[82%] max-w-[330px] overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900">Menu Tambahan</p>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600"
              >
                Tutup
              </button>
            </div>
            <div className="space-y-2">
              {mobileDrawerMenuItems.map((item) => (
                <button
                  key={getMenuLabel(item)}
                  type="button"
                  onClick={() => setActiveMenu(item)}
                  className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                    activeMenu === item
                      ? "border-slate-900 bg-slate-900 text-white shadow-[0_14px_24px_-18px_rgba(15,23,42,0.75)]"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      {renderNavIcon(getMenuIcon(item))}
                      {getMenuLabel(item)}
                    </span>
                    <span className="text-xs opacity-70">{">"}</span>
                  </span>
                </button>
              ))}
              {safeRole === "user" ? (
                <button
                  type="button"
                  onClick={openCommunication}
                  className="w-full rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-left text-sm font-semibold text-cyan-700 transition hover:bg-cyan-100"
                >
                  <span className="inline-flex items-center gap-2">
                    {renderNavIcon("education")}
                    Ringkasan AI Kesehatan
                  </span>
                </button>
              ) : null}
            </div>
            <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Gunakan menu bawah untuk akses cepat. Panel ini berisi halaman tambahan.
            </p>
          </aside>
        </div>
      ) : null}
      {isMobileViewport ? (
        <nav
          data-nav-mode={interfaceMode}
          className={`fixed inset-x-3 z-40 rounded-2xl border px-2 pt-2 shadow-[0_18px_35px_-18px_rgba(15,23,42,0.45)] lg:hidden ${
            safeRole === "admin" ? "border-blue-200/80 bg-[#eef4ff]/95" : "border-slate-200/90 bg-white/95"
          }`}
          style={{
            bottom: "max(0.65rem, env(safe-area-inset-bottom))",
            paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          }}
        >
          {safeRole === "admin" ? (
            <button
              type="button"
              onClick={() => setActiveMenu("Alert & Tindak Lanjut")}
              className="absolute -top-11 right-3 rounded-full bg-[#c8953c] px-4 py-2 text-xs font-semibold text-white shadow-[0_16px_24px_-18px_rgba(15,23,42,0.9)]"
            >
              + Input
            </button>
          ) : null}
          <div className="grid grid-cols-5 gap-1">
            {mobilePrimaryNavItems.map((item) => {
              const isActive = activeMenu === item.menu;
              return (
                <button
                  key={item.menu}
                  type="button"
                  onClick={() => setActiveMenu(item.menu)}
                  className={`rounded-xl px-2 py-1.5 text-[11px] font-semibold transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-[0_12px_20px_-12px_rgba(15,23,42,0.8)]"
                      : "bg-transparent text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="flex flex-col items-center gap-1">
                    <span className={isActive ? "opacity-100" : "opacity-80"}>{renderNavIcon(item.icon)}</span>
                    <span className="leading-none">{item.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
    </div>
  );
};

export default Dashboard;





