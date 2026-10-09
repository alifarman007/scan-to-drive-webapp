"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";

import { useIsClient } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => Promise<void> | void) => unknown };

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("common");
  const { resolvedTheme, setTheme } = useTheme();
  const client = useIsClient();
  const dark = client && resolvedTheme === "dark";

  function toggle() {
    const next = dark ? "light" : "dark";
    const doc = document as ViewTransitionDoc;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduce) {
      setTheme(next);
      return;
    }
    // Cross-fade the whole page: snapshot, switch, wait two frames for the new colours, fade.
    doc.startViewTransition(
      () =>
        new Promise<void>((done) => {
          setTheme(next);
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }),
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("lightDark")}
      title={t("lightDark")}
      className={cn(
        "relative inline-flex size-11 items-center justify-center overflow-hidden rounded-control border border-border bg-card text-title transition-colors hover:bg-soft active:scale-95",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={dark ? "moon" : "sun"}
          initial={{ y: 14, rotate: -40, opacity: 0 }}
          animate={{ y: 0, rotate: 0, opacity: 1 }}
          exit={{ y: -14, rotate: 40, opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="inline-flex"
        >
          {dark ? <SunIcon size={20} weight="bold" /> : <MoonIcon size={20} weight="bold" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
