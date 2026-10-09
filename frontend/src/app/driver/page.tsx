import { ArrowRightIcon, WifiSlashIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { CarCodeForm } from "@/components/driver/car-code-form";
import { DriverFrame } from "@/components/driver/driver-frame";
import { ScanVisual } from "@/components/driver/scan-visual";
import { SignOutButton } from "@/components/driver/sign-out-button";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Odometer } from "@/components/ui/odometer";
import { Reveal } from "@/components/ui/reveal";
import { StatusChip, type Status } from "@/components/ui/status-chip";
import { getDriverSession, serverGet } from "@/lib/server-api";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getTranslations("driverHome");
  return { title: t("scanTitle") };
}

type ActiveTrip = {
  trip: null | {
    id: number;
    trip_no: string;
    status: "waiting_for_passenger" | "in_progress" | "waiting_for_end_confirm";
    car_code: string;
    car_model: string;
    destination: string;
    start_km: number;
    passenger_name: string | null;
  };
};

const CHIP: Record<string, Status> = {
  waiting_for_passenger: "waiting",
  in_progress: "on_trip",
  waiting_for_end_confirm: "waiting",
};

function greetingKey(): "morning" | "afternoon" | "evening" {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Dhaka" }).format(new Date()),
  );
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** Driver home: greeting, the open trip if there is one, otherwise "scan the sticker". */
export default async function DriverHome() {
  const { driver, offline } = await getDriverSession();
  const t = await getTranslations("driverHome");

  if (offline) {
    return (
      <DriverFrame>
        <Card className="flex flex-col items-start gap-3 border-0 p-6 shadow-lift">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-bad-bg text-bad-fg">
            <WifiSlashIcon size={26} weight="duotone" />
          </span>
          <h1 className="font-display text-xl font-bold text-title">{t("offlineTitle")}</h1>
          <p className="text-muted">{t("offlineBody")}</p>
        </Card>
      </DriverFrame>
    );
  }
  if (!driver) redirect("/driver/login");

  const { data } = await serverGet<ActiveTrip>("/trips/active");
  const trip = data?.trip ?? null;

  return (
    <DriverFrame
      header={
        <Reveal className="flex flex-col gap-0.5">
          <p className="text-sm text-[#c9d3ea]">{t(greetingKey())},</p>
          <h1 className="font-display text-3xl font-bold">{driver.name}</h1>
          <p className="font-mono text-sm text-sky">{driver.employee_id}</p>
        </Reveal>
      }
      footer={<SignOutButton />}
    >
      {trip ? (
        <Reveal delay={0.05}>
          <Card className="flex flex-col gap-4 border-0 p-5 shadow-lift">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-muted">{t("activeTitle")}</p>
              <StatusChip status={CHIP[trip.status] ?? "on_trip"} live={trip.status === "in_progress"} size="sm">
                {t(`tripStatus.${trip.status}`)}
              </StatusChip>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div className="flex flex-col">
                <span className="font-display text-2xl font-bold text-title">{trip.car_code}</span>
                <span className="text-sm text-muted">
                  {trip.car_model} · {trip.destination}
                </span>
              </div>
              <Odometer value={trip.start_km} size="sm" />
            </div>
            <Link
              href={`/c/${encodeURIComponent(trip.car_code)}`}
              className={cn(buttonVariants({ size: "xl", lift: true }))}
            >
              {t("openTrip")}
              <ArrowRightIcon size={20} weight="bold" />
            </Link>
          </Card>
        </Reveal>
      ) : (
        <Reveal delay={0.05}>
          <Card className="flex flex-col gap-5 border-0 p-6 shadow-lift">
            <ScanVisual />
            <div className="flex flex-col gap-1.5 text-center">
              <h2 className="font-display text-xl font-bold text-title">{t("scanTitle")}</h2>
              <p className="text-sm text-muted">{t("scanBody")}</p>
            </div>
            <div className="h-px bg-border" />
            <CarCodeForm />
          </Card>
        </Reveal>
      )}
    </DriverFrame>
  );
}
