"use client";

import { QrCodeIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { QrScanner } from "@/components/driver/qr-scanner";
import { Button } from "@/components/ui/button";
import { parsePassengerLink } from "@/lib/passenger-api";

/**
 * "Scan the end QR" without leaving the page: opens the camera here and goes straight to the end page.
 * (The phone's own camera app works just as well; this saves finding it.)
 */
export function ScanEndButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const t = useTranslations("passenger");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xl" lift={variant === "primary"} variant={variant === "primary" ? "primary" : "secondary"} onClick={() => setOpen(true)} className="gap-3">
        <QrCodeIcon size={24} weight="bold" />
        {t("scanEnd")}
      </Button>
      <QrScanner
        open={open}
        onOpenChange={setOpen}
        read={parsePassengerLink}
        // a full page load: the end page is drawn on the server with this phone's cookie
        onFound={(href) => window.location.assign(href)}
        title={t("scanEndTitle")}
        hint={t("scanEndHint")}
        notOurs={t("scanEndNotOurs")}
      />
    </>
  );
}
