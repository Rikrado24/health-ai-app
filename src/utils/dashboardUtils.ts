/**
 * Color & Theme Utilities
 */
export const normalizeHex = (hex: string) => {
  const cleaned = hex.replace("#", "").trim();
  if (cleaned.length === 3) {
    return `#${cleaned
      .split("")
      .map((char) => char + char)
      .join("")}`;
  }
  if (cleaned.length === 6) return `#${cleaned}`;
  return "#2563eb";
};

export const hexToRgb = (hex: string) => {
  const normalized = normalizeHex(hex);
  const intValue = parseInt(normalized.slice(1), 16);
  return {
    r: (intValue >> 16) & 255,
    g: (intValue >> 8) & 255,
    b: intValue & 255,
  };
};

/**
 * Meal/Nutrition Utilities
 */
export const formatMealsDisplay = (meals: string) => {
  if (!/^IPK\|/i.test(meals)) return meals;
  const tokens = meals.split("|").slice(1);
  const map = new Map<string, string>();
  tokens.forEach((token) => {
    const [key, value] = token.split("=");
    map.set((key ?? "").trim().toLowerCase(), (value ?? "").trim());
  });
  const carb = map.get("karbo") ?? "0";
  const protein = map.get("protein") ?? "0";
  const veg = map.get("sayur") ?? "0";
  const fruit = map.get("buah") ?? "0";
  const water = map.get("air") ?? "0";
  const note = map.get("catatan");
  return `Karbo ${carb}, Protein ${protein}, Sayur ${veg}, Buah ${fruit}, Air ${water} gelas${
    note && note !== "-" ? `, Catatan: ${note}` : ""
  }`;
};

export const parseStructuredMeals = (meals: string) => {
  if (!/^IPK\|/i.test(meals)) return null;
  const tokens = meals.split("|").slice(1);
  const map = new Map<string, number | string>();
  tokens.forEach((token) => {
    const [rawKey, rawValue] = token.split("=");
    const key = (rawKey ?? "").trim().toLowerCase();
    if (!key) return;
    if (key === "catatan") {
      map.set(key, (rawValue ?? "").trim());
      return;
    }
    const num = Number(rawValue ?? 0);
    map.set(key, Number.isFinite(num) ? num : 0);
  });

  return {
    karbo: Number(map.get("karbo") ?? 0),
    protein: Number(map.get("protein") ?? 0),
    sayur: Number(map.get("sayur") ?? 0),
    buah: Number(map.get("buah") ?? 0),
    air: Number(map.get("air") ?? 0),
    catatan: String(map.get("catatan") ?? ""),
  };
};

export const evaluateNutritionPortion = (
  key: "karbo" | "protein" | "sayur" | "buah" | "air",
  value: number
) => {
  if (key === "air") {
    if (value >= 8 && value <= 12) return "baik";
    if (value >= 5 && value <= 13) return "waspada";
    return "tinggi";
  }

  if (key === "sayur" || key === "buah") {
    if (value >= 2 && value <= 6) return "baik";
    if (value >= 1 && value <= 7) return "waspada";
    return "tinggi";
  }

  if (value >= 2 && value <= 6) return "baik";
  if (value >= 1 && value <= 7) return "waspada";
  return "tinggi";
};

/**
 * Math & Percentage Utilities
 */
export const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Time Utilities
 */
export const parseTimeToMinutes = (value: string) => {
  const [hhRaw, mmRaw] = value.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return 0;
  return Math.max(0, Math.min(23, hh)) * 60 + Math.max(0, Math.min(59, mm));
};

export const getSleepDurationFromSchedule = (sleepStart: string, wakeTime: string) => {
  const startMinutes = parseTimeToMinutes(sleepStart);
  const endMinutes = parseTimeToMinutes(wakeTime);
  const durationMinutes = endMinutes >= startMinutes ? endMinutes - startMinutes : 24 * 60 - startMinutes + endMinutes;
  return Number((durationMinutes / 60).toFixed(1));
};

export const isInSleepWindow = (
  nowMinutes: number,
  sleepStartMinutes: number,
  wakeMinutes: number
) => {
  if (sleepStartMinutes === wakeMinutes) return false;
  if (sleepStartMinutes < wakeMinutes) {
    return nowMinutes >= sleepStartMinutes && nowMinutes < wakeMinutes;
  }
  return nowMinutes >= sleepStartMinutes || nowMinutes < wakeMinutes;
};

export const getLastWakeDateTime = (now: Date, wakeMinutes: number) => {
  const wakeHour = Math.floor(wakeMinutes / 60);
  const wakeMinute = wakeMinutes % 60;
  const wakeToday = new Date(now);
  wakeToday.setHours(wakeHour, wakeMinute, 0, 0);
  if (now.getTime() >= wakeToday.getTime()) return wakeToday;
  const wakeYesterday = new Date(wakeToday);
  wakeYesterday.setDate(wakeYesterday.getDate() - 1);
  return wakeYesterday;
};

export const formatDayDateTime = (millis: number) => {
  const d = new Date(millis);
  return {
    dayLabel: d.toLocaleDateString("id-ID", { weekday: "long" }),
    dateLabel: d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" }),
    timeLabel: d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
};

/**
 * Health Metrics Utilities
 */
export const calculateBmi = (weightKg: number, heightCm: number) => {
  if (weightKg <= 0 || heightCm <= 0) return 0;
  return weightKg / Math.pow(heightCm / 100, 2);
};

export const scoreBmiIdeal = (bmi: number) => {
  if (bmi <= 0) return 0;
  if (bmi >= 18.5 && bmi <= 25) return 100;
  if (bmi < 18.5) return clampPercent((bmi / 18.5) * 100);
  return clampPercent(100 - ((bmi - 25) / 25) * 100);
};

export const scoreSleepDuration = (sleepHours: number) => {
  if (sleepHours <= 0) return 0;
  if (sleepHours < 7) return clampPercent((sleepHours / 7) * 100);
  if (sleepHours <= 9) return 100;
  if (sleepHours <= 12) return clampPercent(((12 - sleepHours) / 3) * 100);
  return 0;
};

export const scoreHeartRate = (heartRate: number) => {
  if (heartRate <= 0) return 0;
  if (heartRate >= 60 && heartRate <= 100) return 100;
  if (heartRate < 60) return clampPercent(((heartRate - 40) / 20) * 100);
  return clampPercent(((140 - heartRate) / 40) * 100);
};

export const scoreBloodPressure = (bloodPressure: string) => {
  const [systolicRaw, diastolicRaw] = bloodPressure.split("/");
  const systolic = Number(systolicRaw?.trim());
  const diastolic = Number(diastolicRaw?.trim());
  if (
    !Number.isFinite(systolic) ||
    !Number.isFinite(diastolic) ||
    systolic <= 0 ||
    diastolic <= 0
  )
    return 0;

  const scorePart = (
    value: number,
    min: number,
    max: number,
    underTolerance: number,
    overTolerance: number
  ) => {
    if (value >= min && value <= max) return 100;
    if (value < min) return clampPercent(100 - ((min - value) / underTolerance) * 100);
    return clampPercent(100 - ((value - max) / overTolerance) * 100);
  };

  const systolicScore = scorePart(systolic, 90, 119, 30, 40);
  const diastolicScore = scorePart(diastolic, 60, 79, 20, 20);
  return Math.round((systolicScore + diastolicScore) / 2);
};

/**
 * Export Utilities
 */
export const toCsvCell = (value: string | number) => {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
};

export const downloadExcelCsv = (
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>
) => {
  const content = [
    headers.map((cell) => toCsvCell(cell)).join(","),
    ...rows.map((row) => row.map((cell) => toCsvCell(cell)).join(",")),
  ].join("\n");
  const csvWithBom = `\uFEFF${content}`;
  const blob = new Blob([csvWithBom], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.setAttribute("download", filename);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

/**
 * Email Utilities
 */
export const parseConfiguredEmails = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
