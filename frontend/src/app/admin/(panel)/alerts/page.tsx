import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { AlertsView } from "@/components/admin/fleet/alerts";
import { OfflineCard } from "@/components/admin/offline-card";
import type { AlertPage, Car } from "@/lib/admin-api";
import { ALERT_TYPES, ALERTS_PER_PAGE, type AlertFilters } from "@/lib/alert-filters";
import { serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("alerts") };
}

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/** Alerts, filters in the address (/admin/alerts?status=solved&type=km_gap&car=3). */
export default async function AlertsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const n = Number(sp.n);
  const filters: AlertFilters = {
    status: sp.status === "solved" || sp.status === "all" ? sp.status : "open",
    type: ALERT_TYPES.find((x) => x === sp.type) ?? "",
    car: /^\d{1,9}$/.test(sp.car ?? "") ? (sp.car as string) : "",
    q: (sp.q ?? "").trim().slice(0, 80),
    n: Number.isInteger(n) && n > 1 && n < 50 ? n : 1,
  };
  const query = new URLSearchParams({ status: filters.status, limit: String(Math.min(200, filters.n * ALERTS_PER_PAGE)) });
  if (filters.type) query.set("type", filters.type);
  if (filters.car) query.set("car_id", filters.car);
  if (filters.q) query.set("q", filters.q);
  const [list, cars] = await Promise.all([serverGet<AlertPage>(`/admin/alerts?${query}`), serverGet<{ cars: Car[] }>("/admin/cars")]);
  if (list.status === 401) redirect(`/admin/login?next=${encodeURIComponent("/admin/alerts")}&expired=1`);
  if (!list.data) return <OfflineCard />;
  return <AlertsView data={list.data} filters={filters} cars={(cars.data?.cars ?? []).map((c) => ({ id: c.id, car_code: c.car_code }))} />;
}
