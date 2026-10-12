"use client";

import { CheckCircleIcon, CircleNotchIcon, IdentificationCardIcon, UserIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ID_EXAMPLE, PHONE_RE, cleanId, idIsNumeric, idLooksRight, type Employee } from "@/lib/passenger-api";
import { cn } from "@/lib/utils";

import { ErrorText, Shake, useErrorText } from "./pieces";

export type Mode = "employee" | "visitor";

/*
 * "Who are you?" on the passenger pages: an employee types the ID (and a name if they like), a visitor gives
 * name, phone and an optional reason. Used on the Start QR, and on the End QR when nobody confirmed the start
 * (the driver used "Passenger can't scan").
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

/**
 * Employee: type the ID (it only has to look right: there is no staff list to check it against) and, if you
 * like, your name. The ID is cleaned as you type (capitals, no spaces or dashes) and a tick shows once it
 * has the right shape, so a typo is caught before anything is sent.
 */
export function EmployeeForm<T>({
  idPattern,
  triesLeft,
  confirm,
  confirmLabel,
  onDone,
  onDead,
}: {
  idPattern: string;
  triesLeft: number;
  /** what the button does with the ID and name: confirm the start, or confirm the end */
  confirm: (employee: Employee) => Promise<T>;
  confirmLabel: string;
  onDone: (result: T) => void;
  onDead: (code: string) => void;
}) {
  const t = useTranslations("passenger");
  const errorText = useErrorText();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const looksRight = idLooksRight(id, idPattern);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!id || busy) return;
    if (!looksRight) {
      setError(t("errors.BAD_ID_FORMAT"));
      setShake((n) => n + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await confirm({ employeeId: id, name });
      navigator.vibrate?.(40);
      onDone(res);
    } catch (err) {
      setError(errorText(err, onDead));
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Shake shake={shake}>
        <Field label={t("yourId")} htmlFor="p-id" hint={error ? undefined : triesLeft < 5 ? t("triesLeft", { left: triesLeft }) : t("idHint")}>
          <div className="relative">
            <Input
              id="p-id"
              mono
              autoFocus
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              inputMode={idIsNumeric(idPattern) ? "numeric" : "text"}
              placeholder={ID_EXAMPLE}
              value={id}
              onChange={(e) => {
                setId(cleanId(e.target.value));
                setError(null);
              }}
              invalid={Boolean(error)}
              maxLength={20}
              aria-describedby={looksRight ? "p-id-ok" : undefined}
              className="pr-12 uppercase"
            />
            <AnimatePresence>
              {looksRight ? (
                <motion.span
                  id="p-id-ok"
                  key="ok"
                  initial={{ scale: 0, rotate: -40, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 520, damping: 20 }}
                  className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-ok-dot"
                >
                  <CheckCircleIcon size={26} weight="fill" />
                  <span className="sr-only">{t("idLooksRight")}</span>
                </motion.span>
              ) : null}
            </AnimatePresence>
          </div>
        </Field>
      </Shake>
      <Field label={t("yourName")} htmlFor="p-name" hint={t("yourNameHint")}>
        <Input
          id="p-name"
          autoComplete="name"
          enterKeyHint="go"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder={t("visitorNamePlaceholder")}
        />
      </Field>
      <ErrorText text={error} />
      <Button type="submit" size="xl" lift disabled={!id || busy} aria-busy={busy}>
        {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : confirmLabel}
      </Button>
    </form>
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
