import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { SettingsView } from "@/components/admin/office/settings";
import { OfflineCard } from "@/components/admin/offline-card";
import type { SettingsPage as Data } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("settings") };
}

export default async function SettingsPage() {
  const { status, data } = await serverGet<Data>("/admin/settings");
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent("/admin/settings")}&expired=1`);
  if (!data) return <OfflineCard />;
  return <SettingsView data={data} />;
}
