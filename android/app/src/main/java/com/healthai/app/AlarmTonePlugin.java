package com.healthai.app;

import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AlarmTone")
public class AlarmTonePlugin extends Plugin {
    private static Ringtone activeRingtone;
    private static final Handler handler = new Handler(Looper.getMainLooper());
    private static Runnable stopRunnable;

    @PluginMethod
    public void playDefaultAlarm(PluginCall call) {
        int durationMs = call.getInt("durationMs", 12000);
        if (durationMs < 1000) durationMs = 1000;
        if (durationMs > 60000) durationMs = 60000;

        stopActiveRingtone();

        Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (alarmUri == null) {
            alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        if (alarmUri == null) {
            alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        }

        if (alarmUri == null) {
            call.reject("NO_SYSTEM_ALARM_TONE");
            return;
        }

        try {
            activeRingtone = RingtoneManager.getRingtone(getContext(), alarmUri);
            if (activeRingtone == null) {
                call.reject("ALARM_TONE_UNAVAILABLE");
                return;
            }
            activeRingtone.play();

            final Ringtone ringtoneRef = activeRingtone;
            stopRunnable = () -> {
                if (ringtoneRef.isPlaying()) {
                    ringtoneRef.stop();
                }
                if (activeRingtone == ringtoneRef) {
                    activeRingtone = null;
                }
            };
            handler.postDelayed(stopRunnable, durationMs);

            JSObject result = new JSObject();
            result.put("playing", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("FAILED_PLAY_ALARM_TONE", ex);
        }
    }

    @PluginMethod
    public void stopAlarm(PluginCall call) {
        stopActiveRingtone();
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    private static void stopActiveRingtone() {
        if (stopRunnable != null) {
            handler.removeCallbacks(stopRunnable);
            stopRunnable = null;
        }
        if (activeRingtone != null && activeRingtone.isPlaying()) {
            activeRingtone.stop();
        }
        activeRingtone = null;
    }
}

