"use client";

import { ArrowRightIcon, CameraSlashIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, MapPinIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { Odometer } from "@/components/ui/odometer";
import type { TripDetail } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type Trip = TripDetail["trip"];

export function mapsLink(p: { lat: number; lng: number }) {
  return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
}

/**
 * The office's main check on a trip: does the km the driver typed match the odometer in the photo?
 * Start and end side by side, each photo with the typed km under it, the distance in between.
 */
export function MeterCheck({ trip }: { trip: Trip }) {
  const t = useTranslations("tripDetail.meter");
  const ended = trip.end_km !== null;
  const open = ["waiting_for_passenger", "in_progress", "waiting_for_end_confirm"].includes(trip.status);
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
          <p className="text-sm text-muted">{t("hint")}</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
        <Side
          stage="start"
          photo={trip.photos.start.url}
          km={trip.start_km}
          place={trip.start_place}
          time={trip.start_time}
          point={trip.map_points.start}
        />
        <div className="flex items-center justify-center md:flex-col">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.35, type: "spring", stiffness: 380, damping: 20 }}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-2 md:flex-col md:gap-1 md:rounded-2xl md:px-3 md:py-3",
              ended ? "bg-trip-bg text-trip-fg" : "bg-soft text-muted",
            )}
          >
            <ArrowRightIcon size={16} weight="bold" className="md:hidden" />
            <span className="font-display text-xl leading-none font-bold tabular-nums">{ended ? `+${trip.distance_km}` : open ? "…" : "–"}</span>
            <span className="text-xs font-semibold">km</span>
          </motion.div>
        </div>
        <Side
          stage="end"
          photo={trip.photos.end.url}
          km={trip.end_km}
          place={trip.end_place}
          time={trip.end_time}
          point={trip.map_points.end}
          startKm={trip.start_km}
          stopped={!open && trip.end_km === null}
        />
      </div>
    </Card>
  );
}

function Side({
  stage,
  photo,
  km,
  place,
  time,
  point,
  startKm,
  stopped,
}: {
  stage: "start" | "end";
  photo: string | null;
  km: number | null;
  place: string | null;
  time: string | null;
  point: { lat: number; lng: number } | null;
  startKm?: number;
  /** closed or cancelled before the driver ended it */
  stopped?: boolean;
}) {
  const t = useTranslations("tripDetail.meter");
  const format = useFormatter();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="text-sm font-bold text-title">{stage === "start" ? t("start") : t("end")}</span>
      {photo ? (
        <PhotoZoom src={photo} alt={stage === "start" ? t("startAlt") : t("endAlt")} km={km} />
      ) : (
        <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-border-strong bg-bay text-center text-sm text-muted">
          <CameraSlashIcon size={28} weight="duotone" />
          {km !== null ? t("noPhoto") : stopped ? t("neverEnded") : t("notEnded")}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{t("typed")}</span>
          {km !== null ? <Odometer value={km} from={startKm} size="sm" rollIn={stage === "end"} /> : <span className="text-sm text-muted">–</span>}
        </div>
        <div className="flex min-w-0 flex-col items-end gap-0.5 text-right">
          {place ? <span className="max-w-full truncate text-sm font-semibold text-text">{place}</span> : null}
          <span className="flex items-center gap-2 text-xs text-muted">
            {time ? format.dateTime(new Date(time), { hour: "numeric", minute: "2-digit" }) : null}
            {point ? (
              <a href={mapsLink(point)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-semibold text-accent hover:underline">
                <MapPinIcon size={13} weight="fill" />
                {t("map")}
              </a>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The photo; click opens it big. In the big view, click (or tap) zooms in where you point and the zoomed
 * part follows the mouse, so the odometer digits can be read. The typed km stays in the corner to compare.
 * Photo links expire after 10 minutes: a failed load fetches the page again for fresh links.
 */
function PhotoZoom({ src, alt, km }: { src: string; alt: string; km: number | null }) {
  const t = useTranslations("tripDetail.meter");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const [loaded, setLoaded] = useState(false);
  const retried = useRef(false);

  function aim(e: React.PointerEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
  }

  const failed = () => {
    if (retried.current) return;
    retried.current = true;
    router.refresh();
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setZoom(false);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl bg-odo-tile outline-none focus-visible:ring-4 focus-visible:ring-ring-soft"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived photo link */}
          <img
            src={src}
            alt={alt}
            onLoad={() => setLoaded(true)}
            onError={failed}
            className={cn(
              "size-full object-cover transition-[transform,opacity] duration-500 group-hover:scale-[1.03]",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
          {!loaded ? <span className="skeleton absolute inset-0" /> : null}
          <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1.5 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-bold text-white opacity-90 backdrop-blur transition-opacity group-hover:opacity-100">
            <MagnifyingGlassPlusIcon size={14} weight="bold" />
            {t("enlarge")}
          </span>
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-ink/95" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-0 z-50 flex flex-col"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
              >
                <div className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 text-white">
                  <Dialog.Title className="truncate text-sm font-semibold text-[#c9d3ea]">{alt}</Dialog.Title>
                  <div className="flex items-center gap-2">
                    {km !== null ? (
                      <span className="flex items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1">
                        <Odometer value={km} size="sm" rollIn={false} />
                        <span className="text-xs text-[#c9d3ea]">{t("typedShort")}</span>
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setZoom((z) => !z)}
                      aria-label={zoom ? t("zoomOut") : t("zoomIn")}
                      className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
                    >
                      {zoom ? <MagnifyingGlassMinusIcon size={20} weight="bold" /> : <MagnifyingGlassPlusIcon size={20} weight="bold" />}
                    </button>
                    <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label={t("closePhoto")}>
                      <XIcon size={20} weight="bold" />
                    </Dialog.Close>
                  </div>
                </div>
                <div
                  className={cn("relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-6", zoom ? "cursor-zoom-out" : "cursor-zoom-in")}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && !zoom) setOpen(false);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived photo link */}
                  <img
                    src={src}
                    alt={alt}
                    onPointerMove={(e) => zoom && aim(e)}
                    onClick={(e) => {
                      aim(e as unknown as React.PointerEvent<HTMLElement>);
                      setZoom((z) => !z);
                    }}
                    className="max-h-full max-w-full rounded-xl object-contain shadow-2xl transition-transform duration-300 ease-out select-none"
                    style={{ transform: zoom ? "scale(2.6)" : "scale(1)", transformOrigin: origin }}
                    draggable={false}
                  />
                </div>
                <p className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-xs text-[#9aa6c6]">{zoom ? t("zoomedHint") : t("zoomHint")}</p>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
