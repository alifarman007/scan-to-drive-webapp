"use client";

import { useEffect, useRef } from "react";

import { useNowSeconds } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Ring that empties as a one-time QR code runs out. Turns amber in the last minute.
 * `expiresAt` comes from the API (ISO time); `totalSeconds` is the full life of the code.
 */
export function CountdownRing({
  expiresAt,
  totalSeconds,
  size = 56,
  onExpire,
  tone = "onDark",
  label,
  className,
}: {
  expiresAt: string | number | Date;
  totalSeconds: number;
  size?: number;
  onExpire?: () => void;
  tone?: "onDark" | "onLight";
  label?: string;
  className?: string;
}) {
  const now = useNowSeconds();
  const end = Math.floor(new Date(expiresAt).getTime() / 1000);
  const left = now === null ? null : Math.max(0, end - now);

  const fired = useRef(false);
  useEffect(() => {
    if (left === 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [left, onExpire]);

  const stroke = Math.max(4, Math.round(size / 9));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = left === null ? 1 : Math.min(1, left / Math.max(1, totalSeconds));
  const urgent = left !== null && left <= 60;
  const mm = left === null ? "--" : String(Math.floor(left / 60)).padStart(2, "0");
  const ss = left === null ? "--" : String(left % 60).padStart(2, "0");

  return (
    <div className={cn("flex items-center gap-3.5", className)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className={tone === "onDark" ? "stroke-navy-2" : "stroke-soft"}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - share)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-1000 ease-linear",
            urgent ? "stroke-wait-dot" : tone === "onDark" ? "stroke-sky" : "stroke-signal",
          )}
        />
      </svg>
      <div className="flex flex-col" role="timer" aria-live="off">
        <span
          className={cn(
            "font-mono text-[1.75rem] font-semibold tabular-nums leading-none",
            urgent ? "text-wait-dot" : tone === "onDark" ? "text-white" : "text-title",
          )}
        >
          {mm}:{ss}
        </span>
        {label ? (
          <span className={cn("mt-1 text-sm", tone === "onDark" ? "text-[#c9d3ea]" : "text-muted")}>{label}</span>
        ) : null}
      </div>
    </div>
  );
}
