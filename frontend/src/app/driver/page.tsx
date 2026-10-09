import { ArrowLeftIcon, SteeringWheelIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";

/** Placeholder until the driver sign-in is built (step 2). */
export default async function DriverPlaceholder() {
  const t = await getTranslations();
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-gutter">
      <Reveal>
        <Card className="flex flex-col items-start gap-3 p-6">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-soft text-accent">
            <SteeringWheelIcon size={26} weight="duotone" />
          </span>
          <h1 className="font-display text-2xl font-bold text-title">{t("placeholder.driverTitle")}</h1>
          <p className="text-muted">{t("placeholder.driverBody")}</p>
          <Link href="/" className="mt-2 inline-flex items-center gap-2 text-sm font-bold text-accent">
            <ArrowLeftIcon size={16} weight="bold" />
            {t("common.backHome")}
          </Link>
        </Card>
      </Reveal>
    </main>
  );
}
