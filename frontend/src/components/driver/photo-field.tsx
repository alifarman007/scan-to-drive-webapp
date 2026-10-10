"use client";

import { ArrowsClockwiseIcon, CameraIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { compressPhoto } from "@/lib/photo";
import { cn } from "@/lib/utils";

/**
 * "Photo of the dashboard": opens the phone's camera (the back one), shrinks the picture for a quick upload,
 * and shows it with a Retake button. The parent gets the ready-to-send Blob.
 */
export function PhotoField({
  id,
  label,
  hint,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  hint: string;
  value: Blob | null;
  onChange: (photo: Blob | null) => void;
  invalid?: boolean;
}) {
  const t = useTranslations("tripForm");
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // free the preview's memory when it changes or the form closes
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function picked(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressPhoto(file);
      onChange(blob);
      setPreview(URL.createObjectURL(blob));
    } catch {
      onChange(file); // could not shrink it (rare): send the original, the server checks the size
      setPreview(URL.createObjectURL(file));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ""; // allow taking the same photo again
    }
  }

  const has = Boolean(value && preview);
  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => void picked(e.target.files?.[0])}
        aria-label={label}
      />
      <AnimatePresence mode="wait" initial={false}>
        {has ? (
          <motion.div
            key="photo"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="relative overflow-hidden rounded-card border border-border bg-ink"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (blob: URL), not a site image */}
            <img src={preview!} alt={t("photoPreviewAlt")} className="aspect-[4/3] w-full object-cover" />
            <span className="absolute top-3 left-3 rounded-full bg-ok-bg px-2.5 py-1 text-xs font-bold text-ok-fg shadow">
              {t("photoReady")}
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="absolute right-3 bottom-3 inline-flex h-10 items-center gap-2 rounded-full bg-black/60 px-4 text-sm font-bold text-white backdrop-blur active:scale-95"
            >
              <ArrowsClockwiseIcon size={16} weight="bold" />
              {t("retake")}
            </button>
          </motion.div>
        ) : (
          <motion.button
            key="take"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              "flex items-center gap-3.5 rounded-card border-[1.5px] border-dashed bg-card p-3.5 text-left transition-colors active:scale-[0.99]",
              invalid ? "border-bad-dot bg-bad-bg/40" : "border-sky hover:bg-soft",
            )}
          >
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-soft text-accent">
              {busy ? <CircleNotchIcon size={26} className="animate-spin" /> : <CameraIcon size={26} weight="duotone" />}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="font-bold text-text">{label}</span>
              <span className="text-sm text-muted">{busy ? t("photoPreparing") : hint}</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
