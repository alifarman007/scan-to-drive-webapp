"use client";

import { ArrowsClockwiseIcon, CircleNotchIcon, MapPinIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";

import { Input, Label } from "@/components/ui/input";
import type { GeoState } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * A place name the driver types (start or end place), with the phone's GPS shown underneath.
 * The GPS point is saved with the trip; without it the trip still works (the place name is what counts).
 */
export function LocationField({
  id,
  label,
  value,
  onChange,
  geo,
  onRetry,
  placeholder,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  geo: GeoState;
  onRetry: () => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const t = useTranslations("tripForm");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} invalid={invalid} maxLength={255} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={geo.status}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          className={cn(
            "flex items-center gap-2 text-sm",
            geo.status === "ok" ? "text-ok-fg" : geo.status === "locating" ? "text-muted" : "text-wait-fg",
          )}
          aria-live="polite"
        >
          {geo.status === "locating" ? (
            <>
              <CircleNotchIcon size={16} className="animate-spin" />
              {t("gpsLocating")}
            </>
          ) : geo.status === "ok" ? (
            <>
              <MapPinIcon size={16} weight="fill" />
              {t("gpsOk", { meters: geo.accuracy })}
            </>
          ) : (
            <>
              <WarningIcon size={16} weight="fill" />
              <span className="flex-1">{t(`gps_${geo.status}`)}</span>
              {geo.status !== "insecure" ? (
                <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-bold text-accent">
                  <ArrowsClockwiseIcon size={14} weight="bold" />
                  {t("gpsRetry")}
                </button>
              ) : null}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
