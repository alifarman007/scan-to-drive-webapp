"use client";

import { CaretDownIcon, CircleNotchIcon, EyeIcon, MagnifyingGlassIcon, SignOutIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { adminApi, type AdminUser } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { MobileDock } from "./mobile-dock";
import { FOOT_NAV, MAIN_NAV, MOTTO, isActive, type NavItem } from "./nav";

const UserContext = createContext<AdminUser | null>(null);

/** The signed-in admin or viewer, for pages that show admin-only buttons. */
export function useAdminUser(): AdminUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useAdminUser outside AdminShell");
  return user;
}

/**
 * Admin frame. Laptops: a navy sidebar that floats beside the page (rounded, lifted off the edge) and a top bar.
 * Phones: a floating header with the logo and the account, and a dock at the bottom (see mobile-dock.tsx).
 */
export function AdminShell({ user, openAlerts, children }: { user: AdminUser; openAlerts: number; children: React.ReactNode }) {
  const t = useTranslations();

  return (
    <UserContext.Provider value={user}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* laptop: floating sidebar */}
        <aside className="sticky top-0 hidden h-dvh p-3 pr-0 lg:block">
          <Sidebar openAlerts={openAlerts} />
        </aside>

        {/* phone: floating header */}
        <div className="sticky top-0 z-30 px-3 pt-[max(0.6rem,env(safe-area-inset-top))] lg:hidden">
          <div className="flex h-14 items-center justify-between rounded-[1.25rem] bg-side/95 pr-1.5 pl-4 shadow-[0_12px_30px_-12px_rgb(15_26_61/0.55)] ring-1 ring-white/10 backdrop-blur-md">
            <Link href="/admin" className="rounded-lg">
              <Wordmark name={t("app.name")} />
            </Link>
            <UserMenu user={user} tone="onDark" />
          </div>
        </div>

        <div className="flex min-w-0 flex-col">
          <TopBar user={user} />
          <main className="flex-1 px-gutter pt-4 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pt-2 lg:pb-10">{children}</main>
        </div>
      </div>
      <MobileDock user={user} openAlerts={openAlerts} />
    </UserContext.Provider>
  );
}

function Sidebar({ openAlerts }: { openAlerts: number }) {
  const t = useTranslations();
  return (
    <nav
      aria-label={t("nav.main")}
      className="relative flex h-full flex-col gap-6 overflow-y-auto rounded-[1.75rem] bg-side px-3.5 py-5 shadow-[0_24px_60px_-20px_rgb(15_26_61/0.55),0_2px_6px_rgb(15_26_61/0.12)] ring-1 ring-white/[0.06] [scrollbar-width:none]"
    >
      {/* a soft light along the top edge, like a panel catching the light */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <div className="px-2 pt-1">
        <Wordmark name={t("app.name")} />
      </div>
      <ul className="flex flex-col gap-1">
        {MAIN_NAV.map((item) => (
          <NavLink key={item.key} item={item} badge={item.key === "alerts" ? openAlerts : 0} />
        ))}
      </ul>
      <div className="flex-1" />
      <ul className="flex flex-col gap-1 border-t border-white/10 pt-4">
        {FOOT_NAV.map((item) => (
          <NavLink key={item.key} item={item} />
        ))}
      </ul>
      <p className="px-3 font-display text-[0.7rem] tracking-wide text-side-text/60">{MOTTO}</p>
    </nav>
  );
}

function NavLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
  const pathname = usePathname();
  const t = useTranslations();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex h-11 items-center gap-3 rounded-2xl px-3 text-sm font-semibold transition-colors",
          active ? "text-white" : "text-side-text hover:bg-white/5 hover:text-white",
        )}
      >
        {active ? (
          // the highlight slides from the old item to the new one
          <motion.span
            layoutId="nav-active"
            className="absolute inset-0 rounded-2xl bg-side-active shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]"
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          />
        ) : null}
        <Icon size={19} weight={active ? "fill" : "regular"} className="relative" />
        <span className="relative flex-1">{t(`nav.${item.key}`)}</span>
        {badge ? (
          <span className="relative min-w-5 rounded-full bg-bad-dot px-1.5 text-center text-[0.7rem] leading-5 font-bold text-white tabular-nums">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        {item.phase2 ? (
          <span className="relative rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-bold tracking-wide text-sky uppercase">
            {t("common.phase2")}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function TopBar({ user }: { user: AdminUser }) {
  const t = useTranslations("common");
  const ta = useTranslations("adminAuth");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);

  // Ctrl+K (or Cmd+K) jumps to the search box from anywhere in the admin pages
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="hidden flex-wrap items-center gap-3 px-gutter py-4 lg:flex">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = input.current?.value.trim() ?? "";
          router.push(q ? `/admin/trips?q=${encodeURIComponent(q)}` : "/admin/trips");
          input.current?.blur();
        }}
        className="flex h-11 min-w-0 flex-1 basis-64 items-center gap-2.5 rounded-control border border-border bg-card px-3.5 transition-[border-color,box-shadow] focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--ring-soft)] sm:max-w-md"
      >
        <MagnifyingGlassIcon size={18} className="shrink-0 text-muted" />
        <label htmlFor="top-search" className="sr-only">
          {t("search")}
        </label>
        <input
          ref={input}
          id="top-search"
          type="search"
          name="q"
          autoComplete="off"
          placeholder={t("searchHint")}
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[0.7rem] text-muted sm:inline">
          Ctrl K
        </kbd>
      </form>
      <div className="ml-auto flex items-center gap-2">
        {user.role === "viewer" ? (
          <span className="hidden items-center gap-1.5 rounded-full bg-soft px-3 py-1.5 text-xs font-bold text-title sm:inline-flex">
            <EyeIcon size={14} weight="bold" />
            {ta("viewOnly")}
          </span>
        ) : null}
        <LanguageSwitch />
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Avatar with the username; opens a small menu with the role and "Sign out". */
export function UserMenu({ user, tone = "onLight" }: { user: AdminUser; tone?: "onLight" | "onDark" }) {
  const t = useTranslations("adminAuth");
  const [leaving, setLeaving] = useState(false);

  async function signOut() {
    setLeaving(true);
    try {
      await adminApi.signOut();
    } catch {
      /* the cookie goes anyway when it expires; still leave */
    }
    window.location.replace("/admin/login");
  }

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("accountMenu", { name: user.username })}
          className={cn(
            "group inline-flex h-11 items-center gap-1.5 rounded-full pr-2.5 pl-1 transition-colors",
            tone === "onDark"
              ? "bg-white/10 text-white hover:bg-white/15 data-[state=open]:bg-white/15"
              : "bg-soft text-title hover:bg-ring-soft data-[state=open]:bg-ring-soft",
          )}
        >
          <span
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full font-display text-sm font-semibold",
              tone === "onDark" ? "bg-white text-navy" : "bg-navy text-white",
            )}
          >
            {initials(user.username)}
          </span>
          <CaretDownIcon size={14} weight="bold" className="transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 origin-(--radix-dropdown-menu-content-transform-origin) rounded-card border border-border bg-card p-2 shadow-lift data-[state=open]:animate-[menu-in_160ms_var(--ease-out-soft)]"
        >
          <div className="flex flex-col gap-1 px-3 pt-2 pb-3">
            <span className="truncate font-display text-base font-semibold text-title">{user.username}</span>
            <span
              className={cn(
                "w-fit rounded-full px-2.5 py-0.5 text-xs font-bold",
                user.role === "admin" ? "bg-trip-bg text-trip-fg" : "bg-off-bg text-off-fg",
              )}
            >
              {user.role === "admin" ? t("roleAdmin") : t("roleViewer")}
            </span>
            <span className="text-xs text-muted">{user.role === "admin" ? t("roleAdminHint") : t("roleViewerHint")}</span>
          </div>
          <DropdownMenu.Separator className="mx-1 my-1 h-px bg-border" />
          <DropdownMenu.Item
            onSelect={(e) => {
              e.preventDefault();
              void signOut();
            }}
            disabled={leaving}
            className="flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-semibold text-bad-fg outline-none data-highlighted:bg-bad-bg"
          >
            {leaving ? <CircleNotchIcon size={18} className="animate-spin" /> : <SignOutIcon size={18} weight="bold" />}
            {t("signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
