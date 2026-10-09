import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { DriverFrame } from "@/components/driver/driver-frame";
import { DriverLogin } from "@/components/driver/driver-login";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { safeNext } from "@/lib/api";
import { getDriverSession } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("driverAuth");
  return { title: t("pageTitle") };
}

type Props = { searchParams: Promise<{ next?: string }> };

export default async function DriverLoginPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).next, "/driver");
  const { driver } = await getDriverSession();
  if (driver) redirect(next); // already signed in on this phone

  const t = await getTranslations("driverAuth");
  return (
    <DriverFrame
      header={<p className="text-xs font-bold tracking-[0.14em] text-sky uppercase">{t("eyebrow")}</p>}
    >
      <Reveal>
        <Card className="border-0 p-5 shadow-lift sm:p-6">
          <DriverLogin next={next} />
        </Card>
      </Reveal>
    </DriverFrame>
  );
}
