import { CalendarCheckIcon, ClockIcon, FileXlsIcon, TimerIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { StatusChip } from "@/components/ui/status-chip";

export async function generateMetadata() {
  const t = await getTranslations("overtime");
  return { title: t("title") };
}

// Sample rows for the preview only. Nothing here is read from the database.
const SAMPLE = [
  { name: "Akash Rahman", days: 6, hours: "9 h 40 m", approved: false },
  { name: "Rahim Uddin", days: 4, hours: "6 h 15 m", approved: true },
  { name: "Karim Ali", days: 3, hours: "4 h 05 m", approved: false },
];

/** Placeholder for the Phase 2 overtime feature: what it will do, with a faded preview. */
export default async function OvertimePage() {
  const t = await getTranslations("overtime");
  const points = [
    { icon: ClockIcon, title: t("point1Title"), body: t("point1Body") },
    { icon: CalendarCheckIcon, title: t("point2Title"), body: t("point2Body") },
    { icon: FileXlsIcon, title: t("point3Title"), body: t("point3Body") },
  ];
  return (
    <div className="flex max-w-5xl flex-col gap-section">
      <div className="relative overflow-hidden rounded-panel bg-navy p-6 text-white sm:p-8">
        <TimerIcon
          size={180}
          weight="thin"
          className="pointer-events-none absolute -top-6 -right-6 text-white/10"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-bold tracking-wide text-sky uppercase">
            <span className="size-1.5 rounded-full bg-sky" />
            {t("badge")}
          </span>
          <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
          <p className="max-w-2xl text-lg text-[#c9d3ea]">{t("lead")}</p>
        </div>
      </div>

      <Stagger className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
        {points.map((p) => (
          <StaggerItem key={p.title}>
            <Card className="flex h-full flex-col gap-3 p-5">
              <span className="inline-flex size-11 items-center justify-center rounded-xl bg-soft text-accent">
                <p.icon size={22} weight="duotone" />
              </span>
              <h2 className="font-display text-lg font-semibold text-title">{p.title}</h2>
              <p className="text-sm text-muted">{p.body}</p>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      <Card className="relative overflow-hidden p-5">
        <p className="mb-3 text-xs font-bold tracking-wide text-muted uppercase">{t("previewLabel")}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm" aria-label={t("previewLabel")}>
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-4 font-semibold">{t("colDriver")}</th>
                <th className="py-2 pr-4 font-semibold">{t("colDays")}</th>
                <th className="py-2 pr-4 font-semibold">{t("colHours")}</th>
                <th className="py-2 font-semibold">{t("colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {SAMPLE.map((r) => (
                <tr key={r.name} className="border-t border-border">
                  <td className="py-3 pr-4 font-semibold">{r.name}</td>
                  <td className="py-3 pr-4 font-mono">{r.days}</td>
                  <td className="py-3 pr-4 font-mono">{r.hours}</td>
                  <td className="py-3">
                    <StatusChip size="sm" status={r.approved ? "available" : "waiting"}>
                      {r.approved ? t("statusApproved") : t("statusPending")}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* fades the sample out so it reads as a preview, not real data */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-card to-transparent" />
      </Card>

      <p className="text-sm text-muted">{t("note")}</p>
    </div>
  );
}
