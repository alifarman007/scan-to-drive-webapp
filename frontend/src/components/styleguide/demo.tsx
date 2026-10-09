"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { CountdownRing } from "@/components/ui/countdown-ring";
import { Field, Input } from "@/components/ui/input";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Odometer } from "@/components/ui/odometer";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { StatusChip, type Status } from "@/components/ui/status-chip";
import { ThemeToggle } from "@/components/ui/theme-toggle";

const STATUSES: Status[] = ["available", "on_trip", "waiting", "alert", "maintenance", "inactive"];

export function StyleguideDemo() {
  const t = useTranslations();
  const [km, setKm] = useState(45230);
  const [expires, setExpires] = useState(() => Date.now() + 15 * 60 * 1000);

  return (
    <Stagger className="grid gap-section md:grid-cols-2">
      <StaggerItem>
        <Card className="flex h-full flex-col gap-4 p-6">
          <CardTitle>Odometer</CardTitle>
          <Odometer value={km} size="lg" unit={t("common.km")} />
          <div className="flex flex-wrap items-center gap-3">
            <Odometer value={km} size="md" />
            <Odometer value={km} size="sm" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setKm((v) => v + 38)}>
              + 38 km
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setKm((v) => v + 1250)}>
              + 1,250 km
            </Button>
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex h-full flex-col gap-4 bg-navy p-6">
          <h2 className="font-display text-lg font-semibold text-white">QR countdown</h2>
          <CountdownRing expiresAt={expires} totalSeconds={15 * 60} label="until this code expires" />
          <CountdownRing expiresAt={expires - 14 * 60 * 1000 + 20_000} totalSeconds={15 * 60} label="last minute turns amber" />
          <Button size="sm" variant="inverse" className="w-fit" onClick={() => setExpires(Date.now() + 15 * 60 * 1000)}>
            Restart
          </Button>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex h-full flex-col gap-4 p-6">
          <CardTitle>Status</CardTitle>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusChip key={s} status={s} live={s === "on_trip"}>
                {t(`status.${s}`)}
              </StatusChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <StatusChip key={s} status={s} size="sm">
                {t(`status.${s}`)}
              </StatusChip>
            ))}
          </div>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex h-full flex-col gap-4 p-6">
          <CardTitle>Buttons</CardTitle>
          <div className="flex flex-wrap gap-2.5">
            <Button>Start trip</Button>
            <Button variant="secondary">Make new QR</Button>
            <Button variant="ghost">See all</Button>
            <Button variant="danger">Cancel trip</Button>
          </div>
          <Button size="xl" lift>
            I have arrived · End trip
          </Button>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex h-full flex-col gap-4 p-6">
          <CardTitle>Fields</CardTitle>
          <Field label="Start km" htmlFor="sg-km" hint="Last end km for this car: 45,230">
            <Input id="sg-km" mono inputMode="numeric" defaultValue="45230" />
          </Field>
          <Field label="Employee ID" htmlFor="sg-id" error="This ID is not in the list.">
            <Input id="sg-id" mono invalid defaultValue="EMP-9999" />
          </Field>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex h-full flex-col gap-4 p-6">
          <CardTitle>Type</CardTitle>
          <p className="font-display text-3xl font-bold text-title">Start your trip</p>
          <p>Scan the car QR, fill in the start km and destination, then show the passenger the QR.</p>
          <p lang="bn" className="text-xl font-medium">যাত্রা শুরু করুন · গাড়ির কিউআর স্ক্যান করুন</p>
          <p className="font-mono">T-000214 · 45,230 km · 10:42</p>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <ThemeToggle />
          </div>
        </Card>
      </StaggerItem>
    </Stagger>
  );
}
