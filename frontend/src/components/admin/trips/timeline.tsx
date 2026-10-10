"use client";

import { DeviceMobileIcon, MapPinIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import type { TimelineEvent } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { mapsLink } from "./meter-check";

const KNOWN = new Set([
  "trip_started", "trip_started_unconfirmed", "journey_started", "trip_end_submitted", "trip_completed",
  "trip_completed_unconfirmed", "trip_cancelled", "trip_closed_by_admin", "trip_unlocked", "trip_approved", "trip_rejected",
  "start_qr_renewed", "end_qr_renewed", "passenger_lookup", "passenger_wrong_id", "qr_blocked", "alert_solved",
]);

/** Colour of the dot: who did the step. Problems (wrong IDs, blocks, cancel, reject) are red whoever did them. */
function tone(e: TimelineEvent): string {
  if (["passenger_wrong_id", "qr_blocked", "trip_cancelled", "trip_rejected"].includes(e.event)) return "bg-bad-dot";
  if (e.event.endsWith("_unconfirmed")) return "bg-wait-dot";
  switch (e.who.kind) {
    case "driver":
      return "bg-trip-dot";
    case "passenger":
    case "visitor":
      return "bg-ok-dot";
    case "admin":
      return "bg-navy dark:bg-sky";
    default:
      return "bg-wait-dot";
  }
}

/** A short readable device name from the browser's description ("Android · Chrome"). */
function deviceName(ua: string | null): string | null {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac OS X/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, browser].filter(Boolean).join(" · ") || ua.slice(0, 60);
}

/** Every step of the trip in order: what happened, who did it, when; device, IP and GPS on request. */
export function Timeline({ events, visitorName }: { events: TimelineEvent[]; visitorName: string | null }) {
  const t = useTranslations("tripDetail.timeline");
  const format = useFormatter();
  const days = events.map((e) => format.dateTime(new Date(e.at), { weekday: "short", day: "numeric", month: "short" }));

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
        <span className="text-sm text-muted">{t("count", { count: events.length })}</span>
      </div>
      <ol className="relative flex flex-col">
        {events.map((e, i) => {
          const day = days[i];
          const showDay = i === 0 || day !== days[i - 1];
          return (
            <motion.li
              key={e.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(0.5, 0.04 * i), duration: 0.3 }}
              className="relative flex flex-col"
            >
              {showDay ? <span className="mb-2 pl-8 text-xs font-bold text-muted">{day}</span> : null}
              <Step event={e} last={i === events.length - 1} dot={tone(e)} visitorName={visitorName} />
            </motion.li>
          );
        })}
      </ol>
    </Card>
  );
}

function Step({ event: e, last, dot, visitorName }: { event: TimelineEvent; last: boolean; dot: string; visitorName: string | null }) {
  const t = useTranslations("tripDetail.timeline");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const device = deviceName(e.device);
  const hasExtra = Boolean(device || e.ip || (e.lat !== null && e.lng !== null));
  const d = e.detail ?? {};
  const str = (k: string) => (typeof d[k] === "string" && d[k] ? (d[k] as string) : null);
  const num = (k: string) => (typeof d[k] === "number" ? (d[k] as number) : null);

  const who =
    e.who.kind === "system"
      ? t("who.system")
      : e.who.kind === "visitor"
        ? t("who.visitor", { name: visitorName ?? e.who.ref ?? "" })
        : e.who.name
          ? t(`who.${e.who.kind}`, { name: e.who.name })
          : e.who.kind === "passenger"
            ? t("who.passengerUnknown")
            : t(`who.${e.who.kind}`, { name: e.who.ref ?? "" });

  const notes: string[] = [];
  if (num("start_km") !== null) notes.push(t("note.startKm", { km: num("start_km")!.toLocaleString("en-US") }));
  if (num("end_km") !== null && e.event !== "trip_closed_by_admin")
    notes.push(
      num("distance_km") !== null
        ? t("note.endKm", { km: num("end_km")!.toLocaleString("en-US"), distance: num("distance_km")! })
        : t("note.endKmOnly", { km: num("end_km")!.toLocaleString("en-US") }),
    );
  if (e.event === "trip_closed_by_admin" && num("end_km") !== null) notes.push(t("note.endKmOnly", { km: num("end_km")!.toLocaleString("en-US") }));
  if (str("typed_id")) notes.push(t("note.typed", { id: str("typed_id")!, n: num("wrong_tries") ?? 1 }));
  if (str("reason")) notes.push(t("note.reason", { text: str("reason")! }));
  if (str("note")) notes.push(t("note.note", { text: str("note")! }));
  if (str("stage")) notes.push(t("note.stage", { stage: t(`stage.${str("stage")}`) }));
  if (d.identified_at_end === true) notes.push(t("note.identifiedAtEnd"));
  if (str("visitor") && e.event === "journey_started") notes.push(t("note.visitor", { name: str("visitor")! }));

  return (
    <div className="relative flex gap-3 pb-5">
      {/* the line down to the next step */}
      {!last ? <span aria-hidden="true" className="absolute top-4 bottom-0 left-[0.6875rem] w-0.5 rounded bg-border" /> : null}
      <span aria-hidden="true" className="relative mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-card">
        <span className={cn("size-3 rounded-full ring-4 ring-card", dot)} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 font-semibold text-title">{KNOWN.has(e.event) ? t(`events.${e.event}`) : e.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            <time dateTime={e.at} className="pt-0.5 font-mono text-xs text-muted tabular-nums">
              {format.dateTime(new Date(e.at), { hour: "numeric", minute: "2-digit", second: "2-digit" })}
            </time>
            {hasExtra ? (
              <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label={t("deviceToggle")}
                title={t("deviceToggle")}
                className={cn(
                  "-my-1 inline-flex size-7 items-center justify-center rounded-full transition-colors",
                  open ? "bg-soft text-title" : "text-muted hover:bg-soft hover:text-title",
                )}
              >
                <DeviceMobileIcon size={15} weight={open ? "fill" : "regular"} />
              </button>
            ) : null}
          </span>
        </div>
        <span className="text-sm text-muted">{who}</span>
        {notes.map((n) => (
          <span key={n} className="text-sm text-text">
            {n}
          </span>
        ))}
        {hasExtra ? (
          <>
            <AnimatePresence initial={false}>
              {open ? (
                <motion.dl
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-hidden rounded-xl bg-bay px-3 py-2 text-xs"
                >
                  {device ? (
                    <>
                      <dt className="flex items-center gap-1 text-muted">
                        <DeviceMobileIcon size={13} />
                        {t("device")}
                      </dt>
                      <dd className="truncate text-text" title={e.device ?? undefined}>
                        {device}
                      </dd>
                    </>
                  ) : null}
                  {e.ip ? (
                    <>
                      <dt className="text-muted">{t("ip")}</dt>
                      <dd className="font-mono text-text">{e.ip}</dd>
                    </>
                  ) : null}
                  {e.lat !== null && e.lng !== null ? (
                    <>
                      <dt className="flex items-center gap-1 text-muted">
                        <MapPinIcon size={13} />
                        {t("gps")}
                      </dt>
                      <dd>
                        <a href={mapsLink({ lat: e.lat, lng: e.lng })} target="_blank" rel="noreferrer" className="font-mono text-accent hover:underline">
                          {e.lat.toFixed(5)}, {e.lng.toFixed(5)}
                        </a>
                      </dd>
                    </>
                  ) : null}
                </motion.dl>
              ) : null}
            </AnimatePresence>
          </>
        ) : null}
      </div>
    </div>
  );
}
