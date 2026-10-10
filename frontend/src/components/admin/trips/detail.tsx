"use client";

import {
  ArrowLeftIcon,
  CheckCircleIcon,
  IdentificationBadgeIcon,
  InfoIcon,
  LockKeyIcon,
  PhoneIcon,
  ProhibitIcon,
  SealCheckIcon,
  SealWarningIcon,
  SteeringWheelIcon,
  UserIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { TripStatusChip } from "@/components/admin/trip-status";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import type { Alert, TripDetail } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { useDuration } from "../dashboard/bits";
import { TripActions, type Done } from "./actions";
import { MeterCheck } from "./meter-check";
import { Timeline } from "./timeline";

type Trip = TripDetail["trip"];

/** One trip, everything the office needs to check it, and the admin actions that fit its state. */
export function TripDetailView({ data }: { data: TripDetail }) {
  const t = useTranslations("tripDetail");
  const format = useFormatter();
  const user = useAdminUser();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [done, setDone] = useState<Done | null>(null);
  const { trip } = data;

  function afterAction(what: Done) {
    setDone(what);
    startTransition(() => router.refresh());
    setTimeout(() => setDone((d) => (d === what ? null : d)), 5000);
  }

  return (
    <div className="flex flex-col gap-section">
      <Reveal className="flex flex-col gap-4">
        <BackLink label={t("back")} />
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-3xl font-semibold tracking-tight text-title">{trip.trip_no}</h1>
              <TripStatusChip status={trip.status} size="md" />
            </div>
            <p className="text-sm text-muted">
              {t("subtitle", {
                date: format.dateTime(new Date(trip.start_time), { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
                car: trip.vehicle.car_code,
                model: trip.vehicle.model,
                reg: trip.vehicle.reg_number,
              })}
            </p>
          </div>
          {user.role === "admin" ? <TripActions trip={trip} onDone={afterAction} /> : null}
        </div>
      </Reveal>

      <AnimatePresence>
        {done ? (
          <motion.p
            key={done}
            role="status"
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2.5 overflow-hidden rounded-2xl bg-ok-bg px-4 py-3 text-sm font-semibold text-ok-fg"
          >
            <CheckCircleIcon size={20} weight="fill" className="shrink-0" />
            {t(`done.${done}`)}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Notices trip={trip} />

      <div className="grid gap-section xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-section">
          <Reveal delay={0.06}>
            <MeterCheck trip={trip} />
          </Reveal>
          <div className="grid gap-section md:grid-cols-2">
            <Reveal delay={0.12} className="min-w-0">
              <People trip={trip} />
            </Reveal>
            <Reveal delay={0.16} className="min-w-0">
              <Journey trip={trip} />
            </Reveal>
          </div>
          {data.alerts.length ? (
            <Reveal delay={0.2}>
              <TripAlerts alerts={data.alerts} />
            </Reveal>
          ) : null}
        </div>
        <Reveal delay={0.12} className="min-w-0 xl:sticky xl:top-4">
          <Timeline events={data.timeline} visitorName={trip.visitor?.name ?? null} />
        </Reveal>
      </div>
    </div>
  );
}

/** Back to the list with its filters (browser back), or to the plain list when the page was opened directly. */
function BackLink({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Link
      href="/admin/trips"
      onClick={(e) => {
        if (window.history.length > 1 && document.referrer.includes("/admin/trips")) {
          e.preventDefault();
          router.back();
        }
      }}
      className="inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-bold text-accent hover:underline"
    >
      <ArrowLeftIcon size={15} weight="bold" />
      {label}
    </Link>
  );
}

/** What needs attention on this trip, said once at the top: blocked QR, waiting approval, why it was closed or cancelled. */
function Notices({ trip }: { trip: Trip }) {
  const t = useTranslations("tripDetail.notice");
  const format = useFormatter();
  const items: { key: string; tone: "bad" | "wait" | "ok" | "off"; icon: React.ReactNode; title: string; body?: string }[] = [];

  if (trip.lock?.locked)
    items.push({ key: "lock", tone: "bad", icon: <LockKeyIcon size={20} weight="fill" />, title: t(`locked.${trip.lock.stage}`), body: t("lockedBody") });
  if (trip.approval_status) {
    const skipped = [
      trip.start_no_scan_reason ? t("skippedStart", { reason: trip.start_no_scan_reason }) : null,
      trip.end_no_scan_reason ? t("skippedEnd", { reason: trip.end_no_scan_reason }) : null,
    ].filter(Boolean) as string[];
    const decided =
      trip.approval_status !== "pending" && trip.approved_at
        ? t("decidedBy", {
            name: trip.approved_by_name ?? "admin",
            time: format.dateTime(new Date(trip.approved_at), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
          })
        : null;
    items.push({
      key: "approval",
      tone: trip.approval_status === "pending" ? "wait" : trip.approval_status === "approved" ? "ok" : "bad",
      icon:
        trip.approval_status === "rejected" ? <SealWarningIcon size={20} weight="fill" /> : <SealCheckIcon size={20} weight="fill" />,
      title: t(`approval.${trip.approval_status}`),
      body: [...skipped, trip.approval_note ? t("approvalNote", { note: trip.approval_note }) : null, decided].filter(Boolean).join("\n"),
    });
  }
  if (trip.status === "closed_by_admin" && trip.close_reason)
    items.push({ key: "closed", tone: "bad", icon: <ProhibitIcon size={20} weight="fill" />, title: t("closed"), body: trip.close_reason });
  if (trip.status === "cancelled" && trip.close_reason)
    items.push({ key: "cancelled", tone: "off", icon: <ProhibitIcon size={20} weight="fill" />, title: t("cancelled"), body: trip.close_reason });
  if (trip.needs_review && !trip.approval_status && trip.status !== "closed_by_admin")
    items.push({ key: "review", tone: "off", icon: <InfoIcon size={20} weight="fill" />, title: t("review"), body: trip.is_visitor ? t("reviewVisitor") : undefined });
  if (!items.length) return null;

  const tones = {
    bad: "bg-bad-bg text-bad-fg",
    wait: "bg-wait-bg text-wait-fg",
    ok: "bg-ok-bg text-ok-fg",
    off: "bg-soft text-title",
  };
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((n) => (
        <Reveal key={n.key}>
          <div className={cn("flex items-start gap-3 rounded-2xl px-4 py-3.5", tones[n.tone])}>
            <span className="mt-px shrink-0">{n.icon}</span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-bold">{n.title}</span>
              {n.body ? <span className="text-sm whitespace-pre-line opacity-90">{n.body}</span> : null}
            </div>
          </div>
        </Reveal>
      ))}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Person({
  icon,
  role,
  name,
  lines,
  phone,
  tone = "plain",
}: {
  icon: React.ReactNode;
  role: string;
  name: string;
  lines: string[];
  phone?: string | null;
  tone?: "plain" | "wait";
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full font-display text-sm font-semibold",
          tone === "wait" ? "bg-wait-bg text-wait-fg" : "bg-soft text-title",
        )}
      >
        {name ? initials(name) : icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          {icon}
          {role}
        </span>
        <span className="truncate font-semibold text-title">{name}</span>
        {lines.map((l) => (
          <span key={l} className="truncate text-sm text-muted">
            {l}
          </span>
        ))}
      </div>
      {phone ? (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          aria-label={phone}
          title={phone}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-accent transition-colors hover:bg-soft"
        >
          <PhoneIcon size={18} weight="bold" />
        </a>
      ) : null}
    </div>
  );
}

function People({ trip }: { trip: Trip }) {
  const t = useTranslations("tripDetail.people");
  return (
    <Card className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
      <Person
        icon={<SteeringWheelIcon size={13} weight="bold" />}
        role={t("driver")}
        name={trip.driver.name}
        lines={[trip.driver.employee_id]}
        phone={trip.driver.phone}
      />
      <div className="h-px bg-border" />
      {!trip.with_passenger ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{t("noPassenger")}</span>
          <span className="text-sm text-text">{t("purpose", { purpose: trip.purpose ?? "–" })}</span>
        </div>
      ) : trip.passenger ? (
        <Person
          icon={<IdentificationBadgeIcon size={13} weight="bold" />}
          role={t("employee")}
          name={trip.passenger.name}
          lines={[[trip.passenger.employee_id, trip.passenger.department].filter(Boolean).join(" · ")]}
        />
      ) : trip.visitor ? (
        <Person
          icon={<UserIcon size={13} weight="bold" />}
          role={t("visitor")}
          name={trip.visitor.name}
          lines={[trip.visitor.phone, ...(trip.visitor.reason ? [t("visitorReason", { reason: trip.visitor.reason })] : [])]}
          phone={trip.visitor.phone}
        />
      ) : (
        <Person icon={<UserIcon size={13} weight="bold" />} role={t("passenger")} name="" lines={[t("unknownPassenger")]} tone="wait" />
      )}
      {trip.with_passenger && trip.purpose ? <span className="text-sm text-muted">{t("purpose", { purpose: trip.purpose })}</span> : null}
    </Card>
  );
}

/** The trip's moments in plain words: started, passenger confirmed, ended, end confirmed, and how long it took. */
function Journey({ trip }: { trip: Trip }) {
  const t = useTranslations("tripDetail.journey");
  const format = useFormatter();
  const duration = useDuration();
  const time = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { hour: "numeric", minute: "2-digit" }) : null);

  const rows: { label: string; value: string | null; muted?: boolean; warn?: boolean }[] = [
    { label: t("started"), value: time(trip.start_time) },
  ];
  if (trip.with_passenger) {
    rows.push(
      trip.start_no_scan_reason
        ? { label: t("passengerStart"), value: t("notConfirmed"), warn: true }
        : { label: t("passengerStart"), value: time(trip.journey_start_time) ?? t("waiting"), muted: !trip.journey_start_time },
    );
  }
  rows.push({ label: t("ended"), value: time(trip.end_time) ?? t("notYet"), muted: !trip.end_time });
  if (trip.with_passenger) {
    rows.push(
      trip.end_no_scan_reason
        ? { label: t("passengerEnd"), value: t("notConfirmed"), warn: true }
        : { label: t("passengerEnd"), value: time(trip.end_confirm_time) ?? t("notYet"), muted: !trip.end_confirm_time },
    );
  }
  const from = trip.journey_start_time ?? trip.start_time;
  const seconds = trip.end_time ? (new Date(trip.end_time).getTime() - new Date(from).getTime()) / 1000 : null;

  return (
    <Card className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
      <dl className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3 text-sm">
            <dt className="text-muted">{r.label}</dt>
            <dd className={cn("shrink-0 text-right font-semibold whitespace-nowrap tabular-nums", r.warn ? "text-wait-fg" : r.muted ? "text-muted" : "text-title")}>
              {r.warn ? <WarningIcon size={13} weight="fill" className="mr-1 inline align-[-1px]" /> : null}
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-muted">{t("distance")}</span>
          <span className="font-display text-2xl font-bold text-title tabular-nums">{trip.distance_km !== null ? `${trip.distance_km} km` : "–"}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-muted">{t("duration")}</span>
          <span className="font-display text-2xl font-bold text-title">{seconds !== null ? duration(seconds) : "–"}</span>
        </div>
      </div>
    </Card>
  );
}

function TripAlerts({ alerts }: { alerts: Alert[] }) {
  const t = useTranslations("tripDetail");
  const ta = useTranslations("dashboard.alerts");
  const format = useFormatter();
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <h2 className="font-display text-lg font-semibold text-title">{t("alertsTitle")}</h2>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => (
          <li key={a.id} className="flex items-start gap-3 rounded-2xl border border-border p-3">
            <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", a.status === "open" ? "bg-bad-dot" : "bg-ok-dot")} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="text-sm font-bold text-title">{ta(`type.${a.type}`)}</span>
                <span className="text-xs text-muted">
                  {format.dateTime(new Date(a.created_at), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-sm text-muted">{a.message}</p>
              <span className={cn("text-xs font-semibold", a.status === "open" ? "text-bad-fg" : "text-ok-fg")}>
                {a.status === "open" ? t("alertOpen") : a.note ? t("alertSolvedNote", { note: a.note }) : t("alertSolved")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
