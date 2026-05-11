// Health Data Types
export type HealthData = {
  id: string;
  timestamp?: { toDate?: () => Date; toMillis?: () => number } | null;
  steps: number;
  height: number;
  weight: number;
  calories: number;
  sleep: number;
  heartRate: number;
  bloodPressure: string;
  meals: string;
  ownerEmail?: string;
  ownerUid?: string;
  source?: string;
};

// Dashboard Props
export type DashboardProps = {
  data: HealthData[];
  latest?: HealthData | undefined;
  userDirectory?: Array<{
    ownerUid: string;
    ownerEmail: string;
    fullName: string;
    username: string;
    lastLoginAtMs: number | null;
    updatedAtMs: number | null;
    createdAtMs: number | null;
  }>;
  userGender?: "pria" | "wanita" | "tidak_ditentukan";
  userDisplayName?: string;
  userEmail?: string;
  role?: "admin" | "user";
  adminScope?: "none" | "operator" | "super_admin";
  adminRoster?: string[];
  superAdminRoster?: string[];
  gpsSyncStatus?: {
    isOnline: boolean;
    pendingSyncCount: number;
    lastSampleAtMs: number | null;
    isFlushing: boolean;
    lastFlushAtMs: number | null;
    lastFlushResult: "idle" | "success" | "error";
    lastFlushError: string | null;
    lastFlushedCount: number;
  };
  gpsTrackingSchedule?: {
    mode: "always" | "scheduled";
    days: number[];
    startTime: string;
    endTime: string;
  };
  isGpsTrackingActiveNow?: boolean;
  onManualUserInput?: (payload: { sleep: number; meals: string; heartRate: number; bloodPressure: string }) => Promise<void>;
  onRequestGpsSyncNow?: () => Promise<void>;
  onClearGpsQueue?: () => void;
  onGpsTrackingScheduleChange?: (patch: {
    mode?: "always" | "scheduled";
    days?: number[];
    startTime?: string;
    endTime?: string;
  }) => void;
  activitySessionActive?: boolean;
  activitySessionSummary?: {
    startedAtMs: number | null;
    updatedAtMs: number | null;
    steps: number;
    distanceMeters: number;
    calories: number;
  };
  onStartActivitySession?: () => void;
  onStopActivitySession?: () => void;
  onSignOut: () => void;
};

// Component Props
export type RingStatCardProps = {
  title: string;
  value: string;
  caption: string;
  percent: number;
  color: string;
  variant?: "default" | "glass";
};

// Data Structures
export type PersonalPeriodPoint = {
  dateKey: string;
  label: string;
  steps: number;
  sleep: number;
  calories: number;
};

export type PersonalPeriodRecord = {
  id: string;
  millis: number;
  dayLabel: string;
  dateLabel: string;
  timeLabel: string;
  steps: number;
  height: number;
  weight: number;
  calories: number;
  sleep: number;
  heartRate: number;
  bloodPressure: string;
  meals: string;
};

export type SleepAutoSyncQueueItem = {
  dateKey: string;
  sleep: number;
  meals: string;
  createdAt: number;
};

// Admin Types
export type AdminEducationEntry = {
  id: string;
  title: string;
  category: "nutrisi" | "aktivitas" | "tidur" | "jantung";
  summary: string;
  status: "published" | "draft";
  updatedAt: number;
};

export type AdminBroadcastLog = {
  id: string;
  segment: "semua" | "risiko_tinggi" | "risiko_sedang" | "alert_terbuka";
  message: string;
  recipientCount: number;
  createdAt: number;
};

export type AdminTimelineEntry = {
  id: string;
  ownerEmail: string;
  fromStatus: "baru" | "diproses" | "selesai";
  toStatus: "baru" | "diproses" | "selesai";
  createdAt: number;
  actorEmail: string;
};

export type AdminSettingsChangeLog = {
  id: string;
  area: string;
  field: string;
  oldValue: string;
  newValue: string;
  sensitive: boolean;
  reason: string;
  actorEmail: string;
  changedAt: number;
};

// Speech Recognition Types
export type SpeechRecognitionAlternativeLike = { transcript: string };
export type SpeechRecognitionResultLike = { 0: SpeechRecognitionAlternativeLike };
export type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
export type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

export type NavIconName = "home" | "data" | "education" | "alerts" | "settings" | "history" | "more";
