import { CarIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cache } from "react";

import { CarDetailView } from "@/components/admin/fleet/cars";
import { NotFoundCard } from "@/components/admin/fleet/not-found";
import { OfflineCard } from "@/components/admin/offline-card";
import type { CarDetail } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> };

const load = cache(async (id: string) => {
  if (!/^\d{1,9}$/.test(id)) return { status: 404, data: null };
  return serverGet<CarDetail>(`/admin/cars/${id}`);
});

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const { data } = await load(id);
  const t = await getTranslations("nav");
  return { title: data ? data.car.car_code : t("cars") };
}

export default async function CarPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { status, data } = await load(id);
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent(`/admin/cars/${id}`)}&expired=1`);
  if (status === 404) {
    const t = await getTranslations("cars");
    return <NotFoundCard icon={<CarIcon size={28} weight="duotone" />} title={t("notFoundTitle")} body={t("notFoundBody")} back={t("back")} href="/admin/cars" />;
  }
  if (!data) return <OfflineCard />;
  return <CarDetailView data={data} isNew={(await searchParams).new === "1"} />;
}
