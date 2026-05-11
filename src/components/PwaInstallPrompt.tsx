import { useEffect, useMemo, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isStandaloneDisplay = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

type PwaInstallPromptProps = {
  role?: "admin" | "user";
};

const PwaInstallPrompt = ({ role = "user" }: PwaInstallPromptProps) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const canShow = useMemo(
    () => role !== "admin" && !hidden && !!deferredPrompt && !isStandaloneDisplay(),
    [deferredPrompt, hidden, role]
  );

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setHidden(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!canShow) return null;

  const onInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setHidden(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-3 shadow-lg">
      <p className="text-sm text-slate-700">Install Health Edukasi agar lebih nyaman dipakai seperti aplikasi mobile.</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onInstall}
          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
        >
          Install App
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Nanti
        </button>
      </div>
    </div>
  );
};

export default PwaInstallPrompt;
