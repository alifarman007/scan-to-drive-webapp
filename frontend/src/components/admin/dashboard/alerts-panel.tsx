"use client";

import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockIcon,
  GaugeIcon,
  HourglassHighIcon,
  LockKeyIcon,
  ProhibitIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { Popover } from "radix-ui";
import { useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useNowSeconds } from "@/lib/hooks";
import { adminApi, isSignedOut, toSignIn, type Alert, type AlertType } from "@/lib/admin-api";

import { PanelTitle } from "./bits";

const ICON: Record<AlertType, typeof GaugeIcon> = {
  km_gap: GaugeIcon,
  long_trip: HourglassHighIcon,
  waiting_too_long: ClockIcon,
  wrong_ids: LockKeyIcon,
  high_km: TrendUpIcon,
  admin_closed: ProhibitIcon,
};

/** Open alerts from the background checks, newest first. Admins can mark one as solved with a note. */
export function AlertsPanel({ alerts, total, asOf, onChanged }: { alerts: Alert[]; total: number; asOf: string; onChanged: () => void }) {
  const t = useTranslations("dashboard.alerts");
  const [gone, setGone] = useState<number[]>([]);
  const shown = alerts.filter((a) => !gone.includes(a.id));

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle title={t("title")} hint={total ? t("hint", { count: total }) : undefined}>
        <Link href="/admin/alerts" className="inline-flex items-center gap-1 text-sm font-bold text-accent hover:underline">
          {t("seeAll")}
          <ArrowRightIcon size={14} weight="bold" />
        </Link>
      </PanelTitle>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-ok-bg/60 px-4 py-8 text-center">
          <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-ok-dot">
            <CheckCircleIcon size={36} weight="fill" />
          </motion.span>
          <p className="font-semibold text-ok-fg">{t("emptyTitle")}</p>
          <p className="text-sm text-ok-fg/80">{t("emptyBody")}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {shown.map((a) => (
              <motion.li
                key={a.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.25 } }}
              >
                <AlertRow
                  alert={a}
                  asOf={asOf}
                  onSolved={() => {
                    setGone((g) => [...g, a.id]);
                    onChanged();
                  }}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </Card>
  );
}

function AlertRow({ alert, asOf, onSolved }: { alert: Alert; asOf: string; onSolved: () => void }) {
  const t = useTranslations("dashboard.alerts");
  const format = useFormatter();
  const user = useAdminUser();
  const nowSeconds = useNowSeconds();
  const now = nowSeconds === null ? new Date(asOf) : new Date(nowSeconds * 1000);
  const Icon = ICON[alert.type] ?? GaugeIcon;
  const serious = alert.type === "wrong_ids" || alert.type === "high_km" || alert.type === "km_gap";

  return (
    <div className="flex gap-3 rounded-2xl border border-border p-3">
      <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${serious ? "bg-bad-bg text-bad-fg" : "bg-wait-bg text-wait-fg"}`}>
        <Icon size={18} weight="duotone" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-sm font-bold text-title">{t(`type.${alert.type}`)}</span>
          <time dateTime={alert.created_at} className="text-xs text-muted" title={format.dateTime(new Date(alert.created_at), { dateStyle: "medium", timeStyle: "short" })}>
            {format.relativeTime(new Date(alert.created_at), now)}
          </time>
        </div>
        <p className="text-sm leading-snug text-muted">{alert.message}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted">{[alert.car_code, alert.trip_no].filter(Boolean).join(" · ")}</span>
          {user.role === "admin" ? <SolveButton alert={alert} onSolved={onSolved} /> : null}
        </div>
      </div>
    </div>
  );
}

function SolveButton({ alert, onSolved }: { alert: Alert; onSolved: () => void }) {
  const t = useTranslations("dashboard.alerts");
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function solve() {
    setBusy(true);
    setError(false);
    try {
      await adminApi.solveAlert(alert.id, note.trim());
      setOpen(false);
      onSolved();
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      // already solved by someone else: just take it off the list
      if (err && typeof err === "object" && "status" in err && err.status === 409) {
        setOpen(false);
        onSolved();
        return;
      }
      setError(true);
      setBusy(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <Popover.Trigger asChild>
        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-accent transition-colors hover:bg-soft">
          <CheckIcon size={14} weight="bold" />
          {t("solve")}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex w-72 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-lift data-[state=open]:animate-[menu-in_160ms_var(--ease-out-soft)]"
        >
          <label htmlFor={`note-${alert.id}`} className="text-sm font-semibold text-title">
            {t("noteLabel")}
          </label>
          <textarea
            id={`note-${alert.id}`}
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="w-full resize-none rounded-control border-[1.5px] border-border-strong bg-card px-3 py-2 text-sm text-text outline-none placeholder:text-muted/70 focus:border-ring focus:shadow-[0_0_0_4px_var(--ring-soft)]"
          />
          {error ? <p className="text-sm font-semibold text-bad-fg">{t("solveFailed")}</p> : null}
          <Button size="md" onClick={() => void solve()} disabled={busy}>
            {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : <CheckIcon size={18} weight="bold" />}
            {t("markSolved")}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
