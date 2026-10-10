"use client";

import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";

/**
 * A dialog for one decision (close a trip, approve ...): centred on laptops, a sheet from the bottom on phones.
 * Esc, the X and a click outside close it, unless `busy` (while saving).
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  busy,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  busy?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("common");
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
              <Dialog.Content asChild forceMount {...(description ? {} : { "aria-describedby": undefined })}>
                <motion.div
                  className="pointer-events-auto relative flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-[1.75rem] bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-lg sm:rounded-panel sm:p-6"
                  initial={{ opacity: 0, y: 40, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 30, scale: 0.98 }}
                  transition={{ type: "spring", stiffness: 460, damping: 38 }}
                >
                  <div className="flex items-start justify-between gap-4 pr-1">
                    <div className="flex flex-col gap-1">
                      <Dialog.Title className="font-display text-xl font-bold text-title">{title}</Dialog.Title>
                      {description ? <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description> : null}
                    </div>
                    <Dialog.Close
                      disabled={busy}
                      className="-mt-1 -mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-title disabled:opacity-40"
                    >
                      <XIcon size={18} weight="bold" />
                      <span className="sr-only">{t("close")}</span>
                    </Dialog.Close>
                  </div>
                  {children}
                </motion.div>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
