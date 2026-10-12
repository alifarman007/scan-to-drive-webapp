"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  BuildingsIcon,
  CarIcon,
  CheckIcon,
  CircleNotchIcon,
  FilePdfIcon,
  GaugeIcon,
  HandshakeIcon,
  PencilSimpleIcon,
  PlusIcon,
  PrinterIcon,
  TrashIcon,
  WarningCircleIcon,
  XIcon,
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
import {
  adminApi,
  isSignedOut,
  stickerHref,
  toSignIn,
  type Car,
  type CarDetail,
  type CarOwner,
  type CarStatus,
  type Vendor,
} from "@/lib/admin-api";
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

const KNOWN_ERRORS = [
  "CAR_CODE_EXISTS", "REG_NUMBER_EXISTS", "CAR_HAS_OPEN_TRIP", "REASON_REQUIRED", "CAR_EXISTS",
  "VENDOR_REQUIRED", "VENDOR_NOT_FOUND", "VENDOR_EXISTS", "VENDOR_HAS_CARS",
];

function errorText(t: (k: string) => string, err: unknown) {
  if (err instanceof ApiError) {
    if (KNOWN_ERRORS.includes(err.code)) return t(`errors.${err.code}`);
    if (err.status === 422) return t("errors.check");
    if (err.status === 0 || err.code === "BACKEND_DOWN") return t("errors.network");
  }
  return t("errors.generic");
}

/* ------------------------------------------------------------------------------------------------ */
/*  list                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

export type Filter = "" | "on_trip" | "available" | "maintenance" | "inactive";

const SPRING = { type: "spring", stiffness: 480, damping: 38 } as const;

/** Epic's own cars and the vendors' (rental) cars are two views; inside each, search and a state filter. */
export function CarsList({
  cars,
  vendors,
  initialQ,
  initialFilter,
  initialOwner,
  initialVendor,
}: {
  cars: Car[];
  vendors: Vendor[];
  initialQ: string;
  initialFilter: Filter;
  initialOwner: CarOwner;
  initialVendor: string;
}) {
  const t = useTranslations("cars");
  const user = useAdminUser();
  const router = useRouter();
  const [q, setQ] = useUrlState("q", initialQ);
  const [filter, setFilter] = useUrlState<Filter>("state", initialFilter);
  const [owner, setOwner] = useUrlState<CarOwner>("owner", initialOwner);
  const [vendor, setVendor] = useUrlState("vendor", initialVendor);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [flash, showFlash] = useFlash();
  const admin = user.role === "admin";
  const vendorOn = owner === "vendor" && vendors.some((v) => String(v.id) === vendor) ? vendor : "";

  const needle = q.trim().toLowerCase();
  const matches = (c: Car) =>
    !needle || [c.car_code, c.reg_number, c.model, c.open_trip?.driver_name ?? "", c.vendor?.name ?? ""].some((x) => x.toLowerCase().includes(needle));
  const inView = cars.filter((c) => c.owner === owner && (!vendorOn || String(c.vendor?.id) === vendorOn));
  const ownerCount = (o: CarOwner) => cars.filter((c) => c.owner === o).length;

  const count = (f: Filter) =>
    inView.filter((c) => {
      const s = carState(c);
      return !f || (f === "on_trip" ? s === "on_trip" || s === "waiting" : s === f);
    }).length;

  const shown = useMemo(
    () =>
      inView.filter((c) => {
        const s = carState(c);
        if (filter && (filter === "on_trip" ? s !== "on_trip" && s !== "waiting" : s !== filter)) return false;
        return matches(c);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cars, q, filter, owner, vendorOn],
  );
  // a search that finds nothing here may find cars in the other view: say so, one tap away
  const other: CarOwner = owner === "epic" ? "vendor" : "epic";
  const elsewhere = needle ? cars.filter((c) => c.owner === other && matches(c)).length : 0;

  const totalKm = cars.reduce((s, c) => s + c.total_km, 0);

  return (
    <div className="flex flex-col gap-section">
      <Reveal>
        <PageHeader title={t("title")} summary={t("summary", { cars: cars.length, km: totalKm.toLocaleString("en-US") })}>
          {admin ? (
            <Button size="md" lift onClick={() => setAdding(true)}>
              <PlusIcon size={18} weight="bold" />
              {t("add")}
            </Button>
          ) : null}
        </PageHeader>
      </Reveal>

      <Reveal delay={0.03}>
        <OwnerTabs
          owner={owner}
          onChange={(o) => {
            setOwner(o);
            setVendor("");
          }}
          epic={ownerCount("epic")}
          vendor={ownerCount("vendor")}
          vendors={vendors.length}
        />
      </Reveal>

      <AnimatePresence initial={false}>
        {owner === "vendor" ? (
          <motion.div
            key="vendor-bar"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="-my-1 overflow-hidden py-1"
          >
            <VendorBar vendors={vendors} value={vendorOn} onChange={setVendor} admin={admin} onManage={() => setManaging(true)} />
          </motion.div>
        ) : null}
      </AnimatePresence>

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

      {elsewhere ? (
        <button
          type="button"
          onClick={() => {
            setOwner(other);
            setVendor("");
            setFilter("");
          }}
          className="-mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-soft px-3.5 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
        >
          {t(`elsewhere.${other}`, { count: elsewhere })}
          <ArrowRightIcon size={14} weight="bold" />
        </button>
      ) : null}

      {shown.length === 0 ? (
        <EmptyList
          icon={owner === "vendor" ? <HandshakeIcon size={28} weight="duotone" /> : <CarIcon size={28} weight="duotone" />}
          title={inView.length ? t("emptyTitle") : t(`noneTitle.${owner}`)}
          body={inView.length ? t("emptyBody") : t(`noneBody.${owner}`)}
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
                <CarCard car={car} showVendor={vendors.length > 1} />
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
        vendors={vendors}
        defaultOwner={owner}
        defaultVendor={vendorOn ? Number(vendorOn) : (vendors.length === 1 ? vendors[0].id : null)}
        onSaved={(car) => router.push(`/admin/cars/${car.id}?new=1`)}
      />
      <VendorsModal
        open={managing}
        onOpenChange={setManaging}
        vendors={vendors}
        onChanged={(text) => {
          showFlash(text);
          router.refresh();
        }}
      />
      {flash}
    </div>
  );
}

/** The two views as big tabs: Epic Group's own cars, and cars rented from vendors. */
function OwnerTabs({
  owner,
  onChange,
  epic,
  vendor,
  vendors,
}: {
  owner: CarOwner;
  onChange: (o: CarOwner) => void;
  epic: number;
  vendor: number;
  vendors: number;
}) {
  const t = useTranslations("cars.owner");
  const tabs = [
    { value: "epic" as const, Icon: BuildingsIcon, label: t("epic"), sub: t("epicSub"), count: epic },
    { value: "vendor" as const, Icon: HandshakeIcon, label: t("vendor"), sub: t("vendorSub", { count: vendors }), count: vendor },
  ];
  return (
    <div role="tablist" aria-label={t("label")} className="grid grid-cols-2 gap-1.5 rounded-card bg-soft p-1.5 sm:w-fit sm:grid-cols-[repeat(2,minmax(15rem,auto))]">
      {tabs.map(({ value, Icon, label, sub, count }) => {
        const on = owner === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(value)}
            className={cn(
              "group relative flex min-w-0 items-center gap-2 rounded-[0.95rem] px-2 py-2 text-left outline-none focus-visible:shadow-[0_0_0_3px_var(--ring-soft)] sm:gap-3 sm:px-3 sm:py-2.5",
              on ? "text-title" : "text-muted hover:text-title",
            )}
          >
            {on ? <motion.span layoutId="cars-owner-tab" className="absolute inset-0 rounded-[0.95rem] bg-card shadow-sm" transition={SPRING} /> : null}
            <span
              className={cn(
                "relative grid size-8 shrink-0 place-items-center rounded-xl transition-colors duration-300 sm:size-10",
                on ? "bg-accent text-white shadow-[0_6px_14px_-6px_var(--accent)]" : "bg-card/70 text-muted group-hover:text-accent",
              )}
            >
              <motion.span key={String(on)} initial={on ? { rotate: -12, scale: 0.8 } : false} animate={{ rotate: 0, scale: 1 }} transition={SPRING}>
                <Icon size={21} weight={on ? "fill" : "duotone"} />
              </motion.span>
            </span>
            <span className="relative flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-1.5 font-display text-sm leading-tight font-bold whitespace-nowrap sm:text-base">
                {label}
                <span className={cn("rounded-full px-1.5 text-xs tabular-nums", on ? "bg-soft text-title" : "bg-card/60")}>{count}</span>
              </span>
              <span className="hidden truncate text-xs text-muted sm:block">{sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Vendor view: which vendor (when there is more than one), and "Vendors" to add or rename them. */
function VendorBar({
  vendors,
  value,
  onChange,
  admin,
  onManage,
}: {
  vendors: Vendor[];
  value: string;
  onChange: (v: string) => void;
  admin: boolean;
  onManage: () => void;
}) {
  const t = useTranslations("cars.vendors");
  return (
    <div className="flex items-center gap-2">
      {vendors.length > 1 ? (
        <Segmented
          id="cars-vendor"
          className="min-w-0"
          label={t("filterLabel")}
          value={value}
          onChange={onChange}
          options={[{ value: "", label: t("all"), count: vendors.reduce((s, v) => s + v.cars, 0) }, ...vendors.map((v) => ({ value: String(v.id), label: v.name, count: v.cars }))]}
        />
      ) : vendors.length === 1 ? (
        <span className="inline-flex h-11 min-w-0 items-center gap-2.5 rounded-control border border-border bg-card px-3.5 text-sm">
          <HandshakeIcon size={18} weight="duotone" className="shrink-0 text-accent" />
          <span className="truncate font-bold text-title">{vendors[0].name}</span>
          <span className="shrink-0 whitespace-nowrap text-muted">· {t("cars", { count: vendors[0].cars })}</span>
        </span>
      ) : (
        <span className="text-sm text-muted">{t("none")}</span>
      )}
      {admin ? (
        <Button variant="secondary" size="md" onClick={onManage} aria-label={t("manage")} className="shrink-0 max-sm:w-11 max-sm:px-0">
          <PencilSimpleIcon size={17} weight="bold" />
          <span className="max-sm:hidden">{t("manage")}</span>
        </Button>
      ) : null}
    </div>
  );
}

/** Add a vendor, rename one, or remove one that has no cars (added by mistake). */
function VendorsModal({
  open,
  onOpenChange,
  vendors,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  vendors: Vendor[];
  onChanged: (flash: string) => void;
}) {
  const t = useTranslations("cars.vendors");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("title")} description={t("hint")}>
      {open ? <VendorsEditor vendors={vendors} onChanged={onChanged} /> : null}
    </Modal>
  );
}

function VendorsEditor({ vendors, onChanged }: { vendors: Vendor[]; onChanged: (flash: string) => void }) {
  const t = useTranslations("cars");
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, job: () => Promise<unknown>, flash: string) {
    setBusy(key);
    setError(null);
    try {
      await job();
      onChanged(flash);
      return true;
    } catch (err) {
      if (isSignedOut(err)) toSignIn();
      else setError(errorText(t, err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const taken = (n: string, id?: number) => vendors.some((v) => v.id !== id && v.name.toLowerCase() === n.trim().replace(/\s+/g, " ").toLowerCase());

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
        {vendors.map((v) => (
          <li key={v.id} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-soft text-accent">
              <HandshakeIcon size={19} weight="duotone" />
            </span>
            {editing === v.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!name.trim() || taken(name, v.id)) return;
                  if (await run(`rename-${v.id}`, () => adminApi.renameVendor(v.id, name.trim()), t("vendors.renamed"))) setEditing(null);
                }}
              >
                <Input
                  autoFocus
                  aria-label={t("vendors.name")}
                  value={name}
                  maxLength={120}
                  invalid={!name.trim() || taken(name, v.id)}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setEditing(null))}
                  className="h-11 min-w-0 flex-1"
                />
                <Button type="submit" size="md" aria-label={t("vendors.save")} disabled={busy !== null || !name.trim() || taken(name, v.id)}>
                  {busy === `rename-${v.id}` ? <CircleNotchIcon size={17} className="animate-spin" /> : <CheckIcon size={17} weight="bold" />}
                </Button>
                <Button type="button" variant="ghost" size="md" aria-label={t("vendors.cancel")} onClick={() => setEditing(null)}>
                  <XIcon size={17} weight="bold" />
                </Button>
              </form>
            ) : (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold text-title">{v.name}</span>
                  <span className="text-xs text-muted">{t("vendors.cars", { count: v.cars })}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(v.id);
                    setName(v.name);
                    setError(null);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-accent transition-colors hover:bg-soft"
                >
                  <PencilSimpleIcon size={15} weight="bold" />
                  {t("vendors.rename")}
                </button>
                {v.cars === 0 ? (
                  <button
                    type="button"
                    aria-label={t("vendors.remove", { name: v.name })}
                    disabled={busy !== null}
                    onClick={() => void run(`remove-${v.id}`, () => adminApi.removeVendor(v.id), t("vendors.removed"))}
                    className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-bad-bg hover:text-bad-fg"
                  >
                    {busy === `remove-${v.id}` ? <CircleNotchIcon size={16} className="animate-spin" /> : <TrashIcon size={16} weight="bold" />}
                  </button>
                ) : null}
              </>
            )}
          </li>
        ))}
        {vendors.length === 0 ? <li className="px-4 py-5 text-center text-sm text-muted">{t("vendors.none")}</li> : null}
      </ul>

      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim() || taken(newName)) return;
          if (await run("add", () => adminApi.addVendor(newName.trim()), t("vendors.added", { name: newName.trim() }))) setNewName("");
        }}
      >
        <label htmlFor="vendor-new" className="text-sm font-semibold text-text">
          {t("vendors.add")}
        </label>
        <div className="flex gap-2">
          <Input
            id="vendor-new"
            value={newName}
            maxLength={120}
            placeholder={t("vendors.placeholder")}
            invalid={taken(newName)}
            onChange={(e) => setNewName(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="lg" disabled={busy !== null || !newName.trim() || taken(newName)}>
            {busy === "add" ? <CircleNotchIcon size={18} className="animate-spin" /> : <PlusIcon size={18} weight="bold" />}
            {t("vendors.addShort")}
          </Button>
        </div>
        {taken(newName) ? <p className="text-sm font-medium text-bad-fg">{t("errors.VENDOR_EXISTS")}</p> : null}
      </form>
      {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
    </div>
  );
}

/** The odometer, or a quiet note for a new car whose km was never recorded (the first trip sets it). */
function CarKm({ car, size }: { car: Car; size: "sm" | "lg" }) {
  const t = useTranslations("cars");
  if (car.km_known) return size === "lg" ? <Odometer value={car.current_km} size="lg" unit="km" /> : <Odometer value={car.current_km} size="sm" rollIn={false} />;
  return (
    <span className={cn("inline-flex items-center gap-2 text-muted", size === "lg" ? "h-[54px] text-sm" : "h-7 text-xs")}>
      <GaugeIcon size={size === "lg" ? 22 : 16} weight="duotone" className="shrink-0 text-accent/70" />
      <span className="flex flex-col leading-tight">
        <span className="font-semibold text-text">{t("kmUnknown")}</span>
        {size === "lg" ? <span className="text-xs">{t("kmUnknownHint")}</span> : null}
      </span>
    </span>
  );
}

function CarCard({ car, showVendor }: { car: Car; showVendor: boolean }) {
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
          {showVendor && car.vendor ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-xs font-semibold text-accent">
              <HandshakeIcon size={13} weight="fill" className="shrink-0" />
              <span className="truncate">{car.vendor.name}</span>
            </span>
          ) : null}
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
        <CarKm car={car} size="sm" />
        <div className="flex flex-col items-end gap-1 text-right text-xs text-muted">
          <span>
            <b className="font-bold text-title tabular-nums">{car.total_trips}</b> {t("tripsShort", { count: car.total_trips })} ·{" "}
            <b className="font-bold text-title tabular-nums">{car.total_km.toLocaleString("en-US")}</b> km
          </span>
          <RatingBadge rating={car.rating} />
        </div>
      </div>
      {car.open_trip ? (
        <div className="-mx-4 -mb-4 -ml-5 flex items-center gap-2 bg-trip-bg/70 px-5 py-2 text-xs font-semibold text-trip-fg">
          {car.open_trip.status === "in_progress" ? <LiveDot className="bg-trip-dot" /> : <span className="size-2 rounded-full bg-wait-dot" />}
          <span className="truncate">{car.open_trip.driver_name}</span>
          <span className="ml-auto shrink-0 font-mono whitespace-nowrap">{car.open_trip.trip_no}</span>
        </div>
      ) : null}
    </Link>
  );
}

/** "Epic Group" or the vendor's name, next to the plate on the car page. */
function OwnerBadge({ car }: { car: Car }) {
  const t = useTranslations("cars.owner");
  if (!car.vendor)
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-soft px-3 text-sm font-bold text-title">
        <BuildingsIcon size={16} weight="duotone" className="text-accent" />
        {t("epicBadge")}
      </span>
    );
  return (
    <Link
      href={`/admin/cars?owner=vendor&vendor=${car.vendor.id}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-soft px-3 text-sm font-bold text-title transition-colors hover:bg-accent hover:text-white"
    >
      <HandshakeIcon size={16} weight="duotone" />
      {car.vendor.name}
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
        <Link href={`/admin/cars?owner=${car.owner}`} className="inline-flex w-fit items-center gap-1.5 rounded-lg text-sm font-bold text-accent hover:underline">
          <ArrowLeftIcon size={15} weight="bold" />
          {t(`backTo.${car.owner}`)}
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
              <OwnerBadge car={car} />
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
                  <CarKm car={car} size="lg" />
                </div>
                {car.open_trip ? (
                  <Link
                    href={`/admin/trips/${car.open_trip.id}`}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-4 py-3 transition-transform hover:-translate-y-0.5",
                      car.open_trip.status === "in_progress" ? "bg-trip-bg text-trip-fg" : "bg-wait-bg text-wait-fg",
                    )}
                  >
                    {car.open_trip.status === "in_progress" ? <LiveDot className="bg-trip-dot" /> : <span className="size-2 rounded-full bg-wait-dot" />}
                    <span className="flex flex-col">
                      <span className="text-xs font-semibold">{car.open_trip.status === "in_progress" ? t("onTripWith") : t("waitingWith")}</span>
                      <span className="font-bold">{car.open_trip.driver_name}</span>
                    </span>
                    <span className="font-mono text-sm whitespace-nowrap">{car.open_trip.trip_no}</span>
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

      <CarFormModal
        open={editing}
        onOpenChange={setEditing}
        car={car}
        models={[car.model]}
        vendors={data.vendors}
        defaultOwner={car.owner}
        defaultVendor={car.vendor?.id ?? null}
        onSaved={() => saved(t("saved"))}
      />
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
  vendors,
  defaultOwner,
  defaultVendor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** edit this car; without it: add a new one */
  car?: Car;
  suggestCode?: string;
  models: string[];
  vendors: Vendor[];
  defaultOwner: CarOwner;
  defaultVendor: number | null;
  onSaved: (car: Car) => void;
}) {
  const t = useTranslations("cars");
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={car ? t("form.editTitle", { code: car.car_code }) : t("form.addTitle")} description={car ? undefined : t("form.addHint")}>
      {/* a fresh form each time it opens */}
      {open ? (
        <CarForm
          car={car}
          suggestCode={suggestCode}
          models={models}
          vendors={vendors}
          defaultOwner={defaultOwner}
          defaultVendor={defaultVendor}
          onDone={(c) => {
            onOpenChange(false);
            onSaved(c);
          }}
        />
      ) : null}
    </Modal>
  );
}

function CarForm({
  car,
  suggestCode,
  models,
  vendors,
  defaultOwner,
  defaultVendor,
  onDone,
}: {
  car?: Car;
  suggestCode?: string;
  models: string[];
  vendors: Vendor[];
  defaultOwner: CarOwner;
  defaultVendor: number | null;
  onDone: (car: Car) => void;
}) {
  const t = useTranslations("cars");
  const [code, setCode] = useState(car?.car_code ?? suggestCode ?? "");
  const [reg, setReg] = useState(car?.reg_number ?? "");
  const [model, setModel] = useState(car?.model ?? "");
  const [km, setKm] = useState("");
  const [owner, setOwner] = useState<CarOwner>(defaultOwner);
  const [vendorId, setVendorId] = useState<number | null>(defaultVendor);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeOk = /^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code);
  const kmOk = km === "" || (/^\d{1,7}$/.test(km) && Number(km) <= 9_999_999);
  const vendorOk = owner === "epic" || vendors.some((v) => v.id === vendorId);
  const ok = (car || codeOk) && reg.trim() && model.trim() && kmOk && vendorOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    const who = { owner, vendor_id: owner === "vendor" ? vendorId : null };
    try {
      const res = car
        ? await adminApi.updateCar(car.id, { reg_number: reg.trim(), model: model.trim(), ...who })
        : await adminApi.addCar({ car_code: code, reg_number: reg.trim(), model: model.trim(), current_km: Number(km || 0), status: "active", ...who });
      onDone(res.car);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(errorText(t, err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-semibold text-text">{t("form.owner")}</legend>
        <div role="radiogroup" aria-label={t("form.owner")} className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "epic", Icon: BuildingsIcon, label: t("owner.epicBadge"), sub: t("form.ownerEpic") },
              { value: "vendor", Icon: HandshakeIcon, label: t("owner.vendorShort"), sub: t("form.ownerVendor") },
            ] as const
          ).map(({ value, Icon, label, sub }) => {
            const on = owner === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setOwner(value)}
                className={cn(
                  "flex items-center gap-2.5 rounded-control border-[1.5px] px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow]",
                  on ? "border-accent bg-soft shadow-[0_0_0_3px_var(--ring-soft)]" : "border-border-strong hover:border-accent/60",
                )}
              >
                <Icon size={22} weight={on ? "fill" : "duotone"} className={cn("shrink-0", on ? "text-accent" : "text-muted")} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-bold text-title">{label}</span>
                  <span className="truncate text-xs text-muted">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <AnimatePresence initial={false}>
          {owner === "vendor" ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              {vendors.length ? (
                <div role="radiogroup" aria-label={t("form.vendor")} className="flex flex-wrap gap-2 pt-1">
                  {vendors.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={vendorId === v.id}
                      onClick={() => setVendorId(v.id)}
                      className={cn(
                        "inline-flex h-10 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-colors",
                        vendorId === v.id ? "border-accent bg-accent text-white" : "border-border-strong text-title hover:bg-soft",
                      )}
                    >
                      {vendorId === v.id ? <CheckIcon size={14} weight="bold" /> : null}
                      {v.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="pt-1 text-sm text-muted">{t("form.noVendors")}</p>
              )}
              {tried && !vendorOk && vendors.length ? <p role="alert" className="pt-1.5 text-sm font-medium text-bad-fg">{t("form.pickVendor")}</p> : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </fieldset>
      {car ? null : (
        <Field label={t("form.code")} htmlFor="car-code" hint={t("form.codeHint")} error={tried && !codeOk ? t("form.codeBad") : undefined}>
          <Input
            id="car-code"
            mono
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
          <Input id="car-km" mono inputMode="numeric" value={km} placeholder={t("form.kmPlaceholder")} invalid={tried && !kmOk} onChange={(e) => setKm(e.target.value.replace(/\D/g, "").slice(0, 7))} />
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
  const [km, setKm] = useState(car.km_known ? String(car.current_km) : "");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quick = car.km_known ? [t("km.reason1"), t("km.reason2"), t("km.reason3")] : [t("km.reasonFirst")];
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
