"use client";

import {
  ArrowCounterClockwiseIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  FileCsvIcon,
  FlaskIcon,
  ProhibitIcon,
  TrayArrowUpIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { Plate, Segmented, useFlash } from "@/components/admin/fleet/shared";
import { Stars } from "@/components/admin/stars";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Reveal } from "@/components/ui/reveal";
import { Select } from "@/components/ui/select";
import { ApiError, api } from "@/lib/api";
import { isSignedOut, toSignIn } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type Person = { id: number; name: string; employee_id: string };
type OldTrip = {
  key: string;
  rows: [string, string | null];
  car: { id: number; car_code: string; reg_number: string; owner: "epic" | "vendor" } | null;
  plate_text: string;
  driver_text: string;
  driver: Person | null;
  driver_choices: Person[];
  start_time: string | null;
  end_time: string | null;
  start_place: string;
  destination: string;
  end_place: string;
  start_km: number | null;
  end_km: number | null;
  distance: number | null;
  passenger: { kind: string; employee_id: string | null; typed: string[]; rating: number | null; comment: string | null } | null;
  problems: string[];
  warnings: string[];
  looks_like_test: boolean;
  already: string | null;
};
type PreviewData = { trips: OldTrip[]; skipped: { row: string; reason: string }[]; drivers: Person[] };
export type ImportBatch = { batch: string; trips: number; km: number; first: string; last: string; at: string | null; by: string | null; file: string | null };
type Result = { batch: string; imported: number; km: number; first: string; last: string; refused: { key: string; reason: string }[] };

type Group = "ready" | "test" | "no" | "done";
const groupOf = (t: OldTrip, driverPicked: boolean): Group => {
  if (t.already) return "done";
  const left = t.problems.filter((p) => !(driverPicked && (p.includes("could be") || p.includes("not found"))));
  if (left.length) return "no";
  return t.looks_like_test ? "test" : "ready";
};

/**
 * Hidden admin page (not in the menu): bring in the trips from the old Driver / Passenger Travel Log forms.
 * Upload the CSV exports, check what was found (the test rows and broken rows are set aside), import, undo if needed.
 */
export function OldTripsImport({ batches }: { batches: ImportBatch[] }) {
  const t = useTranslations("oldImport");
  const router = useRouter();
  const [driverFile, setDriverFile] = useState<File | null>(null);
  const [paxFile, setPaxFile] = useState<File | null>(null);
  const [data, setData] = useState<PreviewData | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [show, setShow] = useState<Group>("ready");
  const [busy, setBusy] = useState<"read" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [flash, showFlash] = useFlash();

  function form() {
    const f = new FormData();
    if (driverFile) f.append("driver_log", driverFile);
    if (paxFile) f.append("passenger_log", paxFile);
    return f;
  }

  function fail(err: unknown) {
    if (isSignedOut(err)) return toSignIn();
    setError(err instanceof ApiError && err.code === "BAD_OLD_LOG" ? err.message : err instanceof ApiError && err.status === 0 ? t("errors.network") : t("errors.generic"));
  }

  async function read() {
    if (!driverFile || busy) return;
    setBusy("read");
    setError(null);
    try {
      const res = await api<PreviewData>("/admin/import/old-trips/preview", { form: form() });
      setData(res);
      setInclude(new Set(res.trips.filter((x) => groupOf(x, false) === "ready").map((x) => x.key)));
      setPicked({});
      setShow("ready");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!data || busy || !include.size) return;
    setBusy("import");
    setError(null);
    const f = form();
    f.append("choices", JSON.stringify({ include: [...include], drivers: picked }));
    try {
      const res = await api<Result>("/admin/import/old-trips", { form: f });
      setResult(res);
      setData(null);
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  const groups = useMemo(() => {
    const g: Record<Group, OldTrip[]> = { ready: [], test: [], no: [], done: [] };
    for (const x of data?.trips ?? []) g[groupOf(x, x.key in picked)].push(x);
    return g;
  }, [data, picked]);
  const chosen = (data?.trips ?? []).filter((x) => include.has(x.key) && ["ready", "test"].includes(groupOf(x, x.key in picked)));
  const chosenKm = chosen.reduce((s, x) => s + (x.distance ?? 0), 0);

  function toggle(key: string, on: boolean) {
    setInclude((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-section pb-24">
      <Reveal className="flex flex-col gap-1">
        <p className="text-xs font-bold tracking-[0.14em] text-accent uppercase">{t("eyebrow")}</p>
        <h1 className="font-display text-3xl font-bold text-title">{t("title")}</h1>
        <p className="max-w-2xl text-muted">{t("intro")}</p>
      </Reveal>

      <AnimatePresence mode="wait">
        {result ? (
          <Done key="done" result={result} onAgain={() => setResult(null)} />
        ) : !data ? (
          <motion.div key="upload" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
            <Card className="flex flex-col gap-5 p-4 sm:p-6">
              <div className="grid gap-3 md:grid-cols-2">
                <DropFile label={t("driverLog")} hint={t("driverHint")} file={driverFile} onFile={setDriverFile} required />
                <DropFile label={t("passengerLog")} hint={t("passengerHint")} file={paxFile} onFile={setPaxFile} />
              </div>
              {error ? <p role="alert" className="text-sm font-semibold text-bad-fg">{error}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">{t("safe")}</p>
                <Button size="lg" lift disabled={!driverFile || busy !== null} onClick={() => void read()}>
                  {busy === "read" ? <CircleNotchIcon size={18} className="animate-spin" /> : <ArrowRightIcon size={18} weight="bold" />}
                  {t("read")}
                </Button>
              </div>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="check" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(["ready", "test", "no", "done"] as const).map((g) => (
                <SummaryCard key={g} group={g} count={groups[g].length} km={groups[g].reduce((s, x) => s + (x.distance ?? 0), 0)} active={show === g} onClick={() => setShow(g)} />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                id="old-trips-show"
                label={t("show")}
                value={show}
                onChange={setShow}
                options={(["ready", "test", "no", "done"] as const).map((g) => ({ value: g, label: t(`group.${g}`), count: groups[g].length }))}
              />
              {show === "ready" || show === "test" ? (
                <div className="flex gap-2">
                  <Button variant="secondary" size="md" onClick={() => groups[show].forEach((x) => toggle(x.key, true))}>
                    <CheckIcon size={16} weight="bold" />
                    {t("all")}
                  </Button>
                  <Button variant="secondary" size="md" onClick={() => groups[show].forEach((x) => toggle(x.key, false))}>
                    <XIcon size={16} weight="bold" />
                    {t("none")}
                  </Button>
                </div>
              ) : null}
            </div>
            {show === "test" ? <Note tone="wait">{t("testNote")}</Note> : show === "no" ? <Note tone="bad">{t("noNote")}</Note> : null}

            <ul className="flex flex-col gap-2.5">
              {groups[show].map((x, i) => (
                <motion.li key={x.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 15) * 0.02 } }}>
                  <TripRow
                    trip={x}
                    group={show}
                    on={include.has(x.key)}
                    onToggle={(v) => toggle(x.key, v)}
                    drivers={data.drivers}
                    picked={picked[x.key]}
                    onPick={(id) => {
                      setPicked((p) => ({ ...p, [x.key]: id }));
                      toggle(x.key, true);
                    }}
                  />
                </motion.li>
              ))}
              {groups[show].length === 0 ? <li className="rounded-card border border-dashed border-border-strong p-8 text-center text-sm text-muted">{t("emptyGroup")}</li> : null}
            </ul>
            {data.skipped.length && show === "no" ? (
              <Card className="flex flex-col gap-2 p-4">
                <h3 className="font-semibold text-title">{t("skipped", { count: data.skipped.length })}</h3>
                {data.skipped.map((s) => (
                  <p key={s.row} className="text-sm text-muted">
                    <span className="font-mono text-xs">#{s.row}</span> {s.reason}
                  </p>
                ))}
              </Card>
            ) : null}

            {/* the import bar */}
            <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 lg:bottom-6 lg:left-[19.5rem] lg:right-6">
              <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-[1.25rem] bg-side px-4 py-3 text-white shadow-[0_18px_40px_-14px_rgb(15_26_61/0.6)] ring-1 ring-white/10">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-display font-bold">{t("chosen", { count: chosen.length })}</span>
                  <span className="truncate text-xs text-sky">{t("chosenKm", { km: chosenKm.toLocaleString("en-US") })}</span>
                </span>
                <Button variant="ghost" size="md" className="text-white hover:bg-white/10" onClick={() => setData(null)} disabled={busy !== null}>
                  {t("back")}
                </Button>
                <Button size="md" lift disabled={!chosen.length || busy !== null} onClick={() => void run()}>
                  {busy === "import" ? <CircleNotchIcon size={17} className="animate-spin" /> : <TrayArrowUpIcon size={17} weight="bold" />}
                  {t("import")}
                </Button>
              </div>
              {error ? <p role="alert" className="mx-auto mt-2 max-w-3xl rounded-xl bg-bad-bg px-3 py-2 text-sm font-semibold text-bad-fg">{error}</p> : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Batches batches={batches} onUndone={(n) => { showFlash(t("undone", { count: n })); router.refresh(); }} />
      {flash}
    </div>
  );
}

function DropFile({ label, hint, file, onFile, required }: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void; required?: boolean }) {
  const t = useTranslations("oldImport");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={cn(
        "relative flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-5 text-center transition-colors",
        file ? "border-ok-dot/60 bg-ok-bg/40" : over ? "border-accent bg-soft" : "border-border-strong hover:border-accent/60",
      )}
    >
      <input ref={input} type="file" accept=".csv,text/csv" className="sr-only" aria-label={label} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      <motion.span key={file?.name ?? "none"} initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} className={cn("grid size-12 place-items-center rounded-2xl", file ? "bg-ok-dot text-white" : "bg-soft text-accent")}>
        {file ? <CheckIcon size={24} weight="bold" /> : <FileCsvIcon size={26} weight="duotone" />}
      </motion.span>
      <span className="font-semibold text-title">
        {label} {required ? null : <span className="text-xs font-normal text-muted">({t("optional")})</span>}
      </span>
      {file ? (
        <span className="flex max-w-full items-center gap-2 text-sm text-ok-fg">
          <span className="truncate font-mono">{file.name}</span>
          <button type="button" onClick={() => onFile(null)} aria-label={t("remove")} className="rounded-full p-1 hover:bg-ok-bg">
            <XIcon size={14} weight="bold" />
          </button>
        </span>
      ) : (
        <span className="text-sm text-muted">{hint}</span>
      )}
      <button type="button" onClick={() => input.current?.click()} className="text-sm font-bold text-accent hover:underline">
        {file ? t("change") : t("choose")}
      </button>
    </div>
  );
}

const GROUP_STYLE: Record<Group, { icon: typeof CheckCircleIcon; tone: string }> = {
  ready: { icon: CheckCircleIcon, tone: "bg-ok-bg text-ok-fg" },
  test: { icon: FlaskIcon, tone: "bg-wait-bg text-wait-fg" },
  no: { icon: ProhibitIcon, tone: "bg-bad-bg text-bad-fg" },
  done: { icon: ClockCounterClockwiseIcon, tone: "bg-soft text-title" },
};

function SummaryCard({ group, count, km, active, onClick }: { group: Group; count: number; km: number; active: boolean; onClick: () => void }) {
  const t = useTranslations("oldImport");
  const { icon: Icon, tone } = GROUP_STYLE[group];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-card border bg-card p-4 text-left transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-lift",
        active ? "border-accent shadow-[0_0_0_3px_var(--ring-soft)]" : "border-border",
      )}
    >
      <span className={cn("inline-flex size-9 items-center justify-center rounded-xl", tone)}>
        <Icon size={19} weight="duotone" />
      </span>
      <span className="font-display text-3xl font-bold text-title tabular-nums">{count}</span>
      <span className="text-sm font-semibold text-muted">
        {t(`group.${group}`)}
        {km > 0 && (group === "ready" || group === "done") ? <span className="font-normal"> · {km.toLocaleString("en-US")} km</span> : null}
      </span>
    </button>
  );
}

function Note({ tone, children }: { tone: "wait" | "bad"; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-medium", tone === "wait" ? "bg-wait-bg text-wait-fg" : "bg-bad-bg text-bad-fg")}>
      <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
      {children}
    </p>
  );
}

function TripRow({
  trip: x,
  group,
  on,
  onToggle,
  drivers,
  picked,
  onPick,
}: {
  trip: OldTrip;
  group: Group;
  on: boolean;
  onToggle: (v: boolean) => void;
  drivers: Person[];
  picked?: number;
  onPick: (id: number) => void;
}) {
  const t = useTranslations("oldImport");
  const format = useFormatter();
  const can = group === "ready" || group === "test";
  const unclear = !x.driver && (x.driver_choices.length > 0 || x.problems.some((p) => p.includes("not found")));
  const when = (iso: string | null) => (iso ? format.dateTime(new Date(iso), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "–");
  const notes = [...x.problems.filter((p) => !(picked && (p.includes("could be") || p.includes("not found")))), ...x.warnings];

  return (
    <div
      className={cn(
        "flex gap-3 rounded-card border bg-card p-3.5 transition-[opacity,border-color] sm:p-4",
        can && on ? "border-accent/50" : "border-border",
        !can && "opacity-80",
        can && !on && "opacity-60",
      )}
    >
      <label className={cn("mt-0.5 flex shrink-0", can ? "cursor-pointer" : "cursor-not-allowed")}>
        <input type="checkbox" className="peer sr-only" checked={can && on} disabled={!can} onChange={(e) => onToggle(e.target.checked)} aria-label={t("includeTrip", { key: x.key })} />
        <span className="grid size-6 place-items-center rounded-lg border-[1.5px] border-border-strong text-white transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:shadow-[0_0_0_3px_var(--ring-soft)]">
          {can && on ? <CheckIcon size={14} weight="bold" /> : null}
        </span>
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-display text-lg font-bold text-title">{x.car?.car_code ?? "?"}</span>
          {x.car ? <Plate reg={x.car.reg_number} size="sm" /> : <span className="font-mono text-xs text-bad-fg">{x.plate_text || "–"}</span>}
          <span className="text-sm text-muted">
            {when(x.start_time)} →{" "}
            {x.end_time
              ? new Date(x.end_time).toDateString() === new Date(x.start_time ?? x.end_time).toDateString()
                ? format.dateTime(new Date(x.end_time), { hour: "numeric", minute: "2-digit" })
                : when(x.end_time)
              : "…"}
          </span>
          {x.already ? <span className="rounded-full bg-soft px-2 py-0.5 font-mono text-xs font-bold text-title">{x.already}</span> : null}
          <span className="ml-auto font-mono text-[0.68rem] text-muted">#{x.rows[0]}{x.rows[1] ? `–${x.rows[1]}` : ""}</span>
        </div>
        <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_auto]">
          <span className="min-w-0">
            {unclear && !picked ? (
              <Select aria-label={t("chooseDriver")} value="" onChange={(e) => onPick(Number(e.target.value))} className="w-full sm:w-64">
                <option value="">{t("whoIs", { name: x.driver_text })}</option>
                {(x.driver_choices.length ? x.driver_choices : drivers).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · {d.employee_id}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate font-semibold text-text">{picked ? drivers.find((d) => d.id === picked)?.name : x.driver?.name}</span>
                {x.driver_text && (picked || x.driver) ? <span className="shrink-0 text-xs text-muted">({t("typed", { name: x.driver_text })})</span> : null}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <span className="truncate">{x.start_place || "–"}</span>
            <ArrowRightIcon size={13} className="shrink-0" />
            <span className="truncate">{x.destination || x.end_place || "–"}</span>
          </span>
          <span className="font-mono text-xs whitespace-nowrap text-text tabular-nums">
            {x.start_km?.toLocaleString("en-US") ?? "–"} → {x.end_km?.toLocaleString("en-US") ?? "–"}
            {x.distance !== null && x.distance > 0 ? <b className="ml-1.5 font-bold text-accent">+{x.distance.toLocaleString("en-US")} km</b> : null}
          </span>
        </div>
        {x.passenger ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-soft px-2 py-0.5 font-semibold text-title">
              {x.passenger.employee_id ? t("passengerId", { id: x.passenger.employee_id }) : x.passenger.kind.toLowerCase().startsWith("other") ? t("visitor") : t("passengerNoId")}
            </span>
            {x.passenger.rating ? <Stars value={x.passenger.rating} size={13} /> : null}
            {x.passenger.comment ? <span className="truncate italic">“{x.passenger.comment}”</span> : null}
          </div>
        ) : null}
        {notes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {notes.map((n) => (
              <span key={n} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", x.problems.includes(n) ? "bg-bad-bg text-bad-fg" : "bg-wait-bg text-wait-fg")}>
                {n}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Done({ result, onAgain }: { result: Result; onAgain: () => void }) {
  const t = useTranslations("oldImport");
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short" });
  return (
    <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <motion.span initial={{ scale: 0.3, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 400, damping: 16 }} className="grid size-16 place-items-center rounded-full bg-ok-dot text-white">
          <CheckIcon size={32} weight="bold" />
        </motion.span>
        <h2 className="font-display text-2xl font-bold text-title">{t("doneTitle", { count: result.imported })}</h2>
        <p className="text-muted">{t("doneBody", { km: result.km.toLocaleString("en-US"), from: day(result.first), to: day(result.last) })}</p>
        {result.refused.length ? <p className="text-sm text-wait-fg">{t("doneRefused", { count: result.refused.length })}</p> : null}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/admin/trips?imported=1" className={buttonVariants({ size: "lg", lift: true })}>
            {t("seeTrips")}
            <ArrowRightIcon size={18} weight="bold" />
          </Link>
          <Button variant="secondary" size="lg" onClick={onAgain}>
            {t("another")}
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}

function Batches({ batches, onUndone }: { batches: ImportBatch[]; onUndone: (n: number) => void }) {
  const t = useTranslations("oldImport");
  const format = useFormatter();
  const [undo, setUndo] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!batches.length) return null;
  const day = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "short" });

  async function doUndo() {
    if (!undo) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ removed: number }>(`/admin/import/batches/${encodeURIComponent(undo.batch)}`, { method: "DELETE" });
      setUndo(null);
      onUndone(r.removed);
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Reveal delay={0.1}>
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <h2 className="font-display text-lg font-semibold text-title">{t("earlier")}</h2>
        <ul className="flex flex-col divide-y divide-border">
          {batches.map((b) => (
            <li key={b.batch} className="flex flex-wrap items-center gap-3 py-3">
              <span className="grid size-9 place-items-center rounded-xl bg-soft text-accent">
                <TrayArrowUpIcon size={18} weight="duotone" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold text-title">{t("batchLine", { count: b.trips, km: b.km.toLocaleString("en-US") })}</span>
                <span className="truncate text-xs text-muted">
                  {t("batchMeta", { from: day(b.first), to: day(b.last), by: b.by ?? "–", at: b.at ? day(b.at) : "–" })}
                  {b.file ? ` · ${b.file}` : ""}
                </span>
              </span>
              <Button variant="secondary" size="md" onClick={() => setUndo(b)}>
                <ArrowCounterClockwiseIcon size={16} weight="bold" />
                {t("undo")}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Modal open={undo !== null} onOpenChange={(o) => !o && setUndo(null)} busy={busy} title={t("undoTitle")} description={undo ? t("undoBody", { count: undo.trips }) : undefined}>
        {error ? <p className="text-sm font-semibold text-bad-fg">{error}</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setUndo(null)} disabled={busy}>
            {t("keep")}
          </Button>
          <Button size="lg" onClick={() => void doUndo()} disabled={busy} className="bg-bad-dot hover:bg-bad-dot/90">
            {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : <ArrowCounterClockwiseIcon size={18} weight="bold" />}
            {t("undoConfirm")}
          </Button>
        </div>
      </Modal>
    </Reveal>
  );
}
