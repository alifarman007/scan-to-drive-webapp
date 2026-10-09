"use client";

import { SignOutIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

export function SignOutButton() {
  const t = useTranslations("driverHome");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api("/auth/logout", { method: "POST", query: { who: "driver" } });
    } catch {
      /* even if the call fails, go to the sign-in page */
    }
    router.replace("/driver/login");
    router.refresh();
  }

  return (
    <Button variant="ghost" size="md" onClick={signOut} disabled={busy}>
      <SignOutIcon size={18} weight="bold" />
      {t("signOut")}
    </Button>
  );
}
