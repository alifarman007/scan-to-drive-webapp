"use client";

import {
  ArrowLeftIcon,
  CircleNotchIcon,
  IdentificationCardIcon,
  KeyIcon,
  LockKeyOpenIcon,
  PencilSimpleIcon,
  PhoneIcon,
  PlusIcon,
  PowerIcon,
  SealCheckIcon,
  SteeringWheelIcon,
  UserPlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { LiveDot } from "@/components/ui/live-dot";
import { Modal } from "@/components/ui/modal";
import { Reveal } from "@/components/ui/reveal";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiError } from "@/lib/api";
import { adminApi, isSignedOut, toSignIn, type Driver, type DriverDetail } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { ActivityChart, Avatar, EmptyList, PageHeader, RatingBadge, RecentTrips, SearchBox, Segmented, Stat, useDropNewParam, useFlash, useUrlState } from "./shared";

type DriverState = "on_trip" | "waiting" | "free" | "inactive";

function driverState(d: Driver): DriverState {
  if (d.status === "inactive") return "inactive";
  if (d.open_trip) return d.open_trip.status === "in_progress" ? "on_trip" : "waiting";
  return "free";
}

function DriverStateChip({ driver, size = "sm" }: { driver: Driver; size?: "sm" | "md" }) {
  const t = useTranslations("drivers.state");
  const s = driverState(driver);
  return (
    <StatusChip status={s === "free" ? "available" : s} size={size} live={s === "on_trip"}>
      {s === "on_trip" || s === "waiting" ? t(s, { car: driver.open_trip?.car_code ?? "" }) : t(s)}
    </StatusChip>
  );
}

function errorText(t: (k: string) => string, err: unknown) {
  if (err instanceof ApiError) {
    if (["EMPLOYEE_ID_EXISTS", "DRIVER_HAS_OPEN_TRIP"].includes(err.code)) return t(`errors.${err.code}`);
    if (err.status === 422) return t("errors.check");
    if (err.status === 0 || err.code === "BACKEND_DOWN") return t("errors.network");
  }
  return t("errors.generic");
}

/* ------------------------------------------------------------------------------------------------ */
/*  list                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

type Filter = "" | "on_trip" | "free" | "inactive";

export function DriversList({
  drivers,
  nextId,
  initialQ,
  initialFilter,
}: {
  drivers: Driver[];
  nextId: string;
  initialQ: string;
  initialFilter: Filter;
}) {
  const t = useTranslations("drivers");
  const user = useAdminUser();
  const router = useRouter();
  const [q, setQ] = useUrlState("q", initialQ);
  const [filter, setFilter] = useUrlState<Filter>("state", initialFilter);
  const [adding, setAdding] = useState(false);

  const matches = (d: Driver, f: Filter) => {
    const s = driverState(d);
    return !f || (f === "on_trip" ? s === "on_trip" || s === "waiting" : s === f);
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return drivers.filter(
      (d) => matches(d, filter) && (!needle || [d.name, d.employee_id, d.phone ?? "", d.license_no ?? ""].some((x) => x.toLowerCase().includes(needle))),
    );
  }, [drivers, q, filter]);

  const active = drivers.filter((d) => d.status === "active").length;

  return (
    <div className="flex flex-col gap-section">
      <Reveal>
        <PageHeader title={t("title")} summary={t("summary", { active, total: drivers.length })}>
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
          id="drivers-filter"
          label={t("filterLabel")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "", label: t("filter.all"), count: drivers.length },
            { value: "on_trip", label: t("filter.on_trip"), count: drivers.filter((d) => matches(d, "on_trip")).length, dot: "bg-trip-dot" },
            { value: "free", label: t("filter.free"), count: drivers.filter((d) => matches(d, "free")).length, dot: "bg-ok-dot" },
            { value: "inactive", label: t("filter.inactive"), count: drivers.filter((d) => matches(d, "inactive")).length },
          ]}
        />
      </Reveal>

      {shown.length === 0 ? (
        <EmptyList
          icon={<SteeringWheelIcon size={28} weight="duotone" />}
          title={drivers.length ? t("emptyTitle") : t("noneTitle")}
          body={drivers.length ? t("emptyBody") : t("noneBody")}
        />
      ) : (
        <motion.ul layout className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {shown.map((d, i) => (
              <motion.li
                key={d.id}
                layout
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03, duration: 0.35, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              >
                <DriverCard driver={d} />
              </motion.li>
            ))}
          </AnimatePresence>
        </motion.ul>
      )}

      <DriverFormModal open={adding} onOpenChange={setAdding} nextId={nextId} onSaved={(d) => router.push(`/admin/drivers/${d.id}?new=1`)} />
    </div>
  );
}

function DriverCard({ driver }: { driver: Driver }) {
  const t = useTranslations("drivers");
  const off = driver.status === "inactive";
  return (
    <Link
      href={`/admin/drivers/${driver.id}`}
      className={cn(
        "group flex h-full flex-col gap-4 rounded-card border border-border bg-card p-4 transition-[transform,box-shadow,border-color] duration-200 outline-none hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift focus-visible:shadow-[0_0_0_4px_var(--ring-soft)]",
        off && "bg-bay/60",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="relative">
          <Avatar name={driver.name} size={52} dim={off} />
          {driver.open_trip?.status === "in_progress" ? (
            <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-card p-[3px]">
              <LiveDot className="bg-trip-dot" />
            </span>
          ) : null}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate font-display text-lg leading-snug font-semibold", off ? "text-muted" : "text-title")}>{driver.name}</span>
          <span className="font-mono text-sm text-muted">{driver.employee_id}</span>
          {driver.phone ? <span className="truncate text-xs text-muted">{driver.phone}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DriverStateChip driver={driver} />
        {!driver.has_pin && !off ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-wait-bg px-2.5 py-1 text-xs font-bold text-wait-fg">
            <KeyIcon size={12} weight="bold" />
            {t("noPin")}
          </span>
        ) : null}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted">
        <span>
          <b className="font-bold text-title tabular-nums">{driver.total_trips}</b> {t("tripsShort")} ·{" "}
          <b className="font-bold text-title tabular-nums">{driver.total_km.toLocaleString("en-US")}</b> km
        </span>
        <RatingBadge rating={driver.rating} />
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  detail                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export function DriverDetailView({ data, isNew }: { data: DriverDetail; isNew: boolean }) {
  const t = useTranslations("drivers");
  const format = useFormatter();
  const user = useAdminUser();
  const router = useRouter();
  const [flash, showFlash] = useFlash();
  const [editing, setEditing] = useState(false);
  const { driver } = data;
  const admin = user.role === "admin";
  const off = driver.status === "inactive";
  useDropNewParam(isNew);

  const saved = (text: string) => {
    showFlash(text);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-section">
      <Reveal className="flex flex-col gap-3">
        <Link href="/admin/drivers" className="inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-bold text-accent hover:underline">
          <ArrowLeftIcon size={15} weight="bold" />
          {t("back")}
        </Link>
      </Reveal>

      <Reveal delay={0.03}>
        <Card className="relative overflow-hidden border-0 p-0 shadow-lift">
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-navy via-epic to-signal opacity-95" aria-hidden="true">
            <svg className="absolute inset-0 h-full w-full opacity-30" preserveAspectRatio="none" viewBox="0 0 400 96" aria-hidden="true">
              <path d="M-10 70 C 80 20, 160 90, 250 45 S 380 20, 420 40" fill="none" stroke="#9fb4f5" strokeWidth="2" strokeDasharray="10 12" className="road-dash" />
            </svg>
          </div>
          <div className="relative h-24" />
          <div className="relative flex flex-wrap items-start justify-between gap-4 px-4 pb-5 sm:px-6">
            <div className="flex min-w-0 items-start gap-4">
              <span className="-mt-12 rounded-full bg-card p-1 shadow-lg">
                <Avatar name={driver.name} size={88} dim={off} />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5 pt-3">
                <h1 className="truncate font-display text-3xl leading-tight font-bold text-title">{driver.name}</h1>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-soft px-2.5 py-1 font-mono text-sm font-semibold text-title">
                    <IdentificationCardIcon size={15} weight="duotone" className="text-accent" />
                    {driver.employee_id}
                  </span>
                  <DriverStateChip driver={driver} />
                </div>
              </div>
            </div>
            {admin ? (
              <Button variant="secondary" size="md" onClick={() => setEditing(true)} className="mt-3">
                <PencilSimpleIcon size={18} weight="bold" />
                {t("edit")}
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-border px-4 py-3 text-sm sm:px-6">
            {driver.phone ? (
              <a href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1.5 font-semibold text-accent hover:underline">
                <PhoneIcon size={15} weight="bold" />
                {driver.phone}
              </a>
            ) : (
              <span className="text-muted">{t("noPhone")}</span>
            )}
            <span className="text-muted">
              {t("license")}: <span className="font-mono font-semibold text-text">{driver.license_no ?? "–"}</span>
            </span>
            <span className="text-muted">{t("since", { date: format.dateTime(new Date(driver.created_at), { month: "long", year: "numeric" }) })}</span>
          </div>
        </Card>
      </Reveal>

      <AnimatePresence>
        {isNew && !driver.has_pin ? (
          <motion.p initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2.5 rounded-2xl bg-ok-bg px-4 py-3 text-sm font-semibold text-ok-fg">
            <UserPlusIcon size={18} weight="duotone" className="mt-px shrink-0" />
            {t("newDriverNote", { id: driver.employee_id })}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-section">
          <Reveal delay={0.06}>
            <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4 sm:p-5">
              <Stat label={t("stats.trips")} value={driver.total_trips} />
              <Stat label={t("stats.km")} value={driver.total_km.toLocaleString("en-US")} unit="km" />
              <Stat
                label={t("stats.rating")}
                value={driver.rating ? driver.rating.average.toFixed(1) : "–"}
                unit={driver.rating ? t("stats.ratingOf", { count: driver.rating.count }) : undefined}
              />
              <Stat
                label={t("stats.lastTrip")}
                value={driver.last_trip_at ? format.dateTime(new Date(driver.last_trip_at), { day: "numeric", month: "short" }) : "–"}
              />
            </Card>
          </Reveal>
          {driver.open_trip ? (
            <Reveal delay={0.08}>
              <Link
                href={`/admin/trips/${driver.open_trip.id}`}
                className="flex items-center gap-3 rounded-2xl bg-trip-bg px-4 py-3 text-trip-fg transition-transform hover:-translate-y-0.5"
              >
                <LiveDot className="bg-trip-dot" />
                <span className="font-semibold">{t("onTripNow", { car: driver.open_trip.car_code })}</span>
                <span className="ml-auto font-mono text-sm">{driver.open_trip.trip_no}</span>
              </Link>
            </Reveal>
          ) : null}
          <Reveal delay={0.1}>
            <ActivityChart days={data.km_by_day} />
          </Reveal>
          <Reveal delay={0.14}>
            <RecentTrips trips={data.recent_trips} allHref={`/admin/trips?driver=${driver.id}`} show="car" />
          </Reveal>
        </div>
        <div className="flex min-w-0 flex-col gap-section">
          <Reveal delay={0.08}>
            <PinCard driver={driver} admin={admin} onReset={() => saved(t("pinResetDone"))} />
          </Reveal>
          <Reveal delay={0.12}>
            <AccountCard driver={driver} admin={admin} onSaved={(s) => saved(t(`statusSaved.${s}`))} />
          </Reveal>
        </div>
      </div>

      <DriverFormModal open={editing} onOpenChange={setEditing} driver={driver} onSaved={() => saved(t("saved"))} />
      {flash}
    </div>
  );
}

/** Sign-in: is the PIN set? Reset a forgotten one (the driver picks a new PIN at the next sign-in). */
function PinCard({ driver, admin, onReset }: { driver: Driver; admin: boolean; onReset: () => void }) {
  const t = useTranslations("drivers.pin");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function reset() {
    setBusy(true);
    setError(false);
    try {
      await adminApi.resetPin(driver.id);
      setConfirm(false);
      onReset();
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className={cn("inline-flex size-11 shrink-0 items-center justify-center rounded-2xl", driver.has_pin ? "bg-ok-bg text-ok-fg" : "bg-wait-bg text-wait-fg")}>
          {driver.has_pin ? <SealCheckIcon size={22} weight="duotone" /> : <KeyIcon size={22} weight="duotone" />}
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="font-display text-lg font-semibold text-title">{driver.has_pin ? t("setTitle") : t("notSetTitle")}</h2>
          <p className="text-sm text-muted">{driver.has_pin ? t("setBody") : t("notSetBody", { id: driver.employee_id })}</p>
        </div>
      </div>
      {admin && driver.has_pin ? (
        <Button variant="secondary" size="md" onClick={() => setConfirm(true)}>
          <LockKeyOpenIcon size={18} weight="bold" />
          {t("reset")}
        </Button>
      ) : null}
      <Modal open={confirm} onOpenChange={setConfirm} busy={busy} title={t("confirmTitle", { name: driver.name })} description={t("confirmBody", { id: driver.employee_id })}>
        {error ? <p className="text-sm font-semibold text-bad-fg">{t("failed")}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setConfirm(false)} disabled={busy}>
            {t("keep")}
          </Button>
          <Button size="lg" onClick={() => void reset()} disabled={busy}>
            {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : <LockKeyOpenIcon size={18} weight="bold" />}
            {t("confirm")}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/** Active or turned off (a driver who left: kept with all trips, but cannot sign in). */
function AccountCard({ driver, admin, onSaved }: { driver: Driver; admin: boolean; onSaved: (s: Driver["status"]) => void }) {
  const t = useTranslations("drivers");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const off = driver.status === "inactive";
  const next = off ? "active" : "inactive";

  async function change() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateDriver(driver.id, { status: next });
      setConfirm(false);
      onSaved(next);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-lg font-semibold text-title">{t("account.title")}</h2>
        <p className="text-sm text-muted">{off ? t("account.offBody") : t("account.onBody")}</p>
      </div>
      {admin ? (
        <Button variant={off ? "primary" : "danger"} size="md" onClick={() => (off ? void change() : setConfirm(true))} disabled={busy}>
          {busy && off ? <CircleNotchIcon size={18} className="animate-spin" /> : <PowerIcon size={18} weight="bold" />}
          {off ? t("account.turnOn") : t("account.turnOff")}
        </Button>
      ) : null}
      {error && !confirm ? <p className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <Modal open={confirm} onOpenChange={setConfirm} busy={busy} title={t("account.confirmTitle", { name: driver.name })} description={t("account.confirmBody")}>
        {error ? (
          <p className="flex items-start gap-2 rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">
            <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setConfirm(false)} disabled={busy}>
            {t("account.keep")}
          </Button>
          <Button variant="danger" size="lg" onClick={() => void change()} disabled={busy}>
            {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : <PowerIcon size={18} weight="bold" />}
            {t("account.turnOff")}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  add / edit                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

function DriverFormModal({
  open,
  onOpenChange,
  driver,
  nextId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  driver?: Driver;
  nextId?: string;
  onSaved: (d: Driver) => void;
}) {
  const t = useTranslations("drivers.form");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={driver ? t("editTitle", { name: driver.name }) : t("addTitle")} description={driver ? undefined : t("addHint")}>
      {open ? <DriverForm driver={driver} nextId={nextId} onDone={(d) => { onOpenChange(false); onSaved(d); }} /> : null}
    </Modal>
  );
}

function DriverForm({ driver, nextId, onDone }: { driver?: Driver; nextId?: string; onDone: (d: Driver) => void }) {
  const t = useTranslations("drivers");
  const [id, setId] = useState(driver?.employee_id ?? nextId ?? "");
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [license, setLicense] = useState(driver?.license_no ?? "");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idOk = /^[A-Z0-9][A-Z0-9-]{1,39}$/.test(id);
  const nameOk = name.trim().length > 0;
  const phoneOk = !phone.trim() || /^\+?[0-9][0-9 -]{5,28}$/.test(phone.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if ((!driver && !idOk) || !nameOk || !phoneOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = driver
        ? await adminApi.updateDriver(driver.id, { name: name.trim(), phone: phone.trim(), license_no: license.trim() })
        : await adminApi.addDriver({ employee_id: id, name: name.trim(), phone: phone.trim() || undefined, license_no: license.trim() || undefined });
      onDone(res.driver);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {driver ? null : (
        <div className="flex items-center gap-3 rounded-2xl bg-bay p-3">
          <Avatar name={name || "?"} size={44} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-title">{name.trim() || t("form.previewName")}</span>
            <span className="font-mono text-sm text-muted">{id || "DR0000"}</span>
          </div>
        </div>
      )}
      {driver ? null : (
        <Field label={t("form.id")} htmlFor="drv-id" hint={t("form.idHint")} error={tried && !idOk ? t("form.idBad") : undefined}>
          <Input id="drv-id" mono value={id} maxLength={40} invalid={tried && !idOk} onChange={(e) => setId(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))} />
        </Field>
      )}
      <Field label={t("form.name")} htmlFor="drv-name" error={tried && !nameOk ? t("form.required") : undefined}>
        <Input id="drv-name" autoFocus autoComplete="off" value={name} maxLength={120} placeholder={t("form.namePlaceholder")} invalid={tried && !nameOk} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("form.phone")} htmlFor="drv-phone" error={tried && !phoneOk ? t("form.phoneBad") : undefined}>
          <Input id="drv-phone" mono type="tel" inputMode="tel" value={phone} maxLength={30} placeholder="01XXX XXXXXX" invalid={tried && !phoneOk} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t("form.license")} htmlFor="drv-license">
          <Input id="drv-license" mono value={license} maxLength={60} placeholder={t("form.optional")} onChange={(e) => setLicense(e.target.value.toUpperCase())} />
        </Field>
      </div>
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
      <Button type="submit" size="lg" lift disabled={busy}>
        {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : driver ? t("form.save") : t("form.add")}
      </Button>
    </form>
  );
}
