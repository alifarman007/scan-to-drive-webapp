import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";
import { Stagger, StaggerItem } from "@/components/ui/reveal";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("dashboard") };
}

/** Layout of the dashboard with loading placeholders. Real numbers arrive in step 5. */
export default async function DashboardPage() {
  const t = await getTranslations();
  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-bold text-title">{t("dashboard.greeting")}</h1>
        <p className="text-sm text-muted">{t("dashboard.skeletonNote")}</p>
      </div>

      <Stagger className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-3.5">
        {Array.from({ length: 6 }, (_, i) => (
          <StaggerItem key={i}>
            <Card className="flex flex-col gap-3 p-4">
              <span className="skeleton h-3.5 w-20 rounded-full" />
              <span className="skeleton h-8 w-14 rounded-lg" />
              <span className="skeleton h-3 w-24 rounded-full" />
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      <div className="flex flex-wrap items-start gap-section">
        <Card className="min-w-0 flex-[999_1_32rem] p-5">
          <span className="skeleton mb-4 block h-5 w-28 rounded-full" />
          <Stagger className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3 rounded-2xl bg-bay p-3">
            {Array.from({ length: 10 }, (_, i) => (
              <StaggerItem key={i}>
                <div className="flex h-32 flex-col gap-2.5 rounded-control border border-border bg-card p-3">
                  <span className="skeleton h-4 w-16 rounded-full" />
                  <span className="skeleton h-6 w-24 rounded-full" />
                  <span className="skeleton h-3 w-full rounded-full" />
                  <span className="skeleton h-3 w-2/3 rounded-full" />
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </Card>
        <Card className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4 p-5">
          <span className="skeleton block h-5 w-24 rounded-full" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="skeleton h-8 w-14 rounded-lg" />
              <span className="flex flex-1 flex-col gap-1.5">
                <span className="skeleton h-3.5 w-3/4 rounded-full" />
                <span className="skeleton h-3 w-1/2 rounded-full" />
              </span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
