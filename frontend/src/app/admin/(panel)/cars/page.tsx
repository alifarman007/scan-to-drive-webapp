import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { CarsList } from "@/components/admin/fleet/cars";
import { OfflineCard } from "@/components/admin/offline-card";
import type { Car } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("cars") };
}

type Props = { searchParams: Promise<{ q?: string; state?: string }> };
const FILTERS = ["on_trip", "available", "maintenance", "inactive"] as const;

/** All cars (a fleet is small: the page gets all of them and filters on the spot). */
export default async function CarsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { status, data } = await serverGet<{ cars: Car[] }>("/admin/cars");
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent("/admin/cars")}&expired=1`);
  if (!data) return <OfflineCard />;
  const filter = FILTERS.find((f) => f === sp.state) ?? "";
  return <CarsList cars={data.cars} initialQ={(sp.q ?? "").slice(0, 80)} initialFilter={filter} />;
}
