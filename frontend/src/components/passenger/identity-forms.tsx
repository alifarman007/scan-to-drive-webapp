"use client";

import { ArrowLeftIcon, CheckCircleIcon, CircleNotchIcon, IdentificationCardIcon, UserIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PHONE_RE, passengerApi } from "@/lib/passenger-api";
import { cn } from "@/lib/utils";

import { ErrorText, Shake, useErrorText } from "./pieces";

export type Mode = "employee" | "visitor";

/*
 * "Who are you?" on the passenger pages: an employee types the ID and sees only the NAME to catch typos,
 * a visitor gives name, phone and an optional reason. Used on the Start QR, and on the End QR when nobody
 * confirmed the start (the driver used "Passenger can't scan").
 */

/** Epic employee or visitor: a two-way switch with a sliding pill. */
export function WhoPicker({ mode, onChange, pillId }: { mode: Mode; onChange: (m: Mode) => void; pillId: string }) {
  const t = useTranslations("passenger");
  return (
    <div role="radiogroup" aria-label={t("whoAreYou")} className="grid grid-cols-2 gap-1 rounded-control bg-soft p-1">
      {(
        [
          ["employee", t("employee"), IdentificationCardIcon],
          ["visitor", t("visitor"), UserIcon],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "relative flex h-12 items-center justify-center gap-2 rounded-[0.7rem] text-sm font-bold transition-colors",
            mode === value ? "text-title" : "text-muted",
          )}
        >
          {mode === value ? <motion.span layoutId={pillId} className="absolute inset-0 rounded-[0.7rem] bg-card shadow-sm" /> : null}
          <Icon size={18} weight={mode === value ? "fill" : "regular"} className="relative" />
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** The chosen form slides in from its side when the switch changes. */
export function SlideSwap({ mode, children }: { mode: Mode; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={mode}
        initial={{ opacity: 0, x: mode === "employee" ? -16 : 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: mode === "employee" ? -16 : 16 }}
        transition={{ duration: 0.2 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function EmployeeForm<T>({
  token,
  triesLeft,
  confirm,
  confirmLabel,
  onDone,
  onDead,
}: {
  token: string;
  triesLeft: number;
  /** what "Yes" does with the checked ID: confirm the start, or confirm the end */
  confirm: (employeeId: string) => Promise<T>;
  confirmLabel: string;
  onDone: (result: T) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const errorText = useErrorText();
  const [id, setId] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    const value = id.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.lookup(token, value);
      setName(res.name);
    } catch (err) {
      setError(errorText(err, onDead));
      setShake((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirm(id.trim());
      navigator.vibrate?.(40);
      onDone(res);
    } catch (err) {
      setError(errorText(err, onDead));
      setBusy(false);
    }
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {name ? (
        <motion.div key="name" className="flex flex-col gap-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <div className="flex items-center gap-3 rounded-card border-[1.5px] border-ok-dot/40 bg-ok-bg p-4">
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }} className="text-ok-dot">
              <CheckCircleIcon size={32} weight="fill" />
            </motion.span>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-ok-fg">{t("isThisYou")}</span>
              <span className="truncate font-display text-xl font-bold text-ok-fg">{name}</span>
              <span className="font-mono text-sm text-ok-fg/80">{id.trim().toUpperCase()}</span>
            </div>
          </div>
          <ErrorText text={error} />
          <Button size="xl" lift onClick={() => void accept()} disabled={busy} aria-busy={busy}>
            {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : confirmLabel}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setName(null);
              setError(null);
            }}
            disabled={busy}
          >
            <ArrowLeftIcon size={16} weight="bold" />
            {t("notMe")}
          </Button>
        </motion.div>
      ) : (
        <motion.form key="id" onSubmit={check} className="flex flex-col gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }}>
          <Shake shake={shake}>
            <Field label={t("yourId")} htmlFor="p-id" hint={error ? undefined : triesLeft < 5 ? t("triesLeft", { left: triesLeft }) : t("idHint")}>
              <Input
                id="p-id"
                mono
                autoFocus
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="EMP-0000"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setError(null);
                }}
                invalid={Boolean(error)}
                maxLength={40}
              />
            </Field>
          </Shake>
          <ErrorText text={error} />
          <Button type="submit" size="xl" lift disabled={!id.trim() || busy} aria-busy={busy}>
            {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : t("next")}
          </Button>
        </motion.form>
      )}
    </AnimatePresence>
  );
}

export function VisitorForm<T>({
  confirm,
  confirmLabel,
  phoneHint,
  onDone,
  onDead,
}: {
  confirm: (visitor: { name: string; phone: string; reason: string }) => Promise<T>;
  confirmLabel: string;
  phoneHint?: string;
  onDone: (result: T) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const errorText = useErrorText();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = name.trim().length >= 2;
  const phoneOk = PHONE_RE.test(phone.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!nameOk || !phoneOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirm({ name: name.trim(), phone: phone.trim(), reason: reason.trim() });
      navigator.vibrate?.(40);
      onDone(res);
    } catch (err) {
      setError(errorText(err, onDead));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label={t("visitorName")} htmlFor="v-name" error={tried && !nameOk ? t("nameNeeded") : undefined}>
        <Input id="v-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} invalid={tried && !nameOk} maxLength={120} placeholder={t("visitorNamePlaceholder")} />
      </Field>
      <Field
        label={t("visitorPhone")}
        htmlFor="v-phone"
        error={tried && !phoneOk ? t("phoneNeeded") : undefined}
        hint={tried && !phoneOk ? undefined : (phoneHint ?? t("phoneHint"))}
      >
        <Input id="v-phone" type="tel" inputMode="tel" autoComplete="tel" mono value={phone} onChange={(e) => setPhone(e.target.value)} invalid={tried && !phoneOk} maxLength={21} placeholder="01XXX XXXXXX" />
      </Field>
      <Field label={t("visitorReason")} htmlFor="v-reason">
        <Input id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder={t("visitorReasonPlaceholder")} />
      </Field>
      <ErrorText text={error} />
      <Button type="submit" size="xl" lift disabled={busy} aria-busy={busy}>
        {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : confirmLabel}
      </Button>
    </form>
  );
}
