"use client";

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Fallback when the sticker is missing or will not scan: type the car code (CAR-03) to open the car page. */
export function CarCodeForm() {
  const t = useTranslations("driverHome");
  const router = useRouter();
  const [code, setCode] = useState("");
  const clean = code.trim().toUpperCase();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) router.push(`/c/${encodeURIComponent(clean)}`);
      }}
    >
      <label htmlFor="car-code" className="text-sm font-semibold text-text">
        {t("typeCode")}
      </label>
      <div className="flex gap-2">
        <Input
          id="car-code"
          mono
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={t("carCodePlaceholder")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="h-12 text-base"
        />
        <Button type="submit" variant="secondary" className="h-12 shrink-0" disabled={!clean} aria-label={t("open")}>
          {t("open")}
          <ArrowRightIcon size={18} weight="bold" />
        </Button>
      </div>
    </form>
  );
}
