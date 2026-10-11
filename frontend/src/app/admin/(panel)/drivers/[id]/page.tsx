import { SteeringWheelIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cache } from "react";

import { DriverDetailView } from "@/components/admin/fleet/drivers";
import { NotFoundCard } from "@/components/admin/fleet/not-found";
import { OfflineCard } from "@/components/admin/offline-card";
import type { DriverDetail } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> };

const load = cache(async (id: string) => {
  if (!/^\d{1,9}$/.test(id)) return { status: 404, data: null };
  return serverGet<DriverDetail>(`/admin/drivers/${id}`);
});

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const { data } = await load(id);
  const t = await getTranslations("nav");
  return { title: data ? data.driver.name : t("drivers") };
}

export default async function DriverPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { status, data } = await load(id);
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent(`/admin/drivers/${id}`)}&expired=1`);
  if (status === 404) {
    const t = await getTranslations("drivers");
    return <NotFoundCard icon={<SteeringWheelIcon size={28} weight="duotone" />} title={t("notFoundTitle")} body={t("notFoundBody")} back={t("back")} href="/admin/drivers" />;
  }
  if (!data) return <OfflineCard />;
  return <DriverDetailView data={data} isNew={(await searchParams).new === "1"} />;
}
