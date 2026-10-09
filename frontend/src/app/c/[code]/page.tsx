import { ArrowLeftIcon, CarIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { DriverFrame } from "@/components/driver/driver-frame";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { getDriverSession } from "@/lib/server-api";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ v?: string }> };

/**
 * Where a car's QR sticker leads (/c/CAR-03?v=1). Not signed in: sign in first, then come straight back here.
 * The car page itself (start form, active trip) is built in step 3.
 */
export default async function CarPage({ params, searchParams }: Props) {
  const { code } = await params;
  const { v } = await searchParams;
  const here = `/c/${encodeURIComponent(code)}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

  const { driver } = await getDriverSession();
  if (!driver) redirect(`/driver/login?next=${encodeURIComponent(here)}`);

  const t = await getTranslations("carPage");
  return (
    <DriverFrame>
      <Reveal>
        <Card className="flex flex-col items-start gap-3 border-0 p-6 shadow-lift">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-soft text-accent">
            <CarIcon size={26} weight="duotone" />
          </span>
          <h1 className="font-display text-2xl font-bold text-title">{t("title", { code: decodeURIComponent(code) })}</h1>
          <p className="text-muted">{t("body")}</p>
          <Link href="/driver" className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-accent">
            <ArrowLeftIcon size={16} weight="bold" />
            {t("back")}
          </Link>
        </Card>
      </Reveal>
    </DriverFrame>
  );
}
