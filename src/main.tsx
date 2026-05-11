import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

const FORCE_CACHE_RESET_KEY = "health-app-force-cache-reset-v4";

const forceResetBrowserCache = async () => {
  try {
    if (localStorage.getItem(FORCE_CACHE_RESET_KEY) === "done") return;

    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }

    if ("caches" in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((key) => caches.delete(key)));
    }

    localStorage.setItem(FORCE_CACHE_RESET_KEY, "done");
    window.location.reload();
  } catch {
    // ignore cleanup failure; app remains usable
  }
};

void forceResetBrowserCache();

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Paksa aktivasi SW baru agar user tidak tertahan di cache versi lama.
    void updateSW(true);
    window.location.reload();
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
