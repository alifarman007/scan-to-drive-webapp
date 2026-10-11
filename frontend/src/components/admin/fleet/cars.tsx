"use client";

import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CarIcon,
  CircleNotchIcon,
  FilePdfIcon,
  GaugeIcon,
  PencilSimpleIcon,
  PlusIcon,
  PrinterIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { LiveDot } from "@/components/ui/live-dot";
import { Modal } from "@/components/ui/modal";
import { Odometer } from "@/components/ui/odometer";
import { QrCode } from "@/components/ui/qr-code";
import { Reveal } from "@/components/ui/reveal";
import { StatusChip, type Status } from "@/components/ui/status-chip";
import { ApiError } from "@/lib/api";
import { adminApi, isSignedOut, stickerHref, toSignIn, type Car, type CarDetail, type CarStatus } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import {
  ActivityChart,
  EmptyList,
  PageHeader,
  Plate,
  RatingBadge,
  RecentTrips,
  SearchBox,
  Segmented,
  Stat,
  useDropNewParam,
  useFlash,
  useUrlState,
} from "./shared";

/* ------------------------------------------------------------------------------------------------ */
/*  what a car is doing right now                                                                    */
/* ------------------------------------------------------------------------------------------------ */

type CarState = "on_trip" | "waiting" | "available" | "maintenance" | "inactive";

export function carState(car: Car): CarState {
  if (car.status === "inactive") return "inactive";
  if (car.status === "maintenance") return "maintenance";
  if (car.open_trip) return car.open_trip.status === "in_progress" ? "on_trip" : "waiting";
  return "available";
}

const EDGE: Record<CarState, string> = {
  on_trip: "before:bg-trip-dot",
  waiting: "before:bg-wait-dot",
  available: "before:bg-ok-dot",
  maintenance: "before:bg-off-dot",
  inactive: "before:bg-off-dot",
};

function CarStateChip({ car, size = "sm" }: { car: Car; size?: "sm" | "md" }) {
  const t = useTranslations("cars.state");
  const state = carState(car);
  return (
    <StatusChip status={state as Status} size={size} live={state === "on_trip"}>
      {t(state)}
    </StatusChip>
  );
}

/** "CAR-11" after the highest CAR-nn code there is. */
function nextCarCode(cars: Car[]) {
  const numbers = cars.map((c) => /^CAR-(\d+)$/i.exec(c.car_code)?.[1]).filter(Boolean).map(Number);
  return `CAR-${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

function errorText(t: (k: string) => string, err: unknown) {
  if (err instanceof ApiError) {
    if (["CAR_CODE_EXISTS", "REG_NUMBER_EXISTS", "CAR_HAS_OPEN_TRIP", "REASON_REQUIRED", "CAR_EXISTS"].includes(err.code)) return t(`errors.${err.code}`);
    if (err.status === 422) return t("errors.check");
    if (err.status === 0 || err.code === "BACKEND_DOWN") return t("errors.network");
  }
  return t("errors.generic");
}

/* ------------------------------------------------------------------------------------------------ */
/*  list                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

type Filter = "" | "on_trip" | "available" | "maintenance" | "inactive";

/** All cars as "garage bays": what each car is doing, its plate, odometer and numbers. Search and a state filter. */
export function CarsList({ cars, initialQ, initialFilter }: { cars: Car[]; initialQ: string; initialFilter: Filter }) {
  const t = useTranslations("cars");
  const user = useAdminUser();
  const router = useRouter();
  const [q, setQ] = useUrlState("q", initialQ);
  const [filter, setFilter] = useUrlState<Filter>("state", initialFilter);
  const [adding, setAdding] = useState(false);

  const count = (f: Filter) =>
    cars.filter((c) => {
      const s = carState(c);
      return !f || (f === "on_trip" ? s === "on_trip" || s === "waiting" : s === f);
    }).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cars.filter((c) => {
      const s = carState(c);
      if (filter && (filter === "on_trip" ? s !== "on_trip" && s !== "waiting" : s !== filter)) return false;
      if (!needle) return true;
      return [c.car_code, c.reg_number, c.model, c.open_trip?.driver_name ?? ""].some((x) => x.toLowerCase().includes(needle));
    });
  }, [cars, q, filter]);

  const totalKm = cars.reduce((s, c) => s + c.total_km, 0);

  return (
    <div className="flex flex-col gap-section">
      <Reveal>
        <PageHeader title={t("title")} summary={t("summary", { cars: cars.length, km: totalKm.toLocaleString("en-US") })}>
          {user.role === "admin" ? (
            <Button size="md" lift onClick={() => setAdding(true)}>
              <PlusIcon size={18} weight="bold" />
              {t("add")}
            </Button>
          ) : null}
        </PageHeader>
      </Reveal>

      <Reveal delay={0.05} className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchBox value={q} onChange={setQ} label={t("searchLabel")} placeholder={t("searchHint")} className="lg:w-80" />
        <Segmented
          id="cars-filter"
          label={t("filterLabel")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "", label: t("filter.all"), count: count("") },
            { value: "on_trip", label: t("filter.on_trip"), count: count("on_trip"), dot: "bg-trip-dot" },
            { value: "available", label: t("filter.available"), count: count("available"), dot: "bg-ok-dot" },
            { value: "maintenance", label: t("filter.maintenance"), count: count("maintenance"), dot: "bg-off-dot" },
            { value: "inactive", label: t("filter.inactive"), count: count("inactive") },
          ]}
        />
      </Reveal>

      {shown.length === 0 ? (
        <EmptyList
          icon={<CarIcon size={28} weight="duotone" />}
          title={cars.length ? t("emptyTitle") : t("noneTitle")}
          body={cars.length ? t("emptyBody") : t("noneBody")}
        />
      ) : (
        <motion.ul layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((car, i) => (
              <motion.li
                key={car.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03, duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              >
                <CarCard car={car} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <CarFormModal
        open={adding}
        onOpenChange={setAdding}
        suggestCode={nextCarCode(cars)}
        models={[...new Set(cars.map((c) => c.model))]}
        onSaved={(car) => router.push(`/admin/cars/${car.id}?new=1`)}
      />
    </div>
  );
}

function CarCard({ car }: { car: Car }) {
  const t = useTranslations("cars");
  const state = carState(car);
  return (
    <Link
      href={`/admin/cars/${car.id}`}
      className={cn(
        "group relative flex h-full flex-col gap-4 overflow-hidden rounded-card border border-border bg-card p-4 pl-5 transition-[transform,box-shadow,border-color] duration-200 outline-none",
        "before:absolute before:inset-y-0 before:left-0 before:w-1.5 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift focus-visible:shadow-[0_0_0_4px_var(--ring-soft)]",
        EDGE[state],
        (state === "inactive" || state === "maintenance") && "bg-bay/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-2xl leading-none font-bold text-title">{car.car_code}</span>
          <span className="truncate text-sm text-muted">{car.model}</span>
        </div>
        <CarStateChip car={car} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Plate reg={car.reg_number} size="sm" />
        {car.open_alerts ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-bad-bg px-2 py-0.5 text-xs font-bold text-bad-fg">
            <WarningCircleIcon size={13} weight="fill" />
            {t("alerts", { count: car.open_alerts })}
          </span>
        ) : null}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-3">
        <Odometer value={car.current_km} size="sm" rollIn={false} />
        <div className="flex flex-col items-end gap-1 text-right text-xs text-muted">
          <span>
            <b className="font-bold text-title tabular-nums">{car.total_trips}</b> {t("tripsShort")} ·{" "}
            <b className="font-bold text-title tabular-nums">{car.total_km.toLocaleString("en-US")}</b> km
          </span>
          <RatingBadge rating={car.rating} />
        </div>
      </div>
      {car.open_trip ? (
        <div className="-mx-4 -mb-4 -ml-5 flex items-center gap-2 bg-trip-bg/70 px-5 py-2 text-xs font-semibold text-trip-fg">
          {car.open_trip.status === "in_progress" ? <LiveDot className="bg-trip-dot" /> : <span className="size-2 rounded-full bg-wait-dot" />}
          <span className="truncate">{car.open_trip.driver_name}</span>
          <span className="ml-auto font-mono">{car.open_trip.trip_no}</span>
        </div>
      ) : null}
    </Link>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  detail                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export function CarDetailView({ data, isNew }: { data: CarDetail; isNew: boolean }) {
  const t = useTranslations("cars");
  const format = useFormatter();
  const user = useAdminUser();
  const router = useRouter();
  const [flash, showFlash] = useFlash();
  const [editing, setEditing] = useState(false);
  const [fixingKm, setFixingKm] = useState(false);
  const { car } = data;
  const admin = user.role === "admin";
  useDropNewParam(isNew);

  const saved = (text: string) => {
    showFlash(text);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-section">
      <Reveal className="flex flex-col gap-3">
        <Link href="/admin/cars" className="inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-bold text-accent hover:underline">
          <ArrowLeftIcon size={15} weight="bold" />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-4xl leading-none font-bold text-title">{car.car_code}</h1>
              <CarStateChip car={car} size="md" />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-muted">
              <span className="font-semibold text-text">{car.model}</span>
              <Plate reg={car.reg_number} />
            </div>
          </div>
          {admin ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="md" onClick={() => setFixingKm(true)}>
                <GaugeIcon size={18} weight="bold" />
                {t("fixKm")}
              </Button>
              <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
                <PencilSimpleIcon size={18} weight="bold" />
                {t("edit")}
              </Button>
            </div>
          ) : null}
        </div>
      </Reveal>

      <AnimatePresence>
        {isNew ? (
          <motion.p
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2.5 rounded-2xl bg-ok-bg px-4 py-3 text-sm font-semibold text-ok-fg"
          >
            <PrinterIcon size={18} weight="duotone" className="shrink-0" />
            {t("newCarNote")}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-section">
          <Reveal delay={0.05}>
            <Card className="flex flex-col gap-5 p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold tracking-wide text-muted uppercase">{t("odometer")}</span>
                  <Odometer value={car.current_km} size="lg" unit="km" />
                </div>
                {car.open_trip ? (
                  <Link
                    href={`/admin/trips/${car.open_trip.id}`}
                    className="flex items-center gap-3 rounded-2xl bg-trip-bg px-4 py-3 text-trip-fg transition-transform hover:-translate-y-0.5"
                  >
                    <LiveDot className="bg-trip-dot" />
                    <span className="flex flex-col">
                      <span className="text-xs font-semibold">{t("onTripWith")}</span>
                      <span className="font-bold">{car.open_trip.driver_name}</span>
                    </span>
                    <span className="font-mono text-sm">{car.open_trip.trip_no}</span>
                  </Link>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
                <Stat label={t("stats.trips")} value={car.total_trips} />
                <Stat label={t("stats.km")} value={car.total_km.toLocaleString("en-US")} unit="km" />
                <Stat
                  label={t("stats.rating")}
                  value={car.rating ? car.rating.average.toFixed(1) : "–"}
                  unit={car.rating ? t("stats.ratingOf", { count: car.rating.count }) : undefined}
                />
                <Stat
                  label={t("stats.lastTrip")}
                  value={car.last_trip_at ? format.dateTime(new Date(car.last_trip_at), { day: "numeric", month: "short" }) : "–"}
                />
              </div>
              {car.open_alerts ? (
                <Link
                  href={`/admin/alerts?car=${car.id}`}
                  className="flex items-center gap-2 rounded-2xl bg-bad-bg px-4 py-2.5 text-sm font-bold text-bad-fg hover:underline"
                >
                  <WarningCircleIcon size={18} weight="fill" />
                  {t("openAlerts", { count: car.open_alerts })}
                </Link>
              ) : null}
            </Card>
          </Reveal>
          <Reveal delay={0.1}>
            <ActivityChart days={data.km_by_day} />
          </Reveal>
          <Reveal delay={0.15}>
            <RecentTrips trips={data.recent_trips} allHref={`/admin/trips?car=${car.id}`} show="driver" />
          </Reveal>
        </div>

        <div className="flex min-w-0 flex-col gap-section">
          <Reveal delay={0.08}>
            <StickerCard car={car} admin={admin} onRenewed={() => saved(t("stickerRenewed", { v: car.qr_version + 1 }))} />
          </Reveal>
          <Reveal delay={0.12}>
            <StatusCard car={car} admin={admin} onSaved={(s) => saved(t(`statusSaved.${s}`))} />
          </Reveal>
        </div>
      </div>

      <CarFormModal open={editing} onOpenChange={setEditing} car={car} models={[car.model]} onSaved={() => saved(t("saved"))} />
      <KmFixModal open={fixingKm} onOpenChange={setFixingKm} car={car} onSaved={() => saved(t("kmSaved"))} />
      {flash}
    </div>
  );
}

/**
 * What is stuck in the car, drawn like the printed one: navy band with the Epic logo, the QR, the car code.
 * It tilts a little towards the mouse. Print as a 6 x 6 cm label or on an A4 page; replace a lost or damaged one.
 */
function StickerCard({ car, admin, onRenewed }: { car: Car; admin: boolean; onRenewed: () => void }) {
  const t = useTranslations("cars.sticker");
  const ref = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function move(e: React.PointerEvent) {
    if (e.pointerType !== "mouse" || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -10, y: ((e.clientX - r.left) / r.width - 0.5) * 12 });
  }

  async function renew() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.newSticker(car.id);
      setConfirm(false);
      onRenewed();
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-lg font-semibold text-title">{t("title")}</h2>
          <p className="text-sm text-muted">{t("hint")}</p>
        </div>
        <span className="shrink-0 rounded-full bg-soft px-2.5 py-1 text-xs font-bold whitespace-nowrap text-accent">{t("version", { v: car.qr_version })}</span>
      </div>

      <div className="flex justify-center rounded-2xl bg-bay px-4 py-6 [perspective:900px]">
        <motion.div
          ref={ref}
          onPointerMove={move}
          onPointerLeave={() => setTilt({ x: 0, y: 0 })}
          animate={{ rotateX: tilt.x, rotateY: tilt.y }}
          transition={{ type: "spring", stiffness: 220, damping: 18 }}
          className="w-[13.5rem] overflow-hidden rounded-[1.1rem] bg-white shadow-[0_18px_40px_-14px_rgb(15_26_61/0.45),0_2px_6px_rgb(15_26_61/0.12)] ring-1 ring-black/5 [transform-style:preserve-3d]"
        >
          <div className="flex h-10 items-center justify-between bg-navy px-3.5">
            <Image src="/brand/epic-logo-light.png" alt="Epic Group" width={48} height={21} className="h-[1.1rem] w-auto" />
            <span className="text-[0.7rem] font-bold text-white">Scan-to-Drive</span>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={car.qr_version}
              initial={{ rotateY: -90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              exit={{ rotateY: 90, opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center gap-1 px-4 pt-3.5 pb-3"
            >
              <QrCode value={car.qr_link} size={132} label={t("qrLabel", { code: car.car_code })} />
              <span className="mt-1 font-display text-xl leading-none font-bold text-navy">{car.car_code}</span>
              <span className="text-[0.68rem] text-[#5a6478]">Scan to start trip</span>
            </motion.div>
          </AnimatePresence>
          <span className="block pr-2.5 pb-1.5 text-right text-[0.55rem] text-[#9fb4f5]">v{car.qr_version}</span>
        </motion.div>
      </div>

      {admin ? (
        <>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <a href={stickerHref(car.id, "sticker")} target="_blank" rel="noreferrer" className={cn(buttonVariants({ size: "lg", lift: true }), "w-full")}>
              <PrinterIcon size={19} weight="bold" />
              {t("print")}
            </a>
            <a href={stickerHref(car.id, "a4")} target="_blank" rel="noreferrer" title={t("a4Hint")} className={buttonVariants({ size: "lg", variant: "secondary" })}>
              <FilePdfIcon size={19} weight="bold" />
              A4
            </a>
          </div>
          <button
            type="button"
            onClick={() => setConfirm(true)}
            className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-bad-fg"
          >
            <ArrowsClockwiseIcon size={15} weight="bold" />
            {t("replace")}
          </button>
        </>
      ) : null}

      <Modal open={confirm} onOpenChange={setConfirm} busy={busy} title={t("confirmTitle")} description={t("confirmBody", { code: car.car_code })}>
        <div className="flex items-center gap-3 rounded-2xl bg-wait-bg px-4 py-3 text-sm font-semibold text-wait-fg">
          <WarningCircleIcon size={20} weight="fill" className="shrink-0" />
          {t("confirmWarn", { v: car.qr_version })}
        </div>
        {error ? <p className="text-sm font-semibold text-bad-fg">{error}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setConfirm(false)} disabled={busy}>
            {t("keep")}
          </Button>
          <Button size="lg" onClick={() => void renew()} disabled={busy}>
            {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : <ArrowsClockwiseIcon size={18} weight="bold" />}
            {t("confirm")}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/** In use, in the workshop, or off the fleet. A car on a trip cannot be taken out of use. */
function StatusCard({ car, admin, onSaved }: { car: Car; admin: boolean; onSaved: (s: CarStatus) => void }) {
  const t = useTranslations("cars");
  const [busy, setBusy] = useState<CarStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function change(status: CarStatus) {
    if (status === car.status || busy) return;
    setBusy(status);
    setError(null);
    try {
      await adminApi.updateCar(car.id, { status });
      onSaved(status);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-lg font-semibold text-title">{t("statusTitle")}</h2>
        <p className="text-sm text-muted">{t(`statusHint.${car.status}`)}</p>
      </div>
      {admin ? (
        <Segmented
          id="car-status"
          label={t("statusTitle")}
          value={busy ?? car.status}
          onChange={(v) => void change(v)}
          className="w-full [&>button]:flex-1 [&>button]:justify-center"
          options={[
            { value: "active", label: t("status.active"), dot: "bg-ok-dot" },
            { value: "maintenance", label: t("status.maintenance"), dot: "bg-off-dot" },
            { value: "inactive", label: t("status.inactive") },
          ]}
        />
      ) : null}
      <AnimatePresence>
        {error ? (
          <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-sm font-semibold text-bad-fg">
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  add / edit, km correction                                                                        */
/* ------------------------------------------------------------------------------------------------ */

function CarFormModal({
  open,
  onOpenChange,
  car,
  suggestCode,
  models,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** edit this car; without it: add a new one */
  car?: Car;
  suggestCode?: string;
  models: string[];
  onSaved: (car: Car) => void;
}) {
  const t = useTranslations("cars");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={car ? t("form.editTitle", { code: car.car_code }) : t("form.addTitle")} description={car ? undefined : t("form.addHint")}>
      {/* a fresh form each time it opens */}
      {open ? <CarForm car={car} suggestCode={suggestCode} models={models} onDone={(c) => { onOpenChange(false); onSaved(c); }} /> : null}
    </Modal>
  );
}

function CarForm({ car, suggestCode, models, onDone }: { car?: Car; suggestCode?: string; models: string[]; onDone: (car: Car) => void }) {
  const t = useTranslations("cars");
  const [code, setCode] = useState(car?.car_code ?? suggestCode ?? "");
  const [reg, setReg] = useState(car?.reg_number ?? "");
  const [model, setModel] = useState(car?.model ?? "");
  const [km, setKm] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeOk = /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code);
  const kmOk = km === "" || (/^\d{1,7}$/.test(km) && Number(km) <= 9_999_999);
  const ok = (car || codeOk) && reg.trim() && model.trim() && kmOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = car
        ? await adminApi.updateCar(car.id, { reg_number: reg.trim(), model: model.trim() })
        : await adminApi.addCar({ car_code: code, reg_number: reg.trim(), model: model.trim(), current_km: Number(km || 0), status: "active" });
      onDone(res.car);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {car ? null : (
        <Field label={t("form.code")} htmlFor="car-code" hint={t("form.codeHint")} error={tried && !codeOk ? t("form.codeBad") : undefined}>
          <Input
            id="car-code"
            mono
            autoFocus
            value={code}
            maxLength={20}
            invalid={tried && !codeOk}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
          />
        </Field>
      )}
      <Field label={t("form.reg")} htmlFor="car-reg" error={tried && !reg.trim() ? t("form.required") : undefined}>
        <Input
          id="car-reg"
          mono
          autoFocus={Boolean(car)}
          value={reg}
          maxLength={40}
          placeholder="DM-GA 12-3456"
          invalid={tried && !reg.trim()}
          onChange={(e) => setReg(e.target.value.toUpperCase())}
        />
      </Field>
      {reg.trim() ? (
        <div className="-mt-2 flex items-center gap-2 text-xs text-muted">
          <Plate reg={reg.trim()} size="sm" />
          {t("form.platePreview")}
        </div>
      ) : null}
      <Field label={t("form.model")} htmlFor="car-model" error={tried && !model.trim() ? t("form.required") : undefined}>
        <Input id="car-model" list="car-models" value={model} maxLength={80} placeholder="Toyota Axio" invalid={tried && !model.trim()} onChange={(e) => setModel(e.target.value)} />
        <datalist id="car-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>
      {car ? null : (
        <Field label={t("form.km")} htmlFor="car-km" hint={t("form.kmHint")} error={tried && !kmOk ? t("form.kmBad") : undefined}>
          <Input id="car-km" mono inputMode="numeric" value={km} placeholder="0" invalid={tried && !kmOk} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
        </Field>
      )}
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <Button type="submit" size="lg" lift disabled={busy}>
        {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : car ? t("form.save") : t("form.add")}
      </Button>
    </form>
  );
}

function KmFixModal({ open, onOpenChange, car, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; car: Car; onSaved: () => void }) {
  const t = useTranslations("cars.km");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("title")} description={t("hint")}>
      {open ? <KmFixForm car={car} onDone={() => { onOpenChange(false); onSaved(); }} /> : null}
    </Modal>
  );
}

function KmFixForm({ car, onDone }: { car: Car; onDone: () => void }) {
  const t = useTranslations("cars");
  const [km, setKm] = useState(String(car.current_km));
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quick = [t("km.reason1"), t("km.reason2"), t("km.reason3")];
  const value = Number(km || 0);
  const changed = km !== "" && value !== car.current_km;
  const ok = changed && reason.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateCar(car.id, { current_km: value, reason: reason.trim() });
      onDone();
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-bay p-3">
        <span className="text-xs font-semibold text-muted">{t("km.now")}</span>
        <Odometer value={value} from={car.current_km} size="sm" rollIn={false} />
      </div>
      <Field label={t("km.new")} htmlFor="km-new" error={tried && !changed ? t("km.same") : undefined}>
        <Input id="km-new" mono autoFocus inputMode="numeric" value={km} invalid={tried && !changed} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
      </Field>
      {changed ? (
        <p className={cn("-mt-2 text-sm font-semibold", value < car.current_km ? "text-wait-fg" : "text-muted")}>
          {t("km.diff", { diff: (value - car.current_km > 0 ? "+" : "") + (value - car.current_km).toLocaleString("en-US") })}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text">{t("km.reason")}</span>
        <div className="flex flex-wrap gap-2">
          {quick.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={cn(
                "h-9 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors",
                reason === r ? "border-accent bg-accent text-white" : "border-border-strong text-title hover:bg-soft",
              )}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label={t("km.reason")}
          aria-invalid={(tried && !reason.trim()) || undefined}
          placeholder={t("km.reasonPlaceholder")}
          className="w-full resize-none rounded-control border-[1.5px] border-border-strong bg-card px-4 py-3 text-base text-text outline-none placeholder:text-muted/70 focus:border-ring focus:shadow-[0_0_0_4px_var(--ring-soft)] aria-invalid:border-bad-dot"
        />
        {tried && !reason.trim() ? <p className="text-sm font-medium text-bad-fg">{t("km.reasonNeeded")}</p> : null}
      </div>
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <Button type="submit" size="lg" lift disabled={busy}>
        {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : t("km.save")}
      </Button>
    </form>
  );
}
