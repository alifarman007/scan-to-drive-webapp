import { ArrowLeftIcon, ArrowRightIcon, CarIcon, ProhibitIcon, WrenchIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { DriverFrame } from "@/components/driver/driver-frame";
import { StartForm } from "@/components/driver/start-form";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Odometer } from "@/components/ui/odometer";
import { Reveal } from "@/components/ui/reveal";
import { StatusChip } from "@/components/ui/status-chip";
import type { CarPage } from "@/lib/driver-api";
import { getDriverSession, serverGet } from "@/lib/server-api";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ v?: string }> };

export async function generateMetadata({ params }: Props) {
  const { code } = await params;
  return { title: decodeURIComponent(code).toUpperCase() };
}

/**
 * Where a car's QR sticker leads (/c/CAR-03?v=1), or a typed car code (/c/CAR-03).
 * Not signed in: sign in first and come straight back. Then: the start form, or why this car cannot start now.
 */
export default async function CarRoute({ params, searchParams }: Props) {
  const { code: rawCode } = await params;
  const { v } = await searchParams;
  const code = decodeURIComponent(rawCode).toUpperCase();
  const here = `/c/${encodeURIComponent(code)}${v ? `?v=${encodeURIComponent(v)}` : ""}`;

  const { driver } = await getDriverSession();
  if (!driver) redirect(`/driver/login?next=${encodeURIComponent(here)}`);

  const t = await getTranslations("carPage");
  const query = v && /^\d+$/.test(v) ? `?v=${v}` : "";
  const { status, data } = await serverGet<CarPage | { detail?: { code?: string } }>(`/cars/${encodeURIComponent(code)}${query}`);

  if (status === 401) redirect(`/driver/login?next=${encodeURIComponent(here)}`);
  if (status !== 200 || !data || !("car" in data)) {
    const reason = status === 404 ? "notFound" : status === 410 ? "outdated" : status === 0 || status >= 500 ? "offline" : "generic";
    return (
      <DriverFrame>
        <StateCard icon={<ProhibitIcon size={28} weight="duotone" />} tone="bad" title={t(`${reason}Title`, { code })} body={t(`${reason}Body`)}>
          <BackHome label={t("back")} />
        </StateCard>
      </DriverFrame>
    );
  }

  const page = data;
  const mine = page.my_open_trip;
  // This driver's open trip is on this car: go straight to it.
  if (mine && mine.car_code === page.car.car_code) redirect("/driver/trip");

  const header = <CarHeader page={page} label={t("lastEndKm")} status={t(`carStatus.${page.car.status}`)} startTitle={t("startTitle")} />;

  if (mine) {
    return (
      <DriverFrame header={header}>
        <StateCard icon={<CarIcon size={28} weight="duotone" />} tone="wait" title={t("otherTripTitle")} body={t("otherTripBody", { car: mine.car_code, trip: mine.trip_no })}>
          <Link href="/driver/trip" className={cn(buttonVariants({ size: "xl", lift: true }))}>
            {t("openMyTrip")}
            <ArrowRightIcon size={20} weight="bold" />
          </Link>
        </StateCard>
      </DriverFrame>
    );
  }

  if (!page.can_start) {
    const code2 = page.blocked?.code ?? "";
    const key = code2 === "CAR_IN_USE" ? "inUse" : code2 === "CAR_IN_MAINTENANCE" ? "maintenance" : "inactive";
    return (
      <DriverFrame header={header}>
        <StateCard
          icon={key === "maintenance" ? <WrenchIcon size={28} weight="duotone" /> : <ProhibitIcon size={28} weight="duotone" />}
          tone={key === "inUse" ? "wait" : "bad"}
          title={t(`${key}Title`)}
          body={key === "inUse" ? page.blocked?.message ?? "" : t(`${key}Body`)}
        >
          <BackHome label={t("back")} />
        </StateCard>
      </DriverFrame>
    );
  }

  return (
    <DriverFrame header={header} hideFooter>
      <StartForm page={page} />
    </DriverFrame>
  );
}

function CarHeader({ page, label, status, startTitle }: { page: CarPage; label: string; status: string; startTitle: string }) {
  const { car } = page;
  return (
    <Reveal className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-xs font-bold tracking-[0.14em] text-sky uppercase">{startTitle}</p>
        <h1 className="font-display text-4xl font-bold">{car.car_code}</h1>
        <p className="truncate text-sm text-[#c9d3ea]">
          {car.model} · {car.reg_number}
        </p>
        <StatusChip status={car.status === "active" ? "available" : "maintenance"} size="sm" className="mt-1 w-fit">
          {status}
        </StatusChip>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Odometer value={car.last_end_km} size="sm" framed={false} />
        <span className="text-[0.7rem] text-sky">{label}</span>
      </div>
    </Reveal>
  );
}

function StateCard({
  icon,
  tone,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  tone: "bad" | "wait";
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Reveal>
      <Card className="flex flex-col items-start gap-3 border-0 p-6 shadow-lift">
        <span
          className={cn(
            "inline-flex size-14 items-center justify-center rounded-2xl",
            tone === "bad" ? "bg-bad-bg text-bad-fg" : "bg-wait-bg text-wait-fg",
          )}
        >
          {icon}
        </span>
        <h2 className="font-display text-xl font-bold text-title">{title}</h2>
        <p className="text-muted">{body}</p>
        <div className="mt-2 flex w-full flex-col gap-2">{children}</div>
      </Card>
    </Reveal>
  );
}

function BackHome({ label }: { label: string }) {
  return (
    <Link href="/driver" className="inline-flex items-center gap-2 text-sm font-bold text-accent">
      <ArrowLeftIcon size={16} weight="bold" />
      {label}
    </Link>
  );
}
