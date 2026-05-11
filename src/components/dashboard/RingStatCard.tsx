import { useEffect, useState } from "react";
import type { RingStatCardProps } from "../../types/dashboard";
import { clampPercent } from "../../utils/dashboardUtils";

export const RingStatCard = ({
  title,
  value,
  caption,
  percent,
  color,
  variant = "default",
}: RingStatCardProps) => {
  const size = 72;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = clampPercent(percent);
  const [animatedProgress, setAnimatedProgress] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      const timer = window.setTimeout(() => {
        setAnimatedProgress(progress);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const resetTimer = window.setTimeout(() => {
      setAnimatedProgress(0);
    }, 0);
    const timer = window.setTimeout(() => {
      setAnimatedProgress(progress);
    }, 30);

    return () => {
      window.clearTimeout(resetTimer);
      window.clearTimeout(timer);
    };
  }, [progress]);

  if (variant === "glass") {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-cyan-100/40 bg-white/14 p-4 shadow-[0_10px_24px_-18px_rgba(14,165,233,0.55)] backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_0%,rgba(255,255,255,0.2),transparent_45%)]" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan-50/85">
              {title}
            </p>
            <p className="mt-1 text-5xl font-semibold leading-none text-cyan-50">{value}</p>
            <p className="mt-2 text-sm text-cyan-50/85">{caption}</p>
          </div>
          <div className="flex h-[74px] w-[74px] shrink-0 items-center justify-center rounded-full border-4 border-cyan-100/60 bg-cyan-100/10 text-3xl font-semibold text-cyan-50">
            {Math.round(progress)}%
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-cyan-100/20">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-300/70 to-sky-300/80 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  const dashOffset = circumference * (1 - animatedProgress / 100);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          <p className="mt-1 text-xs" style={{ color }}>
            {caption}
          </p>
        </div>
        <div className="relative h-[64px] w-[64px] shrink-0 sm:h-[72px] sm:w-[72px]">
          <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              style={{
                transition: "stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-slate-700 sm:text-[11px]">
            {Math.round(animatedProgress)}%
          </span>
        </div>
      </div>
    </div>
  );
};
