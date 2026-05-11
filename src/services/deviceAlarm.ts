import { Capacitor, registerPlugin } from "@capacitor/core";

type AlarmTonePlugin = {
  playDefaultAlarm: (options?: { durationMs?: number }) => Promise<{ playing: boolean }>;
  stopAlarm: () => Promise<{ stopped: boolean }>;
};

const AlarmTone = registerPlugin<AlarmTonePlugin>("AlarmTone");

export const playDeviceAlarmTone = async (durationMs = 12000) => {
  if (Capacitor.getPlatform() !== "android") return false;
  try {
    const result = await AlarmTone.playDefaultAlarm({ durationMs });
    return Boolean(result?.playing);
  } catch {
    return false;
  }
};

export const stopDeviceAlarmTone = async () => {
  if (Capacitor.getPlatform() !== "android") return false;
  try {
    const result = await AlarmTone.stopAlarm();
    return Boolean(result?.stopped);
  } catch {
    return false;
  }
};

