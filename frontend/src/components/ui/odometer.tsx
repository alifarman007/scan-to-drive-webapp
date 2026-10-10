"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

const SIZES = {
  sm: { h: 28, tile: "w-5 text-base rounded-[5px]", gap: "gap-0.5", frame: "" },
  md: { h: 40, tile: "w-7 text-[1.375rem] rounded-md", gap: "gap-[3px]", frame: "p-1.5 rounded-xl" },
  lg: { h: 54, tile: "w-10 text-[2rem] rounded-lg", gap: "gap-1", frame: "p-2 rounded-[14px]" },
} as const;

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Km shown as counter tiles, the app's signature. Each digit is a strip of 0-9 that rolls to its
 * place, so a new value (for example after a trip ends) visibly counts up. The last digit is signal blue.
 */
export function Odometer({
  value,
  minDigits = 5,
  size = "md",
  framed = size !== "sm",
  rollIn = true,
  from,
  unit,
  className,
}: {
  value: number;
  /** Start the digits at this number and roll to `value` (end of a trip: start km rolls up to end km). */
  from?: number;
  minDigits?: number;
  size?: keyof typeof SIZES;
  framed?: boolean;
  /** Roll up from zero the first time it appears. */
  rollIn?: boolean;
  unit?: string;
  className?: string;
}) {
  const s = SIZES[size];
  const width = Math.max(minDigits, String(Math.floor(Math.max(0, value))).length, String(Math.floor(Math.max(0, from ?? 0))).length);
  const digits = Math.max(0, Math.floor(value)).toString().padStart(width, "0").split("").map(Number);
  const fromDigits =
    from === undefined ? null : Math.max(0, Math.floor(from)).toString().padStart(width, "0").split("").map(Number);

  return (
    <span className={cn("inline-flex items-end gap-2.5", className)}>
      <span
        role="img"
        aria-label={`${Math.floor(value).toLocaleString("en-US")}${unit ? ` ${unit}` : ""}`}
        className={cn("inline-flex", s.gap, framed && "bg-odo-frame", framed && s.frame)}
      >
        {digits.map((d, i) => (
          <Digit
            // Keyed from the right, so the units digit stays the same element when the number grows.
            key={digits.length - i}
            digit={d}
            height={s.h}
            className={s.tile}
            last={i === digits.length - 1}
            initialDigit={fromDigits ? fromDigits[i] : rollIn ? 0 : null}
          />
        ))}
      </span>
      {unit ? <span className="pb-1 font-display text-lg font-semibold text-muted">{unit}</span> : null}
    </span>
  );
}

function Digit({
  digit,
  height,
  className,
  last,
  initialDigit,
}: {
  digit: number;
  height: number;
  className: string;
  last: boolean;
  /** where this digit starts before rolling; null = no roll, just show it */
  initialDigit: number | null;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden font-mono font-semibold text-white tabular-nums",
        last ? "bg-signal" : "bg-odo-tile",
        className,
      )}
      style={{ height }}
    >
      <motion.span
        className="absolute inset-x-0 top-0 flex flex-col"
        initial={initialDigit === null ? false : { y: `${-initialDigit * 10}%` }}
        animate={{ y: `${-digit * 10}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 18, mass: 0.9 }}
      >
        {DIGITS.map((n) => (
          <span key={n} className="flex items-center justify-center" style={{ height }}>
            {n}
          </span>
        ))}
      </motion.span>
      {/* a soft shine across the middle, like a real counter window */}
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.25),transparent_30%,transparent_70%,rgb(0_0_0/0.25))]" />
    </span>
  );
}
