import type { HealthData } from "../pages/Dashboard";

const MODERATE_CADENCE_STEPS_PER_MINUTE = 100;
const MIN_ACTIVE_MINUTES_PER_DAY = 30;

type MetricStatus = "baik" | "waspada" | "tinggi";

type KemenkesAssessment = {
  bmi: number;
  bmiStatus: MetricStatus;
  activityMinutes: number;
  stepsStatus: MetricStatus;
  energyNeedKcal: number;
  intakeEstimateKcal: number;
  activityBurnKcal: number;
  effectiveEnergyNeedKcal: number;
  caloriesStatus: MetricStatus;
  sleepStatus: MetricStatus;
  heartRateStatus: MetricStatus;
  bloodPressureStatus: MetricStatus;
  mealStatus: MetricStatus;
  riskScore: number;
  riskLevel: "Rendah" | "Sedang" | "Tinggi";
  riskNotes: string[];
  educationItems: string[];
};
type GenderOption = "pria" | "wanita" | "tidak_ditentukan";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseBloodPressure = (value: string) => {
  const parts = value.split("/").map((part) => Number(part.trim()));
  return {
    systolic: Number.isFinite(parts[0]) ? parts[0] : 0,
    diastolic: Number.isFinite(parts[1]) ? parts[1] : 0,
  };
};

const getAgeBracketNeed = (gender: GenderOption, ageYears: number) => {
  if (gender === "pria") {
    if (ageYears >= 19 && ageYears <= 29) return 2650;
    if (ageYears >= 30 && ageYears <= 49) return 2550;
    if (ageYears >= 50 && ageYears <= 64) return 2150;
    if (ageYears >= 65 && ageYears <= 80) return 1800;
    if (ageYears > 80) return 1600;
  }
  // Untuk perempuan/umum, sementara fallback ke estimasi BMR.
  return 0;
};

const classifyBmi = (bmi: number): MetricStatus => {
  if (bmi <= 0) return "waspada";
  if (bmi < 18.5) return "waspada";
  if (bmi <= 25) return "baik";
  if (bmi <= 27) return "waspada";
  return "tinggi";
};

const classifySteps = (steps: number) => {
  const activityMinutes = Math.round((steps > 0 ? steps : 0) / MODERATE_CADENCE_STEPS_PER_MINUTE);
  if (activityMinutes >= MIN_ACTIVE_MINUTES_PER_DAY) {
    return { activityMinutes, status: "baik" as const };
  }
  if (activityMinutes >= 20) {
    return { activityMinutes, status: "waspada" as const };
  }
  return { activityMinutes, status: "tinggi" as const };
};

const estimateBmrKcal = (weightKg: number, heightCm: number, ageYears: number, gender: GenderOption) => {
  const effectiveWeight = weightKg > 0 ? weightKg : 60;
  const effectiveHeight = heightCm > 0 ? heightCm : gender === "wanita" ? 155 : 165;
  const effectiveAge = ageYears > 0 ? ageYears : 25;

  if (gender === "wanita") {
    // BMR Wanita = 655 + (9,6 x berat) + (1,8 x tinggi) - (4,7 x usia)
    return Math.round(655 + 9.6 * effectiveWeight + 1.8 * effectiveHeight - 4.7 * effectiveAge);
  }
  if (gender === "pria") {
    // BMR Pria = 66,5 + (13,7 x berat) + (5 x tinggi) - (6,8 x usia)
    return Math.round(66.5 + 13.7 * effectiveWeight + 5 * effectiveHeight - 6.8 * effectiveAge);
  }

  const bmrPria = 66.5 + 13.7 * effectiveWeight + 5 * effectiveHeight - 6.8 * effectiveAge;
  const bmrWanita = 655 + 9.6 * effectiveWeight + 1.8 * effectiveHeight - 4.7 * effectiveAge;
  return Math.round((bmrPria + bmrWanita) / 2);
};

export const estimateDailyCalorieNeed = (weightKg: number, heightCm: number, ageYears: number, gender: GenderOption) => {
  const bracketNeed = getAgeBracketNeed(gender, ageYears);
  if (bracketNeed > 0) return bracketNeed;
  return estimateBmrKcal(weightKg, heightCm, ageYears, gender);
};

const estimateMealIntakeKcal = (meals: string) => {
  if (/^IPK\|/i.test(meals)) {
    const tokens = meals.split("|").slice(1);
    const map = new Map<string, number>();
    tokens.forEach((token) => {
      const [key, raw] = token.split("=");
      const num = Number(raw ?? 0);
      map.set((key ?? "").trim().toLowerCase(), Number.isFinite(num) ? num : 0);
    });
    const carb = map.get("karbo") ?? 0;
    const protein = map.get("protein") ?? 0;
    const veg = map.get("sayur") ?? 0;
    const fruit = map.get("buah") ?? 0;
    // Estimasi sederhana per porsi (kkal).
    return Math.round(carb * 175 + protein * 120 + veg * 30 + fruit * 60);
  }

  const text = meals.toLowerCase();
  const hasCarb = /(nasi|roti|kentang|oat|karbo)/.test(text);
  const hasProtein = /(ikan|ayam|telur|tempe|tahu|daging|protein)/.test(text);
  const hasVeg = /(sayur|brokoli|bayam|wortel|kangkung|vegetable)/.test(text);
  const hasFruit = /(buah|apel|pisang|jeruk|pepaya|alpukat|fruit)/.test(text);
  const estimate =
    (hasCarb ? 450 : 0) +
    (hasProtein ? 350 : 0) +
    (hasVeg ? 120 : 0) +
    (hasFruit ? 150 : 0);
  return estimate;
};

const classifyCalories = (
  activityBurnKcal: number,
  meals: string,
  weightKg: number,
  heightCm: number,
  ageYears: number,
  gender: GenderOption
) => {
  const energyNeedKcal = estimateDailyCalorieNeed(weightKg, heightCm, ageYears, gender);
  const intakeEstimateKcal = estimateMealIntakeKcal(meals);
  const effectiveEnergyNeedKcal = Math.round(energyNeedKcal + Math.max(0, activityBurnKcal * 0.35));
  const ratio = effectiveEnergyNeedKcal > 0 ? intakeEstimateKcal / effectiveEnergyNeedKcal : 0;
  if (ratio >= 0.8 && ratio <= 1.2) {
    return { energyNeedKcal, effectiveEnergyNeedKcal, intakeEstimateKcal, activityBurnKcal, status: "baik" as const };
  }
  if (ratio >= 0.6 && ratio <= 1.4) {
    return { energyNeedKcal, effectiveEnergyNeedKcal, intakeEstimateKcal, activityBurnKcal, status: "waspada" as const };
  }
  return { energyNeedKcal, effectiveEnergyNeedKcal, intakeEstimateKcal, activityBurnKcal, status: "tinggi" as const };
};

const classifySleep = (sleepHours: number): MetricStatus => {
  if (sleepHours >= 7 && sleepHours <= 9) return "baik";
  if (sleepHours >= 6 && sleepHours <= 10) return "waspada";
  return "tinggi";
};

const classifyHeartRate = (heartRate: number): MetricStatus => {
  if (heartRate >= 60 && heartRate <= 100) return "baik";
  if ((heartRate >= 50 && heartRate < 60) || (heartRate > 100 && heartRate <= 110)) return "waspada";
  return "tinggi";
};

const classifyBloodPressure = (systolic: number, diastolic: number): MetricStatus => {
  if (systolic < 120 && diastolic < 80) return "baik";
  if (systolic < 140 && diastolic < 90) return "waspada";
  return "tinggi";
};

const classifyMealPattern = (meals: string): MetricStatus => {
  const structured = /^IPK\|/i.test(meals);
  if (structured) {
    const tokens = meals.split("|").slice(1);
    const map = new Map<string, number>();
    tokens.forEach((token) => {
      const [key, raw] = token.split("=");
      const val = Number(raw ?? 0);
      map.set((key ?? "").trim().toLowerCase(), Number.isFinite(val) ? val : 0);
    });
    const carb = map.get("karbo") ?? 0;
    const protein = map.get("protein") ?? 0;
    const veg = map.get("sayur") ?? 0;
    const fruit = map.get("buah") ?? 0;
    const water = map.get("air") ?? 0;
    const score =
      (carb > 0 ? 1 : 0) +
      (protein > 0 ? 1 : 0) +
      (veg > 0 ? 1 : 0) +
      (fruit > 0 ? 1 : 0) +
      (water >= 8 ? 1 : water >= 5 ? 0.5 : 0);
    if (score >= 4.5) return "baik";
    if (score >= 2.5) return "waspada";
    return "tinggi";
  }

  const text = meals.toLowerCase();
  const hasVeg = /(sayur|vegetable|brokoli|bayam|wortel|kangkung)/.test(text);
  const hasFruit = /(buah|fruit|apel|pisang|jeruk|pepaya|alpukat)/.test(text);
  const hasProtein = /(ikan|ayam|telur|tempe|tahu|daging|protein)/.test(text);
  const hasCarb = /(nasi|roti|kentang|jagung|oat|karbo)/.test(text);
  const matched = [hasVeg, hasFruit, hasProtein, hasCarb].filter(Boolean).length;
  if (matched >= 4) return "baik";
  if (matched >= 2) return "waspada";
  return "tinggi";
};

const summarizeMeals = (meals: string) => {
  if (!/^IPK\|/i.test(meals)) return meals;
  const tokens = meals.split("|").slice(1);
  const map = new Map<string, string>();
  tokens.forEach((token) => {
    const [key, value] = token.split("=");
    map.set((key ?? "").trim().toLowerCase(), (value ?? "").trim());
  });
  return `Karbo ${map.get("karbo") ?? "0"}, Protein ${map.get("protein") ?? "0"}, Sayur ${
    map.get("sayur") ?? "0"
  }, Buah ${map.get("buah") ?? "0"}, Air ${map.get("air") ?? "0"} gelas`;
};

const penaltyByStatus = (status: MetricStatus) => {
  if (status === "baik") return 0;
  if (status === "waspada") return 1;
  return 2;
};

export function assessKemenkesMetrics(
  latest?: HealthData,
  profile?: { gender?: GenderOption; age?: number }
): KemenkesAssessment {
  const gender = profile?.gender ?? "tidak_ditentukan";
  const ageYears = Number(profile?.age ?? 25);
  const steps = Number(latest?.steps ?? 0);
  const weight = Number(latest?.weight ?? 0);
  const height = Number(latest?.height ?? 0);
  const calories = Number(latest?.calories ?? 0);
  const sleep = Number(latest?.sleep ?? 0);
  const heartRate = Number(latest?.heartRate ?? 0);
  const bloodPressure = String(latest?.bloodPressure ?? "0/0");
  const meals = String(latest?.meals ?? "-");

  const bmi = height > 0 ? weight / Math.pow(height / 100, 2) : 0;
  const bmiStatus = classifyBmi(bmi);

  const stepsResult = classifySteps(steps);
  const caloriesResult = classifyCalories(calories, meals, weight, height, ageYears, gender);
  const sleepStatus = classifySleep(sleep);
  const heartRateStatus = classifyHeartRate(heartRate);
  const { systolic, diastolic } = parseBloodPressure(bloodPressure);
  const bloodPressureStatus = classifyBloodPressure(systolic, diastolic);
  const mealStatus = classifyMealPattern(meals);

  const riskScore = clamp(
    penaltyByStatus(stepsResult.status) +
      penaltyByStatus(bmiStatus) +
      penaltyByStatus(caloriesResult.status) +
      penaltyByStatus(sleepStatus) +
      penaltyByStatus(heartRateStatus) +
      penaltyByStatus(bloodPressureStatus) +
      penaltyByStatus(mealStatus),
    0,
    14
  );
  const riskLevel = riskScore >= 8 ? "Tinggi" : riskScore >= 4 ? "Sedang" : "Rendah";

  const riskNotes = [
    `Aktivitas: ${stepsResult.activityMinutes} menit/hari (target >= ${MIN_ACTIVE_MINUTES_PER_DAY} menit).`,
    `IMT: ${bmi > 0 ? bmi.toFixed(1) : "0.0"} (normal 18,5-25).`,
    `Kalori: aktivitas ${caloriesResult.activityBurnKcal} kkal, estimasi asupan ${caloriesResult.intakeEstimateKcal} kkal, kebutuhan ${caloriesResult.effectiveEnergyNeedKcal} kkal/hari (${gender}, usia ${ageYears} tahun).`,
    `Tidur: ${sleep} jam (anjuran 7-9 jam).`,
    `Detak jantung: ${heartRate} bpm (normal 60-100).`,
    `Tekanan darah: ${bloodPressure} (hipertensi jika >=140/90).`,
    `Pola makan: ${summarizeMeals(meals)}`,
  ];

  const educationItems = [
    stepsResult.status === "baik"
      ? "Aktivitas fisik sudah sesuai anjuran minimal 30 menit/hari. Pertahankan konsistensi."
      : "Tingkatkan aktivitas bertahap sampai minimal 30 menit/hari (setara 150 menit/minggu).",
    bmiStatus === "baik"
      ? "IMT berada di rentang normal. Lanjutkan pola hidup sehat."
      : "Perbaiki pola makan dan aktivitas untuk menjaga IMT di rentang 18,5-25.",
    caloriesResult.status === "baik"
      ? "Asupan energi relatif sesuai kebutuhan harian."
      : "Atur asupan energi agar mendekati estimasi BMR berdasarkan berat, tinggi, usia, dan jenis kelamin.",
    sleepStatus === "baik"
      ? "Durasi tidur sudah sesuai anjuran dewasa 7-9 jam."
      : "Perbaiki durasi tidur ke rentang 7-9 jam untuk pemulihan tubuh.",
    heartRateStatus === "baik"
      ? "Denyut nadi berada dalam kisaran normal dewasa."
      : "Pantau denyut nadi saat istirahat; konsultasi bila konsisten di luar rentang normal.",
    bloodPressureStatus === "baik"
      ? "Tekanan darah terkendali."
      : "Batasi garam, rutin aktivitas fisik, dan cek tekanan darah berkala.",
    mealStatus === "baik"
      ? "Komponen makan mendekati prinsip Isi Piringku."
      : "Lengkapi menu dengan karbohidrat, protein, sayur, dan buah (porsi seimbang).",
  ];

  return {
    bmi,
    bmiStatus,
    activityMinutes: stepsResult.activityMinutes,
    stepsStatus: stepsResult.status,
    energyNeedKcal: caloriesResult.energyNeedKcal,
    intakeEstimateKcal: caloriesResult.intakeEstimateKcal,
    activityBurnKcal: caloriesResult.activityBurnKcal,
    effectiveEnergyNeedKcal: caloriesResult.effectiveEnergyNeedKcal,
    caloriesStatus: caloriesResult.status,
    sleepStatus,
    heartRateStatus,
    bloodPressureStatus,
    mealStatus,
    riskScore,
    riskLevel,
    riskNotes,
    educationItems,
  };
}
