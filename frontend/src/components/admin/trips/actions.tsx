"use client";

import { CircleNotchIcon, LockKeyOpenIcon, ProhibitIcon, SealCheckIcon, SealWarningIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ApiError, NETWORK_ERROR } from "@/lib/api";
import { adminApi, isSignedOut, toSignIn, type TripDetail } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

type Trip = TripDetail["trip"];
export type Done = "closed" | "unlocked" | "approved" | "rejected";
type Kind = "close" | "unlock" | "approve" | "reject";

const OPEN = ["waiting_for_passenger", "in_progress", "waiting_for_end_confirm"];

/** The buttons an admin can use on this trip right now (viewers see none). Each one asks first, in a dialog. */
export function TripActions({ trip, onDone }: { trip: Trip; onDone: (what: Done) => void }) {
  const t = useTranslations("tripDetail.actions");
  const [open, setOpen] = useState<Kind | null>(null);
  const canClose = OPEN.includes(trip.status);
  const canUnlock = Boolean(trip.lock?.locked);
  const canDecide = trip.approval_status === "pending";
  if (!canClose && !canUnlock && !canDecide) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canDecide ? (
        <>
          <Button size="md" onClick={() => setOpen("approve")}>
            <SealCheckIcon size={18} weight="bold" />
            {t("approve")}
          </Button>
          <Button size="md" variant="secondary" onClick={() => setOpen("reject")}>
            <SealWarningIcon size={18} weight="bold" />
            {t("reject")}
          </Button>
        </>
      ) : null}
      {canUnlock ? (
        <Button size="md" onClick={() => setOpen("unlock")}>
          <LockKeyOpenIcon size={18} weight="bold" />
          {t("unlock")}
        </Button>
      ) : null}
      {canClose ? (
        <Button size="md" variant="danger" onClick={() => setOpen("close")}>
          <ProhibitIcon size={18} weight="bold" />
          {t("close")}
        </Button>
      ) : null}

      {open ? (
        <ActionDialog
          kind={open}
          trip={trip}
          onClose={() => setOpen(null)}
          onDone={(what) => {
            setOpen(null);
            onDone(what);
          }}
        />
      ) : null}
    </div>
  );
}

function ActionDialog({ kind, trip, onClose, onDone }: { kind: Kind; trip: Trip; onClose: () => void; onDone: (what: Done) => void }) {
  const t = useTranslations("tripDetail.actions");
  const [text, setText] = useState("");
  const [km, setKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const needsText = kind !== "approve";
  const askKm = kind === "close" && trip.end_km === null;
  const kmValue = km.trim() ? Number(km) : undefined;
  const kmBad = askKm && kmValue !== undefined && (!Number.isInteger(kmValue) || kmValue <= trip.start_km);
  const quick: string[] = kind === "close" ? [t("quick.forgot"), t("quick.phone"), t("quick.mistake")] : kind === "unlock" ? [t("quick.typo"), t("quick.checked")] : [];

  function message(err: unknown) {
    if (isSignedOut(err)) {
      toSignIn();
      return null;
    }
    if (!(err instanceof ApiError)) return t("errors.generic");
    if (err.code === NETWORK_ERROR || err.code === "BACKEND_DOWN") return t("errors.network");
    const known = ["END_KM_TOO_LOW", "END_KM_ALREADY_SET", "TRIP_NOT_OPEN", "NOT_LOCKED", "NO_PENDING_APPROVAL", "NOTE_REQUIRED", "REASON_REQUIRED"];
    if (known.includes(err.code)) return t(`errors.${err.code}`, { km: trip.start_km.toLocaleString("en-US") });
    if (err.status === 403) return t("errors.forbidden");
    return t("errors.generic");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if ((needsText && !text.trim()) || kmBad || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "close") await adminApi.closeTrip(trip.id, text.trim(), kmValue);
      else if (kind === "unlock") await adminApi.unlockTrip(trip.id, text.trim());
      else await adminApi.decideApproval(trip.id, kind === "approve" ? "approved" : "rejected", text.trim());
      onDone(kind === "close" ? "closed" : kind === "unlock" ? "unlocked" : kind === "approve" ? "approved" : "rejected");
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  const label = { close: t("close"), unlock: t("unlock"), approve: t("approve"), reject: t("reject") }[kind];

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      busy={busy}
      title={t(`${kind}Title`, { trip: trip.trip_no })}
      description={t(`${kind}Body`)}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {quick.length ? (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setText(q)}
                aria-pressed={text === q}
                className={cn(
                  "rounded-full border-[1.5px] px-3 py-1.5 text-sm font-semibold transition-colors",
                  text === q ? "border-accent bg-accent text-accent-text" : "border-border-strong text-text hover:bg-soft",
                )}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}
        <Field
          label={kind === "approve" ? t("noteOptional") : kind === "reject" ? t("noteRequired") : t("reason")}
          htmlFor="action-text"
          error={tried && needsText && !text.trim() ? (kind === "reject" ? t("errors.NOTE_REQUIRED") : t("errors.REASON_REQUIRED")) : undefined}
        >
          <textarea
            id="action-text"
            rows={3}
            maxLength={1000}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={(tried && needsText && !text.trim()) || undefined}
            placeholder={kind === "reject" ? t("rejectPlaceholder") : kind === "approve" ? t("approvePlaceholder") : t("reasonPlaceholder")}
            className="w-full resize-none rounded-control border-[1.5px] border-border-strong bg-card px-4 py-3 text-base text-text outline-none placeholder:text-muted/70 focus:border-ring focus:shadow-[0_0_0_4px_var(--ring-soft)] aria-invalid:border-bad-dot"
          />
        </Field>
        {askKm ? (
          <Field
            label={t("endKm")}
            htmlFor="action-km"
            hint={kmBad ? undefined : t("endKmHint", { km: trip.start_km.toLocaleString("en-US") })}
            error={kmBad ? t("errors.END_KM_TOO_LOW", { km: trip.start_km.toLocaleString("en-US") }) : undefined}
          >
            <Input id="action-km" mono inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))} invalid={kmBad} maxLength={7} placeholder={String(trip.start_km + 1)} />
          </Field>
        ) : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-bad-fg">
            <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant={kind === "close" || kind === "reject" ? "danger" : "primary"} disabled={busy} aria-busy={busy}>
            {busy ? <CircleNotchIcon size={18} className="animate-spin" /> : null}
            {label}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
