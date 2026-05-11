export type LocationActivitySample = {
  steps: number;
  calories: number;
  distanceMeters: number;
  latitude: number;
  longitude: number;
  speedMps: number;
  timestampMs: number;
};

type StartLocationActivityTrackerParams = {
  heightCm: number;
  weightKg: number;
  onSample: (sample: LocationActivitySample) => void;
  onError?: (message: string) => void;
  minMoveMeters?: number;
};

type GeoPoint = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  timestampMs: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toRadians = (value: number) => (value * Math.PI) / 180;

const distanceMetersBetween = (a: GeoPoint, b: GeoPoint) => {
  const earthRadius = 6371000;
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const y = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return earthRadius * y;
};

const estimateStepLengthMeters = (heightCm: number) => {
  const effectiveHeight = heightCm > 0 ? heightCm : 165;
  return clamp((effectiveHeight * 0.415) / 100, 0.55, 0.9);
};

const estimateCaloriesByDistance = (distanceMeters: number, weightKg: number) => {
  const km = Math.max(0, distanceMeters / 1000);
  const effectiveWeight = weightKg > 0 ? weightKg : 65;
  const kcalPerKmPerKg = 0.9;
  return Math.round(km * effectiveWeight * kcalPerKmPerKg);
};

export const startLocationActivityTracker = ({
  heightCm,
  weightKg,
  onSample,
  onError,
  minMoveMeters = 8,
}: StartLocationActivityTrackerParams) => {
  if (typeof window === "undefined" || !("geolocation" in navigator)) {
    onError?.("Geolocation tidak didukung pada perangkat ini.");
    return () => {};
  }

  let lastPoint: GeoPoint | null = null;
  let totalDistanceMeters = 0;
  const stepLength = estimateStepLengthMeters(heightCm);

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const point: GeoPoint = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Number(position.coords.accuracy ?? 0),
        speed: Number(position.coords.speed ?? 0),
        timestampMs: Number(position.timestamp ?? Date.now()),
      };

      if (point.accuracy > 80) return;

      if (lastPoint) {
        const deltaMeters = distanceMetersBetween(lastPoint, point);
        if (deltaMeters >= minMoveMeters && deltaMeters < 500) {
          totalDistanceMeters += deltaMeters;
        }
      }

      lastPoint = point;

      const steps = Math.max(0, Math.round(totalDistanceMeters / stepLength));
      const calories = estimateCaloriesByDistance(totalDistanceMeters, weightKg);
      onSample({
        steps,
        calories,
        distanceMeters: Math.round(totalDistanceMeters),
        latitude: point.latitude,
        longitude: point.longitude,
        speedMps: Math.max(0, point.speed),
        timestampMs: point.timestampMs,
      });
    },
    (error) => {
      onError?.(error.message || "Gagal membaca lokasi perangkat.");
    },
    {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 20000,
    }
  );

  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
};

