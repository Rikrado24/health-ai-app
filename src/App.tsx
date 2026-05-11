import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore";
import { bootstrapAuthSession, type AdminScope, type UserRole } from "./services/authSession";
import { auth, db, firebaseConfigError } from "./services/firebase";
import { startLocationActivityTracker } from "./services/locationActivityTracker";
import PwaInstallPrompt from "./components/PwaInstallPrompt";
const Login = lazy(() => import("./pages/login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));

type HealthRecord = {
  id: string;
  steps: number;
  height: number;
  weight: number;
  calories: number;
  sleep: number;
  heartRate: number;
  bloodPressure: string;
  meals: string;
  ownerEmail: string;
  ownerUid: string;
  source: string;
};

type FirestoreHealthData = HealthRecord & { timestamp: Timestamp | null };
type UserGender = "pria" | "wanita" | "tidak_ditentukan";

type CalorieEstimateInput = {
  steps: number;
  weightKg: number;
  heightCm: number;
};

type DeviceVitals = {
  id: string;
  ownerEmail: string;
  heartRate: number;
  bloodPressure: string;
  timestamp: Timestamp | null;
};

type DeviceActivity = {
  id: string;
  ownerEmail: string;
  steps: number;
  calories: number;
  timestamp: Timestamp | null;
};

type GpsSyncStatus = {
  isOnline: boolean;
  pendingSyncCount: number;
  lastSampleAtMs: number | null;
  isFlushing: boolean;
  lastFlushAtMs: number | null;
  lastFlushResult: "idle" | "success" | "error";
  lastFlushError: string | null;
  lastFlushedCount: number;
};

type GpsTrackingMode = "always" | "scheduled";

type GpsTrackingSchedule = {
  mode: GpsTrackingMode;
  days: number[];
  startTime: string;
  endTime: string;
};

type UserDirectoryEntry = {
  ownerUid: string;
  ownerEmail: string;
  fullName: string;
  username: string;
  lastLoginAtMs: number | null;
  updatedAtMs: number | null;
  createdAtMs: number | null;
};

type DeviceActivityWritePayload = {
  ownerEmail: string;
  ownerUid: string;
  steps: number;
  calories: number;
  distanceMeters: number;
  speedMps: number;
  source: string;
};

type QueuedDeviceActivityWrite = DeviceActivityWritePayload & {
  queuedAt: number;
};

const LOCATION_ACTIVITY_QUEUE_KEY = "pending-device-activity-writes-v1";
const GPS_TRACKING_SCHEDULE_KEY = "gps-tracking-schedule-v1";
const ACTIVITY_SESSION_ACTIVE_KEY = "activity-session-active-v1";
const MAX_QUEUED_ACTIVITY_WRITES = 400;

const DEFAULT_GPS_TRACKING_SCHEDULE: GpsTrackingSchedule = {
  mode: "scheduled",
  days: [0, 6],
  startTime: "05:30",
  endTime: "09:30",
};

const loadPendingActivityWrites = (): QueuedDeviceActivityWrite[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCATION_ACTIVITY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedDeviceActivityWrite[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.ownerEmail === "string" &&
        typeof item.ownerUid === "string" &&
        typeof item.steps === "number" &&
        typeof item.calories === "number" &&
        typeof item.distanceMeters === "number" &&
        typeof item.speedMps === "number"
    ).map((item) => ({
      ownerEmail: item.ownerEmail,
      ownerUid: item.ownerUid,
      steps: item.steps,
      calories: item.calories,
      distanceMeters: item.distanceMeters,
      speedMps: item.speedMps,
      source: typeof item.source === "string" ? item.source : "location_tracker",
      queuedAt: typeof item.queuedAt === "number" ? item.queuedAt : Date.now(),
    }));
  } catch {
    return [];
  }
};

const savePendingActivityWrites = (queue: QueuedDeviceActivityWrite[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCATION_ACTIVITY_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUED_ACTIVITY_WRITES)));
  } catch {
    // ignore storage write errors
  }
};

const parseTimeToMinutes = (value: string) => {
  const [rawHour, rawMinute] = value.split(":");
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
};

const normalizeTrackingSchedule = (raw: Partial<GpsTrackingSchedule> | null | undefined): GpsTrackingSchedule => {
  const mode: GpsTrackingMode = raw?.mode === "always" ? "always" : "scheduled";
  const days = Array.isArray(raw?.days)
    ? raw.days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : DEFAULT_GPS_TRACKING_SCHEDULE.days;
  const startTime = typeof raw?.startTime === "string" && parseTimeToMinutes(raw.startTime) !== null
    ? raw.startTime
    : DEFAULT_GPS_TRACKING_SCHEDULE.startTime;
  const endTime = typeof raw?.endTime === "string" && parseTimeToMinutes(raw.endTime) !== null
    ? raw.endTime
    : DEFAULT_GPS_TRACKING_SCHEDULE.endTime;

  return {
    mode,
    days: days.length > 0 ? Array.from(new Set(days)) : [...DEFAULT_GPS_TRACKING_SCHEDULE.days],
    startTime,
    endTime,
  };
};

const loadGpsTrackingSchedule = (): GpsTrackingSchedule => {
  if (typeof window === "undefined") return DEFAULT_GPS_TRACKING_SCHEDULE;
  try {
    const raw = window.localStorage.getItem(GPS_TRACKING_SCHEDULE_KEY);
    if (!raw) return DEFAULT_GPS_TRACKING_SCHEDULE;
    const parsed = JSON.parse(raw) as Partial<GpsTrackingSchedule>;
    return normalizeTrackingSchedule(parsed);
  } catch {
    return DEFAULT_GPS_TRACKING_SCHEDULE;
  }
};

const saveGpsTrackingSchedule = (schedule: GpsTrackingSchedule) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GPS_TRACKING_SCHEDULE_KEY, JSON.stringify(schedule));
  } catch {
    // ignore storage write errors
  }
};

const loadActivitySessionActive = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ACTIVITY_SESSION_ACTIVE_KEY) === "true";
  } catch {
    return false;
  }
};

const saveActivitySessionActive = (active: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVITY_SESSION_ACTIVE_KEY, active ? "true" : "false");
  } catch {
    // ignore storage write errors
  }
};

const estimateCaloriesFromSteps = ({ steps, weightKg, heightCm }: CalorieEstimateInput) => {
  if (steps <= 0) return 0;

  // Stride-based distance approximation personalized by height.
  const effectiveHeight = heightCm > 0 ? heightCm : 165;
  const strideMeters = effectiveHeight * 0.00413;
  const distanceKm = (steps * strideMeters) / 1000;

  // Cadence-based walk duration approximation (moderate walk default).
  const cadence = 100; // steps/min
  const minutes = steps / cadence;
  const hours = Math.max(minutes / 60, 1 / 60);
  const speedKmh = distanceKm / hours;

  // MET table approximation based on walking speed.
  let met = 2.8;
  if (speedKmh >= 6) met = 4.8;
  else if (speedKmh >= 5) met = 4.3;
  else if (speedKmh >= 4) met = 3.5;

  const effectiveWeight = weightKg > 0 ? weightKg : 65;
  return Math.max(0, Math.round(met * effectiveWeight * hours));
};

const mapSessionError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return "Gagal menyiapkan sesi aplikasi. Coba masuk ulang.";
  }

  switch (error.message) {
    case "UNAUTHORIZED":
      return "Sesi login tidak valid. Silakan masuk ulang.";
    case "SESSION_BOOTSTRAP_FAILED":
      return "Gagal sinkronisasi sesi aplikasi. Coba muat ulang halaman.";
    default:
      return "Gagal menyiapkan akses aplikasi. Silakan coba lagi.";
  }
};

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [data, setData] = useState<FirestoreHealthData[]>([]);
  const [firebaseError, setFirebaseError] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [userGender, setUserGender] = useState<UserGender>("tidak_ditentukan");
  const [userDisplayName, setUserDisplayName] = useState("");
  const [userDirectory, setUserDirectory] = useState<UserDirectoryEntry[]>([]);
  const [role, setRole] = useState<UserRole>("user");
  const [adminScope, setAdminScope] = useState<AdminScope>("none");
  const [adminRoster, setAdminRoster] = useState<string[]>([]);
  const [superAdminRoster, setSuperAdminRoster] = useState<string[]>([]);
  const [gpsSyncStatus, setGpsSyncStatus] = useState<GpsSyncStatus>(() => ({
    isOnline: typeof window !== "undefined" ? window.navigator.onLine : true,
    pendingSyncCount: loadPendingActivityWrites().length,
    lastSampleAtMs: null,
    isFlushing: false,
    lastFlushAtMs: null,
    lastFlushResult: "idle",
    lastFlushError: null,
    lastFlushedCount: 0,
  }));
  const [gpsTrackingSchedule, setGpsTrackingSchedule] = useState<GpsTrackingSchedule>(() => loadGpsTrackingSchedule());
  const [activitySessionActive, setActivitySessionActive] = useState<boolean>(() => loadActivitySessionActive());
  const [activitySessionSummary, setActivitySessionSummary] = useState<{
    startedAtMs: number | null;
    updatedAtMs: number | null;
    steps: number;
    distanceMeters: number;
    calories: number;
  }>({
    startedAtMs: null,
    updatedAtMs: null,
    steps: 0,
    distanceMeters: 0,
    calories: 0,
  });
  const latestDataRef = useRef<FirestoreHealthData | undefined>(undefined);
  const lastDeviceVitalIdRef = useRef<string>("");
  const lastDeviceActivityIdRef = useRef<string>("");
  const pendingActivityWritesRef = useRef<QueuedDeviceActivityWrite[]>(loadPendingActivityWrites());
  const flushingPendingActivityRef = useRef(false);
  const isGpsTrackingActiveNow = useMemo(() => (role === "user" ? activitySessionActive : false), [activitySessionActive, role]);

  const enqueuePendingActivityWrite = useCallback((payload: DeviceActivityWritePayload) => {
    const queue = pendingActivityWritesRef.current;
    queue.push({ ...payload, queuedAt: Date.now() });
    if (queue.length > MAX_QUEUED_ACTIVITY_WRITES) {
      queue.splice(0, queue.length - MAX_QUEUED_ACTIVITY_WRITES);
    }
    savePendingActivityWrites(queue);
    setGpsSyncStatus((prev) => ({ ...prev, pendingSyncCount: queue.length }));
  }, []);

  const flushPendingActivityWrites = useCallback(async () => {
    if (role !== "user") return;
    if (!user?.uid || !user?.email) return;
    const signedInEmail = user.email;
    if (!signedInEmail) return;
    if (typeof window === "undefined" || !window.navigator.onLine) return;
    if (flushingPendingActivityRef.current) return;

    const queue = pendingActivityWritesRef.current;
    if (queue.length === 0) return;

    flushingPendingActivityRef.current = true;
    setGpsSyncStatus((prev) => ({ ...prev, isFlushing: true }));
    const remaining: QueuedDeviceActivityWrite[] = [];
    let syncFailed = false;
    let syncedCount = 0;
    let flushErrorMessage: string | null = null;

    try {
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        if (item.ownerUid !== user.uid || item.ownerEmail !== signedInEmail) {
          remaining.push(item);
          continue;
        }

        try {
          await addDoc(collection(db, "deviceActivity"), {
            ownerEmail: item.ownerEmail,
            ownerUid: item.ownerUid,
            steps: item.steps,
            calories: item.calories,
            distanceMeters: item.distanceMeters,
            speedMps: item.speedMps,
            source: "location_tracker_offline_sync",
            timestamp: serverTimestamp(),
          });
          syncedCount += 1;
        } catch (error) {
          syncFailed = true;
          flushErrorMessage = error instanceof Error ? error.message : "Gagal sinkronisasi antrean GPS.";
          remaining.push(item, ...queue.slice(index + 1));
          break;
        }
      }
    } finally {
      pendingActivityWritesRef.current = remaining;
      savePendingActivityWrites(remaining);
      setGpsSyncStatus((prev) => ({
        ...prev,
        pendingSyncCount: remaining.length,
        isFlushing: false,
        lastFlushAtMs: syncFailed || syncedCount > 0 ? Date.now() : prev.lastFlushAtMs,
        lastFlushResult: syncFailed ? "error" : syncedCount > 0 ? "success" : prev.lastFlushResult,
        lastFlushError: syncFailed ? flushErrorMessage : syncedCount > 0 ? null : prev.lastFlushError,
        lastFlushedCount: syncFailed || syncedCount > 0 ? syncedCount : prev.lastFlushedCount,
      }));
      flushingPendingActivityRef.current = false;
    }
  }, [role, user?.uid, user?.email]);

  useEffect(() => {
    if (firebaseConfigError) {
      setLoading(false);
      setSessionLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setSessionError("");
      if (!u) {
        setRole("user");
        setAdminScope("none");
        setAdminRoster([]);
        setSuperAdminRoster([]);
        setSessionLoading(false);
        setUserGender("tidak_ditentukan");
        setUserDisplayName("");
      } else {
        setSessionLoading(true);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;

    let active = true;
    setSessionError("");
    setSessionLoading(true);

    void bootstrapAuthSession(user)
      .then((session) => {
        if (!active) return;
        setRole(session.role);
        setAdminScope(session.adminScope);
        setAdminRoster(session.adminRoster);
        setSuperAdminRoster(session.superAdminRoster);
      })
      .catch((error) => {
        if (!active) return;
        setRole("user");
        setAdminScope("none");
        setAdminRoster([]);
        setSuperAdminRoster([]);
        setSessionError(mapSessionError(error));
      })
      .finally(() => {
        if (!active) return;
        setSessionLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user?.uid || !user?.email) return;
    void setDoc(
      doc(db, "userProfiles", user.uid),
      {
        ownerUid: user.uid,
        ownerEmail: user.email,
        fullName: user.displayName ?? "",
        lastLoginAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }, [user?.uid, user?.email, user?.displayName]);

  useEffect(() => {
    if (!user?.email) return;
    const q = role === "admin" ? collection(db, "healthData") : query(collection(db, "healthData"), where("ownerEmail", "==", user.email));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr: FirestoreHealthData[] = [];
        snap.forEach((doc) => {
          const raw = doc.data() as Partial<FirestoreHealthData>;
          arr.push({
            id: doc.id,
            timestamp: raw.timestamp ?? null,
            steps: Number(raw.steps ?? 0),
            height: Number(raw.height ?? 0),
            weight: Number(raw.weight ?? 0),
            calories: Number(raw.calories ?? 0),
            sleep: Number(raw.sleep ?? 0),
            heartRate: Number(raw.heartRate ?? 0),
            bloodPressure: String(raw.bloodPressure ?? "0/0"),
            meals: String(raw.meals ?? "-"),
            ownerEmail: String(raw.ownerEmail ?? ""),
            ownerUid: String(raw.ownerUid ?? ""),
            source: String(raw.source ?? "unknown"),
          });
        });
        arr.sort((a, b) => {
          const at = a.timestamp?.toMillis?.() ?? 0;
          const bt = b.timestamp?.toMillis?.() ?? 0;
          return at - bt;
        });
        // Backfill calories per record with personalized estimate if raw calories not available.
        let lastKnownWeight = 0;
        let lastKnownHeight = 0;
        const enriched = arr.map((item) => {
          if (item.weight > 0) lastKnownWeight = item.weight;
          if (item.height > 0) lastKnownHeight = item.height;

          const weightForEstimate = item.weight > 0 ? item.weight : lastKnownWeight;
          const heightForEstimate = item.height > 0 ? item.height : lastKnownHeight;
          const estimatedCalories = estimateCaloriesFromSteps({
            steps: item.steps,
            weightKg: weightForEstimate,
            heightCm: heightForEstimate,
          });

          return {
            ...item,
            calories: item.calories > 0 ? item.calories : estimatedCalories,
          };
        });

        setData(enriched);
        setFirebaseError("");
      },
      (error) => {
        setFirebaseError(error.message || "Gagal membaca data Firebase.");
      }
    );
    return unsub;
  }, [role, user?.email]);

  useEffect(() => {
    if (!user?.uid) return;

    const ref = doc(db, "userProfiles", user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const profile = snap.data() ?? {};
        const rawGender = String(snap.data()?.gender ?? "tidak_ditentukan").toLowerCase();
        if (rawGender === "pria" || rawGender === "wanita") {
          setUserGender(rawGender);
        } else {
          setUserGender("tidak_ditentukan");
        }
        const fullName = String(profile.fullName ?? "").trim();
        const fallbackName = String(user.displayName ?? "").trim();
        setUserDisplayName(fullName || fallbackName || "Pengguna");
      },
      () => {
        setUserGender("tidak_ditentukan");
        const fallbackName = String(user.displayName ?? "").trim();
        setUserDisplayName(fallbackName || "Pengguna");
      }
    );

    return unsub;
  }, [user?.uid, user?.displayName]);

  useEffect(() => {
    if (role !== "admin") {
      setUserDirectory([]);
      return;
    }

    const toMillis = (value: unknown) => {
      if (!value || typeof value !== "object") return null;
      const maybe = value as { toMillis?: () => number; toDate?: () => Date };
      if (typeof maybe.toMillis === "function") return maybe.toMillis();
      if (typeof maybe.toDate === "function") return maybe.toDate().getTime();
      return null;
    };

    const unsub = onSnapshot(
      collection(db, "userProfiles"),
      (snap) => {
        const rows: UserDirectoryEntry[] = [];
        snap.forEach((item) => {
          const raw = item.data() as Record<string, unknown>;
          rows.push({
            ownerUid: String(raw.ownerUid ?? item.id ?? ""),
            ownerEmail: String(raw.ownerEmail ?? ""),
            fullName: String(raw.fullName ?? ""),
            username: String(raw.username ?? ""),
            lastLoginAtMs: toMillis(raw.lastLoginAt),
            updatedAtMs: toMillis(raw.updatedAt),
            createdAtMs: toMillis(raw.createdAt),
          });
        });

        rows.sort((a, b) => {
          const at = a.lastLoginAtMs ?? a.updatedAtMs ?? a.createdAtMs ?? 0;
          const bt = b.lastLoginAtMs ?? b.updatedAtMs ?? b.createdAtMs ?? 0;
          return bt - at;
        });
        setUserDirectory(rows);
      },
      () => {
        setUserDirectory([]);
      }
    );

    return unsub;
  }, [role]);

  useEffect(() => {
    latestDataRef.current = data[data.length - 1];
  }, [data]);

  useEffect(() => {
    if (role !== "user") return;
    if (!user?.email) return;

    const q = query(
      collection(db, "deviceVitals"),
      where("ownerEmail", "==", user.email)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const vitals: DeviceVitals[] = [];
        snap.forEach((doc) => {
          const raw = doc.data() as Partial<DeviceVitals>;
          vitals.push({
            id: doc.id,
            ownerEmail: String(raw.ownerEmail ?? ""),
            heartRate: Number(raw.heartRate ?? 0),
            bloodPressure: String(raw.bloodPressure ?? "0/0"),
            timestamp: raw.timestamp ?? null,
          });
        });

        if (vitals.length === 0) return;
        vitals.sort((a, b) => {
          const at = a.timestamp?.toMillis?.() ?? 0;
          const bt = b.timestamp?.toMillis?.() ?? 0;
          return bt - at;
        });

        const latestVital = vitals[0];
        if (!latestVital?.id) return;
        if (lastDeviceVitalIdRef.current === latestVital.id) return;

        const latest = latestDataRef.current;
        await addDoc(collection(db, "healthData"), {
          timestamp: serverTimestamp(),
          steps: Number(latest?.steps ?? 0),
          height: Number(latest?.height ?? 0),
          weight: Number(latest?.weight ?? 0),
          calories: Number(latest?.calories ?? 0),
          sleep: Number(latest?.sleep ?? 0),
          heartRate: Number(latestVital.heartRate ?? 0),
          bloodPressure: String(latestVital.bloodPressure ?? "0/0"),
          meals: String(latest?.meals ?? "-"),
          source: "device_vitals",
          ownerEmail: user.email,
          ownerUid: user.uid,
        });

        lastDeviceVitalIdRef.current = latestVital.id;
      },
      () => {
        // keep app running even if optional device stream is unavailable
      }
    );

    return unsub;
  }, [role, user?.email, user?.uid]);

  useEffect(() => {
    saveGpsTrackingSchedule(gpsTrackingSchedule);
  }, [gpsTrackingSchedule]);

  useEffect(() => {
    saveActivitySessionActive(activitySessionActive);
  }, [activitySessionActive]);

  useEffect(() => {
    if (role !== "user" || !user?.uid || !user?.email) {
      setActivitySessionActive(false);
    }
  }, [role, user?.uid, user?.email]);

  useEffect(() => {
    if (role !== "user") return;
    if (!user?.email) return;
    if (!activitySessionActive) return;

    void flushPendingActivityWrites();

    const stopTracker = startLocationActivityTracker({
      heightCm: Number(latestDataRef.current?.height ?? 0),
      weightKg: Number(latestDataRef.current?.weight ?? 0),
      onSample: (sample) => {
        setGpsSyncStatus((prev) => ({ ...prev, lastSampleAtMs: sample.timestampMs }));
        setActivitySessionSummary((prev) => ({
          startedAtMs: prev.startedAtMs ?? Date.now(),
          updatedAtMs: sample.timestampMs,
          steps: sample.steps,
          distanceMeters: sample.distanceMeters,
          calories: sample.calories,
        }));
      },
      onError: () => {
        // ignore geolocation errors; app can still run with manual/device streams
      },
    });

    return () => {
      stopTracker();
    };
  }, [activitySessionActive, flushPendingActivityWrites, role, user?.email]);

  useEffect(() => {
    if (role !== "user") return;
    if (!user?.uid || !user?.email) return;

    const handleOnline = () => {
      setGpsSyncStatus((prev) => ({ ...prev, isOnline: true }));
      void flushPendingActivityWrites();
    };
    const handleOffline = () => {
      setGpsSyncStatus((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [flushPendingActivityWrites, role, user?.uid, user?.email]);

  useEffect(() => {
    if (role !== "user") return;
    if (!user?.uid || !user?.email) return;
    const intervalId = window.setInterval(() => {
      if (!window.navigator.onLine) return;
      void flushPendingActivityWrites();
    }, 30000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [flushPendingActivityWrites, role, user?.uid, user?.email]);

  useEffect(() => {
    if (role !== "user") return;
    if (!user?.uid || !user?.email) return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (!window.navigator.onLine) return;
      void flushPendingActivityWrites();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushPendingActivityWrites, role, user?.uid, user?.email]);

  useEffect(() => {
    if (role !== "user") return;
    if (!user?.email) return;

    const q = query(
      collection(db, "deviceActivity"),
      where("ownerEmail", "==", user.email)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const activities: DeviceActivity[] = [];
        snap.forEach((doc) => {
          const raw = doc.data() as Partial<DeviceActivity>;
          activities.push({
            id: doc.id,
            ownerEmail: String(raw.ownerEmail ?? ""),
            steps: Number(raw.steps ?? 0),
            calories: Number(raw.calories ?? 0),
            timestamp: raw.timestamp ?? null,
          });
        });

        if (activities.length === 0) return;
        activities.sort((a, b) => {
          const at = a.timestamp?.toMillis?.() ?? 0;
          const bt = b.timestamp?.toMillis?.() ?? 0;
          return bt - at;
        });

        const latestActivity = activities[0];
        if (!latestActivity?.id) return;
        if (lastDeviceActivityIdRef.current === latestActivity.id) return;

        const latest = latestDataRef.current;
        const calories =
          latestActivity.calories > 0
            ? latestActivity.calories
            : estimateCaloriesFromSteps({
                steps: latestActivity.steps,
                weightKg: Number(latest?.weight ?? 0),
                heightCm: Number(latest?.height ?? 0),
              });

        await addDoc(collection(db, "healthData"), {
          timestamp: serverTimestamp(),
          steps: Number(latestActivity.steps ?? 0),
          height: Number(latest?.height ?? 0),
          weight: Number(latest?.weight ?? 0),
          calories,
          sleep: Number(latest?.sleep ?? 0),
          heartRate: Number(latest?.heartRate ?? 0),
          bloodPressure: String(latest?.bloodPressure ?? "0/0"),
          meals: String(latest?.meals ?? "-"),
          source: "device_activity",
          ownerEmail: user.email,
          ownerUid: user.uid,
        });

        lastDeviceActivityIdRef.current = latestActivity.id;
      },
      () => {
        // keep app running even if optional activity stream is unavailable
      }
    );

    return unsub;
  }, [role, user?.email, user?.uid]);

  if (firebaseConfigError) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.14),transparent_34%),linear-gradient(160deg,#f5f9ff_0%,#f8fbff_100%)] p-6 text-slate-800">
        <div className="mx-auto max-w-2xl rounded-3xl border border-amber-200/80 bg-white/95 p-6 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
          <h2 className="text-lg font-semibold text-amber-700 [font-family:var(--font-display)]">Konfigurasi Firebase Belum Lengkap</h2>
          <p className="mt-2 text-sm text-slate-700">{firebaseConfigError}</p>
        </div>
      </div>
    );
  }

  if (loading || sessionLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.14),transparent_34%),linear-gradient(160deg,#f5f9ff_0%,#f8fbff_100%)] px-4 text-slate-700">
        <div className="rounded-3xl border border-white/80 bg-white/95 px-7 py-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-r-transparent" />
            Menyiapkan dashboard...
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.14),transparent_34%),linear-gradient(160deg,#f5f9ff_0%,#f8fbff_100%)] px-4 text-slate-700">
            <div className="rounded-3xl border border-white/80 bg-white/95 px-7 py-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
              <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-r-transparent" />
                Membuka halaman login...
              </div>
            </div>
          </div>
        }
      >
        <Login />
      </Suspense>
    );
  }

  if (firebaseError) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(251,113,133,0.16),transparent_34%),linear-gradient(160deg,#fff5f8_0%,#fff8fa_100%)] p-6 text-slate-800">
        <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200/80 bg-white/95 p-6 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
          <h2 className="text-lg font-semibold text-rose-700 [font-family:var(--font-display)]">Firebase Error</h2>
          <p className="mt-2 text-sm text-slate-700">{firebaseError}</p>
          <button
            onClick={() => signOut(auth)}
            className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white"
          >
            Keluar
          </button>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_12%_0%,rgba(251,113,133,0.16),transparent_34%),linear-gradient(160deg,#fff5f8_0%,#fff8fa_100%)] p-6 text-slate-800">
        <div className="mx-auto max-w-2xl rounded-3xl border border-rose-200/80 bg-white/95 p-6 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
          <h2 className="text-lg font-semibold text-rose-700 [font-family:var(--font-display)]">Session Error</h2>
          <p className="mt-2 text-sm text-slate-700">{sessionError}</p>
          <button
            onClick={() => signOut(auth)}
            className="mt-4 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white"
          >
            Keluar
          </button>
        </div>
      </div>
    );
  }

  const latest = data[data.length - 1];

  const handleManualUserInput = async (payload: {
    sleep: number;
    meals: string;
    heartRate: number;
    bloodPressure: string;
  }) => {
    if (!user?.email) return;
    const latestRecord = data[data.length - 1];
    await addDoc(collection(db, "healthData"), {
      timestamp: serverTimestamp(),
      steps: Number(latestRecord?.steps ?? 0),
      height: Number(latestRecord?.height ?? 0),
      weight: Number(latestRecord?.weight ?? 0),
      calories: Number(latestRecord?.calories ?? 0),
      sleep: Number(payload.sleep ?? 0),
      heartRate: Number(payload.heartRate ?? latestRecord?.heartRate ?? 0),
      bloodPressure: String(payload.bloodPressure ?? latestRecord?.bloodPressure ?? "0/0"),
      meals: String(payload.meals ?? "-"),
      source: "manual_user_input",
      ownerEmail: user.email,
      ownerUid: user.uid,
    });
  };
  const handleRequestGpsSyncNow = async () => {
    await flushPendingActivityWrites();
  };
  const handleClearGpsQueue = () => {
    pendingActivityWritesRef.current = [];
    savePendingActivityWrites([]);
    setGpsSyncStatus((prev) => ({
      ...prev,
      pendingSyncCount: 0,
      lastFlushResult: "idle",
      lastFlushError: null,
      lastFlushedCount: 0,
    }));
  };
  const handleGpsTrackingScheduleChange = (patch: Partial<GpsTrackingSchedule>) => {
    setGpsTrackingSchedule((prev) => normalizeTrackingSchedule({ ...prev, ...patch }));
  };
  const handleStartActivitySession = () => {
    const startedAt = Date.now();
    setActivitySessionSummary({
      startedAtMs: startedAt,
      updatedAtMs: startedAt,
      steps: 0,
      distanceMeters: 0,
      calories: 0,
    });
    setActivitySessionActive(true);
  };
  const handleStopActivitySession = () => {
    const summary = activitySessionSummary;
    if (role === "user" && user?.uid && user.email && summary.steps > 0) {
      const startedAtMs = summary.startedAtMs ?? Date.now();
      const updatedAtMs = summary.updatedAtMs ?? startedAtMs;
      const durationSeconds = Math.max(1, Math.round((updatedAtMs - startedAtMs) / 1000));
      const speedMps = Math.max(0, summary.distanceMeters / durationSeconds);
      const payload: DeviceActivityWritePayload = {
        ownerEmail: user.email,
        ownerUid: user.uid,
        steps: summary.steps,
        calories: summary.calories,
        distanceMeters: summary.distanceMeters,
        speedMps,
        source: "activity_session_summary",
      };

      if (!window.navigator.onLine) {
        enqueuePendingActivityWrite(payload);
      } else {
        void addDoc(collection(db, "deviceActivity"), {
          ...payload,
          timestamp: serverTimestamp(),
        }).catch(() => {
          enqueuePendingActivityWrite(payload);
        });
      }
    }
    setActivitySessionActive(false);
  };

  return (
    <>
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,0.14),transparent_34%),linear-gradient(160deg,#f5f9ff_0%,#f8fbff_100%)] px-4 text-slate-700">
            <div className="rounded-3xl border border-white/80 bg-white/95 px-7 py-5 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.45)] backdrop-blur">
              <div className="flex items-center gap-3 text-sm font-medium text-slate-700">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-500 border-r-transparent" />
                Memuat tampilan aplikasi...
              </div>
            </div>
          </div>
        }
      >
        <Dashboard
          data={data}
          latest={latest}
          userDirectory={userDirectory}
          userGender={userGender}
          userDisplayName={userDisplayName}
          userEmail={user.email ?? ""}
          role={role}
          adminScope={adminScope}
          adminRoster={adminRoster}
          superAdminRoster={superAdminRoster}
          gpsSyncStatus={gpsSyncStatus}
          gpsTrackingSchedule={gpsTrackingSchedule}
          isGpsTrackingActiveNow={isGpsTrackingActiveNow}
          onManualUserInput={handleManualUserInput}
          onRequestGpsSyncNow={handleRequestGpsSyncNow}
          onClearGpsQueue={handleClearGpsQueue}
          onGpsTrackingScheduleChange={handleGpsTrackingScheduleChange}
          activitySessionActive={activitySessionActive}
          activitySessionSummary={activitySessionSummary}
          onStartActivitySession={handleStartActivitySession}
          onStopActivitySession={handleStopActivitySession}
          onSignOut={() => signOut(auth)}
        />
      </Suspense>
      <PwaInstallPrompt role={role} />
    </>
  );
}

export default App;
