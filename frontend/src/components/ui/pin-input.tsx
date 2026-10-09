"use client";

import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const LENGTH = 4;

/**
 * 4 PIN boxes backed by ONE real input (the pattern phones handle best: numeric keypad, paste, backspace
 * all just work). The boxes show dots; the box waiting for the next digit has a blinking caret.
 * Change `shakeKey` to shake the boxes after a wrong PIN.
 */
export function PinInput({
  id,
  value,
  onChange,
  onComplete,
  label,
  invalid,
  disabled,
  autoFocus,
  shakeKey = 0,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  shakeKey?: number;
}) {
  const t = useTranslations("pinInput");
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [scope, animate] = useAnimate();

  useEffect(() => {
    if (shakeKey > 0 && scope.current) {
      animate(scope.current, { x: [0, -12, 12, -9, 9, -5, 5, 0] }, { duration: 0.45, ease: "easeOut" });
    }
  }, [shakeKey, animate, scope]);

  function handle(raw: string) {
    const next = raw.replace(/\D/g, "").slice(0, LENGTH);
    onChange(next);
    if (next.length === LENGTH && next !== value) onComplete?.(next);
  }

  return (
    <div className="relative" ref={scope}>
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(e) => handle(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={LENGTH}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-count`}
        // The real input covers the boxes but is invisible; taps anywhere on the boxes focus it.
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 [caret-color:transparent]"
      />
      <span id={`${id}-count`} className="sr-only" aria-live="polite">
        {t("digitsEntered", { count: value.length })}
      </span>
      <div aria-hidden="true" className="grid grid-cols-4 gap-2.5">
        {Array.from({ length: LENGTH }, (_, i) => {
          const filled = i < value.length;
          const current = focused && !disabled && i === Math.min(value.length, LENGTH - 1) && value.length < LENGTH;
          return (
            <div
              key={i}
              className={cn(
                "flex h-[3.75rem] items-center justify-center rounded-control border-[1.5px] transition-[border-color,box-shadow,background-color] duration-150",
                filled ? "border-border-strong bg-soft" : "border-border-strong bg-card",
                current && "border-ring shadow-[0_0_0_4px_var(--ring-soft)]",
                invalid && "border-bad-dot shadow-[0_0_0_4px_var(--bad-bg)]",
                disabled && "opacity-60",
              )}
            >
              <AnimatePresence initial={false}>
                {filled ? (
                  <motion.span
                    key="dot"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 600, damping: 26 }}
                    className="size-3.5 rounded-full bg-title"
                  />
                ) : current ? (
                  <span className="h-7 w-0.5 rounded-full bg-ring motion-safe:animate-pulse" />
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
