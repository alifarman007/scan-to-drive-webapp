import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { Dashboard } from "@/components/admin/dashboard/dashboard";
import { OfflineCard } from "@/components/admin/offline-card";
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
  if (!data) return <OfflineCard />;
  return <Dashboard initial={data} />;
}
