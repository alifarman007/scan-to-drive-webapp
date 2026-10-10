import { WifiSlashIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Dashboard } from "@/components/admin/dashboard/dashboard";
import { Card } from "@/components/ui/card";
import type { Dashboard as Data } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("dashboard") };
}

/** The first numbers come with the page; after that the dashboard asks the server by itself. */
export default async function DashboardPage() {
  const { status, data } = await serverGet<Data>("/admin/dashboard");
  if (status === 401) redirect("/admin/login?next=%2Fadmin&expired=1");
  if (!data) {
    const t = await getTranslations("adminAuth");
    return (
      <Card className="flex max-w-lg flex-col items-start gap-3 border-0 p-6 shadow-lift">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-wait-bg text-wait-fg">
          <WifiSlashIcon size={28} weight="duotone" />
        </span>
        <h1 className="font-display text-2xl font-bold text-title">{t("offlineTitle")}</h1>
        <p className="text-muted">{t("offlineBody")}</p>
      </Card>
    );
  }
  return <Dashboard initial={data} />;
}
