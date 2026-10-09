"use client";

import { ListIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { useState } from "react";

import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

import { FOOT_NAV, MAIN_NAV, isActive, type NavItem } from "./nav";

/** Admin frame: navy sidebar on laptops, a slide-in drawer on phones, and the top bar. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      {/* laptop sidebar */}
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar layoutGroup="desk" />
      </aside>

      {/* phone top bar + drawer */}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <div className="sticky top-0 z-30 flex h-16 items-center justify-between bg-side px-4 lg:hidden">
          <Wordmark name={t("app.name")} />
          <Dialog.Trigger asChild>
            <button
              type="button"
              aria-label={t("common.openMenu")}
              className="inline-flex size-11 items-center justify-center rounded-control text-white active:scale-95"
            >
              <ListIcon size={24} weight="bold" />
            </button>
          </Dialog.Trigger>
        </div>
        <AnimatePresence>
          {open ? (
            <Dialog.Portal forceMount>
              <Dialog.Overlay asChild forceMount>
                <motion.div
                  className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[2px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] shadow-2xl"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", stiffness: 420, damping: 40 }}
                >
                  <Dialog.Title className="sr-only">{t("nav.main")}</Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label={t("common.closeMenu")}
                      className="absolute top-3 right-3 z-10 inline-flex size-11 items-center justify-center rounded-control text-side-text hover:text-white"
                    >
                      <XIcon size={22} weight="bold" />
                    </button>
                  </Dialog.Close>
                  <Sidebar layoutGroup="drawer" onNavigate={() => setOpen(false)} />
                </motion.div>
              </Dialog.Content>
            </Dialog.Portal>
          ) : null}
        </AnimatePresence>
      </Dialog.Root>

      <div className="flex min-w-0 flex-col">
        <TopBar />
        <main className="flex-1 px-gutter pt-2 pb-10">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ layoutGroup, onNavigate }: { layoutGroup: string; onNavigate?: () => void }) {
  const t = useTranslations();
  return (
    <nav aria-label={t("nav.main")} className="flex h-full flex-col gap-6 overflow-y-auto bg-side px-3.5 py-5">
      <div className="px-2">
        <Wordmark name={t("app.name")} />
      </div>
      <ul className="flex flex-col gap-1">
        {MAIN_NAV.map((item) => (
          <NavLink key={item.key} item={item} group={layoutGroup} onNavigate={onNavigate} />
        ))}
      </ul>
      <div className="flex-1" />
      <ul className="flex flex-col gap-1 border-t border-white/10 pt-4">
        {FOOT_NAV.map((item) => (
          <NavLink key={item.key} item={item} group={layoutGroup} onNavigate={onNavigate} />
        ))}
      </ul>
    </nav>
  );
}

function NavLink({ item, group, onNavigate }: { item: NavItem; group: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useTranslations();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors",
          active ? "text-white" : "text-side-text hover:bg-white/5 hover:text-white",
        )}
      >
        {active ? (
          // the highlight slides from the old item to the new one
          <motion.span layoutId={`nav-active-${group}`} className="absolute inset-0 rounded-xl bg-side-active" />
        ) : null}
        <Icon size={19} weight={active ? "fill" : "regular"} className="relative" />
        <span className="relative flex-1">{t(`nav.${item.key}`)}</span>
        {item.phase2 ? (
          <span className="relative rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-bold tracking-wide text-sky uppercase">
            {t("common.phase2")}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function TopBar() {
  const t = useTranslations("common");
  return (
    <div className="flex flex-wrap items-center gap-3 px-gutter py-4">
      <label className="flex h-11 min-w-0 flex-1 basis-64 items-center gap-2.5 rounded-control border border-border bg-card px-3.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--ring-soft)] sm:max-w-md">
        <MagnifyingGlassIcon size={18} className="shrink-0 text-muted" />
        <span className="sr-only">{t("search")}</span>
        <input
          type="search"
          placeholder={t("searchHint")}
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
        />
        <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[0.7rem] text-muted sm:inline">
          Ctrl K
        </kbd>
      </label>
      <div className="ml-auto flex items-center gap-2">
        <LanguageSwitch />
        <ThemeToggle />
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-soft font-display text-sm font-semibold text-title">
          AD
        </span>
      </div>
    </div>
  );
}
