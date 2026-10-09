"use client";

import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { setLocale } from "@/i18n/actions";
import type { Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "bn", label: "বাং" },
];

/** EN / বাং switch. The choice is kept in a cookie for a year; the page re-renders in place. */
export function LanguageSwitch({ tone = "onLight", className }: { tone?: "onLight" | "onDark"; className?: string }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(
        "relative inline-flex rounded-full p-[3px]",
        tone === "onDark" ? "bg-navy-2" : "bg-soft",
        pending && "opacity-70",
        className,
      )}
    >
      {OPTIONS.map((o) => {
        const active = o.value === locale;
        return (
          <button
            key={o.value}
            type="button"
            lang={o.value}
            aria-pressed={active}
            onClick={() => choose(o.value)}
            className={cn(
              "relative z-10 h-8 min-w-11 rounded-full px-3 text-xs font-bold transition-colors",
              active
                ? tone === "onDark"
                  ? "text-navy"
                  : "text-title"
                : tone === "onDark"
                  ? "text-[#c9d3ea]"
                  : "text-muted",
            )}
          >
            {active ? (
              <motion.span
                layoutId={`lang-pill-${tone}`}
                className={cn("absolute inset-0 -z-10 rounded-full", tone === "onDark" ? "bg-white" : "bg-card shadow-sm")}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
