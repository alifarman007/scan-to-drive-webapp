"use client";

import {
  ArrowCounterClockwiseIcon,
  BellRingingIcon,
  CircleNotchIcon,
  ClockCounterClockwiseIcon,
  DotsSixVerticalIcon,
  EyeIcon,
  ListBulletsIcon,
  MinusIcon,
  PlusIcon,
  QrCodeIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAdminUser } from "@/components/admin/admin-shell";
import { Avatar, PageHeader, useFlash } from "@/components/admin/fleet/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { ApiError } from "@/lib/api";
import { useNowSeconds } from "@/lib/hooks";
import { adminApi, isSignedOut, toSignIn, type SettingKey, type SettingRow, type SettingsChange, type SettingsPage } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type Values = Record<SettingKey, number>;

const SECTIONS: { id: string; icon: typeof QrCodeIcon; keys: SettingKey[] }[] = [
  { id: "qr", icon: QrCodeIcon, keys: ["qr_expiry_minutes", "wrong_id_limit"] },
  { id: "passengers", icon: UsersThreeIcon, keys: ["allow_visitors", "allow_cant_scan"] },
  { id: "alerts", icon: BellRingingIcon, keys: ["long_trip_hours", "waiting_too_long_minutes", "km_gap_limit_km", "high_km_limit_km"] },
];

const SWITCHES = new Set<SettingKey>(["allow_visitors", "allow_cant_scan"]);
const PRESETS: Partial<Record<SettingKey, number[]>> = {
  qr_expiry_minutes: [5, 10, 15, 30],
  wrong_id_limit: [3, 5, 10],
  long_trip_hours: [4, 6, 8, 12],
  waiting_too_long_minutes: [15, 30, 60],
  km_gap_limit_km: [10, 20, 50],
  high_km_limit_km: [150, 300, 500],
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Settings: how long QR codes last, wrong-ID limit, visitors and "can't scan", alert limits, trip purposes.
 * Changes are collected and saved together from the bar at the bottom; each setting says what it does with
 * the value in the sentence, shows its default, and who changed it last. Viewers can look but not change.
 */
export function SettingsView({ data }: { data: SettingsPage }) {
  const t = useTranslations("settings");
  const user = useAdminUser();
  const router = useRouter();
  const [flash, showFlash] = useFlash();
  const canEdit = user.role === "admin";

  const fromServer = useMemo(() => Object.fromEntries(data.settings.map((s) => [s.key, s.value])) as Values, [data.settings]);
  const rows = useMemo(() => Object.fromEntries(data.settings.map((s) => [s.key, s])) as Record<SettingKey, SettingRow>, [data.settings]);
  // what is saved (the server's values, or what was just saved before the page has the new data)
  const [base, setBase] = useState<{ values: Values; purposes: string[] }>({ values: fromServer, purposes: data.purposes });
  const [draft, setDraft] = useState<Values>(fromServer);
  const [purposes, setPurposes] = useState<string[]>(data.purposes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New data from the server (after a save, or someone else's change): take it, but keep anything the
  // person is still editing.
  const [seen, setSeen] = useState(data);
  if (seen !== data) {
    setSeen(data);
    setDraft((d) => Object.fromEntries((Object.keys(d) as SettingKey[]).map((k) => [k, d[k] !== base.values[k] ? d[k] : fromServer[k]])) as Values);
    setPurposes((p) => (sameList(p, base.purposes) ? data.purposes : p));
    setBase({ values: fromServer, purposes: data.purposes });
  }
  const saved = base.values;

  const changedKeys = (Object.keys(draft) as SettingKey[]).filter((k) => draft[k] !== saved[k]);
  const purposesChanged = !sameList(purposes, base.purposes);
  const count = changedKeys.length + (purposesChanged ? 1 : 0);

  // a warning before leaving the page with unsaved changes
  useEffect(() => {
    if (!count) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  const set = (key: SettingKey, v: number) => {
    const r = rows[key];
    setDraft((d) => ({ ...d, [key]: Math.min(r.max, Math.max(r.min, v)) }));
    setError(null);
  };

  async function save() {
    if (!count || busy) return;
    setBusy(true);
    setError(null);
    try {
      const values = { ...draft };
      const list = [...purposes];
      if (changedKeys.length) await adminApi.saveSettings(Object.fromEntries(changedKeys.map((k) => [k, values[k]])));
      if (purposesChanged) await adminApi.savePurposes(list);
      setBase({ values, purposes: list });
      showFlash(t("saved", { count }));
      router.refresh();
    } catch (err) {
      if (isSignedOut(err)) return toSignIn();
      setError(err instanceof ApiError && err.code === "BAD_PURPOSE" ? t("purposes.bad") : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-section pb-24">
      <Reveal>
        <PageHeader title={t("title")} summary={t("summary")} />
      </Reveal>
      {!canEdit ? (
        <Reveal delay={0.03}>
          <p className="flex items-center gap-2.5 rounded-2xl bg-soft px-4 py-3 text-sm font-semibold text-title">
            <EyeIcon size={18} weight="duotone" className="shrink-0 text-accent" />
            {t("viewOnly")}
          </p>
        </Reveal>
      ) : null}

      <div className="grid gap-section xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="flex min-w-0 flex-col gap-section">
          {SECTIONS.map((sec, i) => (
            <Reveal key={sec.id} delay={0.05 + i * 0.04}>
              <Card className="flex flex-col p-4 sm:p-5">
                <SectionTitle icon={sec.icon} title={t(`sections.${sec.id}.title`)} hint={t(`sections.${sec.id}.hint`)} />
                <ul className="mt-2 flex flex-col">
                  {sec.keys.map((key) => (
                    <li key={key} className="border-t border-border first:border-t-0">
                      <SettingItem row={rows[key]} value={draft[key]} changed={draft[key] !== saved[key]} canEdit={canEdit} onChange={(v) => set(key, v)} />
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          ))}
          <Reveal delay={0.2}>
            <PurposesCard purposes={purposes} onChange={setPurposes} changed={purposesChanged} canEdit={canEdit} />
          </Reveal>
        </div>
        <Reveal delay={0.12} className="xl:sticky xl:top-6">
          <History items={data.history} />
        </Reveal>
      </div>

      {/* unsaved changes: a bar rises from the bottom */}
      <AnimatePresence>
        {count && canEdit ? (
          <motion.div
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 lg:inset-x-auto lg:right-8 lg:bottom-8 lg:left-[calc(18rem+2rem)]"
          >
            <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-[1.4rem] bg-ink p-2 pl-4 text-white shadow-[0_18px_40px_-12px_rgb(15_26_61/0.6)] ring-1 ring-white/10">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#f7c266] opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2.5 rounded-full bg-[#f7c266]" />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{error ?? t("unsaved", { count })}</span>
              <Button
                variant="ghost"
                size="md"
                className="text-[#c9d3ea] hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setDraft(saved);
                  setPurposes(base.purposes);
                  setError(null);
                }}
                disabled={busy}
              >
                <ArrowCounterClockwiseIcon size={16} weight="bold" />
                <span className="hidden sm:inline">{t("undo")}</span>
                <span className="sr-only sm:hidden">{t("undo")}</span>
              </Button>
              <Button size="md" onClick={() => void save()} disabled={busy} className="bg-white text-navy hover:bg-[#e6ecfa]">
                {busy ? (
                  <CircleNotchIcon size={18} className="animate-spin" />
                ) : (
                  <>
                    <span className="sm:hidden">{t("saveShort")}</span>
                    <span className="hidden sm:inline">{t("save")}</span>
                  </>
                )}
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {flash}
    </div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof QrCodeIcon; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 pb-2">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-accent">
        <Icon size={20} weight="duotone" />
      </span>
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-lg font-semibold text-title">{title}</h2>
        <p className="text-sm text-muted">{hint}</p>
      </div>
    </div>
  );
}

/** One setting: name, a sentence with the value in it, the control, and the default / last change underneath. */
function SettingItem({
  row,
  value,
  changed,
  canEdit,
  onChange,
}: {
  row: SettingRow;
  value: number;
  changed: boolean;
  canEdit: boolean;
  onChange: (v: number) => void;
}) {
  const t = useTranslations("settings");
  const format = useFormatter();
  const isSwitch = SWITCHES.has(row.key);
  const presets = PRESETS[row.key] ?? [];
  const unit = t(`items.${row.key}.unit`, { n: value });

  return (
    <div className="relative flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <AnimatePresence>
        {changed ? (
          <motion.span
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            exit={{ scaleY: 0 }}
            className="absolute top-4 bottom-4 -left-4 w-1 rounded-r-full bg-wait-dot sm:-left-5"
            aria-hidden="true"
          />
        ) : null}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold text-title">{t(`items.${row.key}.title`)}</span>
        <p className="text-sm text-muted">
          {t.rich(`items.${row.key}.${isSwitch ? (value ? "on" : "off") : "sentence"}`, {
            n: value,
            b: (chunks) => <b className="font-bold text-title tabular-nums">{chunks}</b>,
          })}
        </p>
        <p className="text-xs text-muted/90">
          {!isSwitch && value !== row.default ? (
            <>
              {t("default", { value: row.default, unit: t(`items.${row.key}.unit`, { n: row.default }) })}
              {canEdit ? (
                <>
                  {" · "}
                  <button type="button" onClick={() => onChange(row.default)} className="font-semibold text-accent hover:underline">
                    {t("useDefault")}
                  </button>
                </>
              ) : null}
            </>
          ) : null}
          {!isSwitch && value !== row.default && row.updated_by_name ? " · " : null}
          {row.updated_by_name && row.updated_at
            ? t("changedBy", { name: row.updated_by_name, date: format.dateTime(new Date(row.updated_at), { day: "numeric", month: "short" }) })
            : null}
        </p>
      </div>
      {isSwitch ? (
        <Switch checked={value === 1} onChange={(on) => onChange(on ? 1 : 0)} disabled={!canEdit} label={t(`items.${row.key}.title`)} />
      ) : (
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Stepper
            value={value}
            min={row.min}
            max={row.max}
            step={row.key.endsWith("_km") ? 10 : 1}
            unit={unit}
            disabled={!canEdit}
            label={t(`items.${row.key}.title`)}
            onChange={onChange}
          />
          {canEdit && presets.length ? (
            <div className="flex gap-1">
              {presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onChange(p)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-xs font-semibold tabular-nums transition-colors",
                    p === value ? "bg-accent text-white" : "bg-soft text-title hover:bg-ring-soft",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** − 15 + with the number typed in the middle; the value pops when it changes. */
function Stepper({
  value,
  min,
  max,
  step,
  unit,
  disabled,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  disabled: boolean;
  label: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const n = Number(text);
    if (text === "" || !Number.isFinite(n)) setText(String(value));
    else onChange(Math.round(n));
  };
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-70")}>
      <div className="flex h-11 items-center rounded-control border-[1.5px] border-border-strong bg-card focus-within:border-ring focus-within:shadow-[0_0_0_4px_var(--ring-soft)]">
        <button
          type="button"
          aria-label={`${label} −`}
          onClick={() => onChange(value - step)}
          disabled={disabled || value <= min}
          className="inline-flex h-full w-10 items-center justify-center rounded-l-[0.7rem] text-title transition-colors hover:bg-soft disabled:opacity-35"
        >
          <MinusIcon size={16} weight="bold" />
        </button>
        <motion.input
          key={value}
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 600, damping: 20 }}
          aria-label={label}
          inputMode="numeric"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onChange(value + step);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              onChange(value - step);
            }
          }}
          className="h-full w-16 bg-transparent text-center font-mono text-lg font-semibold text-title tabular-nums outline-none"
        />
        <button
          type="button"
          aria-label={`${label} +`}
          onClick={() => onChange(value + step)}
          disabled={disabled || value >= max}
          className="inline-flex h-full w-10 items-center justify-center rounded-r-[0.7rem] text-title transition-colors hover:bg-soft disabled:opacity-35"
        >
          <PlusIcon size={16} weight="bold" />
        </button>
      </div>
      <span className="w-16 text-sm font-semibold text-muted">{unit}</span>
    </div>
  );
}

/** An on / off switch with a knob that springs across. */
function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors duration-200 outline-none focus-visible:shadow-[0_0_0_4px_var(--ring-soft)] disabled:opacity-60",
        checked ? "bg-ok-dot" : "bg-border-strong",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 700, damping: 32 }}
        className={cn("size-6 rounded-full bg-white shadow-md", checked ? "ml-auto" : "")}
      />
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  trip purposes                                                                                    */
/* ------------------------------------------------------------------------------------------------ */

function PurposesCard({ purposes, onChange, changed, canEdit }: { purposes: string[]; onChange: (p: string[]) => void; changed: boolean; canEdit: boolean }) {
  const t = useTranslations("settings.purposes");
  const [text, setText] = useState("");
  const clean = text.replace(/\s+/g, " ").trim();
  const dup = purposes.some((p) => p.toLowerCase() === clean.toLowerCase());
  const full = purposes.length >= 30;

  const add = () => {
    if (!clean || dup || full) return;
    onChange([...purposes, clean.slice(0, 60)]);
    setText("");
  };

  return (
    <Card className="relative flex flex-col gap-4 p-4 sm:p-5">
      {changed ? <span aria-hidden="true" className="absolute top-5 bottom-5 left-0 w-1 rounded-r-full bg-wait-dot" /> : null}
      <SectionTitle icon={ListBulletsIcon} title={t("title")} hint={t("hint")} />
      <Reorder.Group axis="y" values={purposes} onReorder={canEdit ? onChange : () => undefined} className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {purposes.map((p) => (
            <PurposeItem key={p} value={p} canEdit={canEdit} canRemove={purposes.length > 1} onRemove={() => onChange(purposes.filter((x) => x !== p))} />
          ))}
        </AnimatePresence>
      </Reorder.Group>
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="flex flex-col gap-1.5"
        >
          <div className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={60}
              disabled={full}
              aria-label={t("addLabel")}
              placeholder={full ? t("full") : t("addPlaceholder")}
              className="h-11 min-w-0 flex-1 rounded-control border-[1.5px] border-border-strong bg-card px-4 text-[0.95rem] text-text outline-none placeholder:text-muted/70 focus:border-ring focus:shadow-[0_0_0_4px_var(--ring-soft)] disabled:opacity-60"
            />
            <Button type="submit" variant="secondary" size="md" disabled={!clean || dup || full}>
              <PlusIcon size={16} weight="bold" />
              {t("add")}
            </Button>
          </div>
          {dup && clean ? <p className="text-sm font-medium text-wait-fg">{t("dup")}</p> : <p className="text-xs text-muted">{t("dragHint")}</p>}
        </form>
      ) : null}
    </Card>
  );
}

function PurposeItem({ value, canEdit, canRemove, onRemove }: { value: string; canEdit: boolean; canRemove: boolean; onRemove: () => void }) {
  const t = useTranslations("settings.purposes");
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={value}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.18 } }}
      whileDrag={{ scale: 1.02, boxShadow: "0 12px 28px -8px rgb(15 26 61 / 0.35)" }}
      className="flex items-center gap-2 rounded-2xl border border-border bg-card py-1.5 pr-1.5 pl-1"
    >
      {canEdit ? (
        <button
          type="button"
          aria-label={t("drag", { name: value })}
          onPointerDown={(e) => controls.start(e)}
          className="inline-flex size-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-xl text-muted hover:bg-soft active:cursor-grabbing"
        >
          <DotsSixVerticalIcon size={20} weight="bold" />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <span className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold text-title">{value}</span>
      {canEdit && canRemove ? (
        <button
          type="button"
          aria-label={t("remove", { name: value })}
          onClick={onRemove}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-bad-bg hover:text-bad-fg"
        >
          <XIcon size={16} weight="bold" />
        </button>
      ) : null}
    </Reorder.Item>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/*  history                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

function History({ items }: { items: SettingsChange[] }) {
  const t = useTranslations("settings");
  const format = useFormatter();
  const nowSec = useNowSeconds();
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-5">
      <SectionTitle icon={ClockCounterClockwiseIcon} title={t("history.title")} hint={t("history.hint")} />
      {items.length === 0 ? (
        <p className="rounded-2xl bg-bay px-4 py-6 text-center text-sm text-muted">{t("history.empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {items.map((h, i) => (
            <li key={`${h.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
              {i < items.length - 1 ? <span aria-hidden="true" className="absolute top-9 bottom-1 left-[0.95rem] w-0.5 rounded bg-border" /> : null}
              <Avatar name={h.by} size={32} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm">
                  <b className="font-semibold text-title">{h.by}</b>{" "}
                  <span className="text-muted">
                    ·{" "}
                    {nowSec === null
                      ? format.dateTime(new Date(h.at), { day: "numeric", month: "short" })
                      : format.relativeTime(new Date(h.at), new Date(nowSec * 1000))}
                  </span>
                </span>
                {h.event === "purposes_changed" ? (
                  <span className="text-sm text-text">{t("history.purposes")}</span>
                ) : (
                  Object.entries((h.detail ?? {}) as Record<string, { from: number; to: number }>).map(([key, ch]) => (
                    <span key={key} className="text-sm text-text">
                      {t.has(`items.${key}.title`) ? t(`items.${key}.title`) : key}:{" "}
                      <span className="font-mono text-muted line-through decoration-muted/60">{SWITCHES.has(key as SettingKey) ? t(ch.from ? "history.on" : "history.off") : ch.from}</span>
                      {" → "}
                      <span className="font-mono font-bold text-title">{SWITCHES.has(key as SettingKey) ? t(ch.to ? "history.on" : "history.off") : ch.to}</span>
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
