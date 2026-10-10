"use client";

import { CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Bottom sheet that asks for a reason (quick choices or typed) before an action like cancel or "can't scan". */
export function ReasonSheet({
  open,
  onOpenChange,
  title,
  description,
  reasons,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  reasons: string[];
  confirmLabel: string;
  danger?: boolean;
  /** Return an error message to show it in the sheet, or nothing when done. */
  onConfirm: (reason: string) => Promise<string | void>;
}) {
  const t = useTranslations("tripForm");
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = (picked === "__other" ? other : picked ?? "").trim();

  async function confirm() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    const err = await onConfirm(reason);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!busy) onOpenChange(o);
      }}
      title={title}
      description={description}
    >
      <div className="flex flex-col gap-2" role="radiogroup" aria-label={t("reason")}>
        {[...reasons, "__other"].map((r) => {
          const active = picked === r;
          return (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPicked(r)}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-control border-[1.5px] px-4 text-left text-[0.95rem] font-semibold transition-colors",
                active ? "border-accent bg-soft text-title" : "border-border bg-card text-text hover:bg-soft",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  active ? "border-accent" : "border-border-strong",
                )}
              >
                {active ? <span className="size-2.5 rounded-full bg-accent" /> : null}
              </span>
              {r === "__other" ? t("otherReason") : r}
            </button>
          );
        })}
        {picked === "__other" ? (
          <Input autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder={t("otherReasonPlaceholder")} maxLength={500} />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-bad-fg">
          <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
          {error}
        </p>
      ) : null}
      <Button size="xl" variant={danger ? "danger" : "primary"} disabled={!reason || busy} onClick={() => void confirm()}>
        {busy ? <CircleNotchIcon size={22} className="animate-spin" /> : confirmLabel}
      </Button>
    </Sheet>
  );
}
