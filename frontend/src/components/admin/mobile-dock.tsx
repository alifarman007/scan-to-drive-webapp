"use client";

import {
  ArrowRightIcon,
  CalendarCheckIcon,
  DotsThreeOutlineIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PathIcon,
  SealCheckIcon,
  SquaresFourIcon,
  SteeringWheelIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { LanguageSwitch } from "@/components/ui/language-switch";
import { Sheet } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { AdminUser } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { FOOT_NAV, MAIN_NAV, isActive } from "./nav";

const tap = () => navigator.vibrate?.(8);

/**
 * Phones: a floating dock at the bottom, in thumb reach. Dashboard, Trips, a raised Search in the middle,
 * Alerts (with the open count), and More (every other page, language, theme). It slides away while you scroll
 * down through a list and comes back as soon as you scroll up.
 */
export function MobileDock({ user, openAlerts }: { user: AdminUser; openAlerts: number }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [sheet, setSheet] = useState<"search" | "more" | null>(null);
  const hidden = useHideOnScroll();

  const moreKeys = [...MAIN_NAV, ...FOOT_NAV].filter((n) => !["dashboard", "trips", "alerts"].includes(n.key));
  const moreActive = moreKeys.some((n) => isActive(pathname, n.href));

  const items = [
    { key: "dashboard", href: "/admin", icon: SquaresFourIcon, label: t("nav.dashboard") },
    { key: "trips", href: "/admin/trips", icon: PathIcon, label: t("dock.trips") },
    { key: "search" },
    { key: "alerts", href: "/admin/alerts", icon: WarningCircleIcon, label: t("nav.alerts"), badge: openAlerts },
    { key: "more", icon: DotsThreeOutlineIcon, label: t("dock.more") },
  ] as const;

  return (
    <>
      <motion.nav
        aria-label={t("nav.main")}
        className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 lg:hidden"
        initial={false}
        animate={{ y: hidden && !sheet ? "140%" : 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
      >
        <div className="mx-auto grid h-[4.25rem] max-w-md grid-cols-5 items-center rounded-[1.6rem] bg-side/92 px-1.5 shadow-[0_18px_40px_-12px_rgb(15_26_61/0.6),0_2px_8px_rgb(15_26_61/0.2)] ring-1 ring-white/10 backdrop-blur-xl">
          {items.map((item) => {
            if (item.key === "search") {
              return (
                <div key="search" className="flex justify-center">
                  <motion.button
                    type="button"
                    aria-label={t("common.search")}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      tap();
                      setSheet("search");
                    }}
                    className="-mt-7 inline-flex size-14 items-center justify-center rounded-full bg-signal text-white shadow-[0_10px_24px_-6px_rgb(21_93_252/0.7)] ring-4 ring-bg"
                  >
                    <MagnifyingGlassIcon size={24} weight="bold" />
                  </motion.button>
                </div>
              );
            }
            const active = item.key === "more" ? moreActive || sheet === "more" : isActive(pathname, item.href);
            const Icon = item.icon;
            const inner = (
              <>
                {active ? (
                  <motion.span
                    layoutId="dock-pill"
                    className="absolute inset-x-1 inset-y-1.5 rounded-2xl bg-white/12"
                    transition={{ type: "spring", stiffness: 480, damping: 36 }}
                  />
                ) : null}
                <span className="relative">
                  <Icon size={22} weight={active ? "fill" : "regular"} />
                  {"badge" in item && item.badge ? (
                    <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-bad-dot px-1 text-center text-[0.6rem] leading-4 font-bold text-white ring-2 ring-side tabular-nums">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  ) : null}
                </span>
                <span className="relative text-[0.66rem] leading-none font-semibold">{item.label}</span>
              </>
            );
            const cls = cn(
              "relative flex h-full flex-col items-center justify-center gap-1 transition-colors",
              active ? "text-white" : "text-side-text active:text-white",
            );
            return item.key === "more" ? (
              <button
                key="more"
                type="button"
                className={cls}
                aria-expanded={sheet === "more"}
                onClick={() => {
                  tap();
                  setSheet("more");
                }}
              >
                {inner}
              </button>
            ) : (
              <Link key={item.key} href={item.href} className={cls} aria-current={active ? "page" : undefined} onClick={tap}>
                {inner}
              </Link>
            );
          })}
        </div>
      </motion.nav>

      <SearchSheet open={sheet === "search"} onOpenChange={(o) => setSheet(o ? "search" : null)} />
      <MoreSheet open={sheet === "more"} onOpenChange={(o) => setSheet(o ? "more" : null)} user={user} />
    </>
  );
}

/** true while the page is being scrolled down (the dock steps aside), false when scrolling up or near the top. */
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
      if (y < 80 || nearBottom) setHidden(false);
      else if (y > last.current + 6) setHidden(true);
      else if (y < last.current - 6) setHidden(false);
      last.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}

function SearchSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };
  const quick = [
    { href: "/admin/trips?range=today", icon: CalendarCheckIcon, label: t("dock.quickToday") },
    { href: "/admin/trips?status=in_progress", icon: SteeringWheelIcon, label: t("dock.quickDriving") },
    { href: "/admin/trips?approval=pending", icon: SealCheckIcon, label: t("dock.quickApproval") },
    { href: "/admin/trips?review=1", icon: EyeIcon, label: t("dock.quickCheck") },
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("dock.searchTitle")}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(q.trim() ? `/admin/trips?q=${encodeURIComponent(q.trim())}` : "/admin/trips");
        }}
        className="flex h-[3.25rem] items-center gap-2.5 rounded-control border-[1.5px] border-border-strong bg-card px-4 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--ring-soft)]"
      >
        <MagnifyingGlassIcon size={20} className="shrink-0 text-muted" />
        <input
          autoFocus
          type="search"
          enterKeyHint="search"
          aria-label={t("common.search")}
          placeholder={t("common.searchHint")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base text-text outline-none placeholder:text-muted"
        />
        <AnimatePresence>
          {q.trim() ? (
            <motion.button
              type="submit"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              aria-label={t("common.search")}
              className="inline-flex size-9 items-center justify-center rounded-full bg-accent text-white"
            >
              <ArrowRightIcon size={18} weight="bold" />
            </motion.button>
          ) : null}
        </AnimatePresence>
      </form>
      <div className="grid grid-cols-2 gap-2">
        {quick.map(({ href, icon: Icon, label }) => (
          <button
            key={href}
            type="button"
            onClick={() => go(href)}
            className="flex items-center gap-2.5 rounded-2xl bg-soft px-3.5 py-3 text-left text-sm font-semibold text-title active:scale-[0.98]"
          >
            <Icon size={18} weight="duotone" className="shrink-0 text-accent" />
            {label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function MoreSheet({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: AdminUser }) {
  const t = useTranslations();
  const pathname = usePathname();
  const items = [...MAIN_NAV, ...FOOT_NAV].filter((n) => !["dashboard", "trips", "alerts"].includes(n.key));
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("dock.moreTitle")}>
      <ul className="grid grid-cols-3 gap-2">
        {items.map((item, i) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <motion.li key={item.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
              <Link
                href={item.href}
                onClick={() => onOpenChange(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex aspect-[1/0.92] flex-col items-center justify-center gap-2 rounded-2xl px-1 text-center text-xs font-semibold transition-colors active:scale-[0.97]",
                  active ? "bg-navy text-white" : "bg-soft text-title",
                )}
              >
                <Icon size={24} weight={active ? "fill" : "duotone"} className={active ? "" : "text-accent"} />
                <span className="leading-tight">{t(`nav.${item.key}`)}</span>
                {item.phase2 ? (
                  <span className="absolute top-1.5 right-1.5 rounded-full bg-card px-1.5 text-[0.55rem] font-bold text-accent uppercase">
                    {t("common.phase2")}
                  </span>
                ) : null}
              </Link>
            </motion.li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-bay px-3.5 py-2.5">
        <span className="text-sm font-semibold text-muted">{t("dock.lookAndLanguage")}</span>
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
      </div>
      {user.role === "viewer" ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-muted">
          <EyeIcon size={16} weight="bold" />
          {t("adminAuth.roleViewerHint")}
        </p>
      ) : null}
    </Sheet>
  );
}
