"use client";

import { ArrowClockwiseIcon, HouseIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LostRoad } from "./lost-road";

/** Something broke while drawing the page: say so kindly, offer to try again. */
export function ErrorView({ reset, digest, compact }: { reset: () => void; digest?: string; compact?: boolean }) {
  const t = useTranslations("states");
  return (
    <div className={cn("flex w-full flex-col items-center gap-4 text-center", compact ? "py-10" : "min-h-dvh justify-center px-gutter")}>
      <div className="w-full max-w-[20rem]">
        <LostRoad tone="broken" />
      </div>
      <h1 className="font-display text-2xl font-bold text-title">{t("errorTitle")}</h1>
      <p className="max-w-sm text-muted">{t("errorBody")}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <Button size="lg" lift onClick={reset}>
          <ArrowClockwiseIcon size={18} weight="bold" />
          {t("tryAgain")}
        </Button>
        {compact ? null : (
          <Link href="/" className={cn(buttonVariants({ size: "lg", variant: "secondary" }))}>
            <HouseIcon size={18} weight="bold" />
            {t("home")}
          </Link>
        )}
      </div>
      {digest ? <p className="font-mono text-xs text-muted/70">{t("code", { digest })}</p> : null}
    </div>
  );
}
