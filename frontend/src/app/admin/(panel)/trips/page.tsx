import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { TripHistory, type FilterOptions } from "@/components/admin/trips/history";
import { OfflineCard } from "@/components/admin/offline-card";
import type { TripPage } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";
import { apiQuery, pageHref, readFilters } from "@/lib/trip-filters";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("trips") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Trip history: the list for the filters in the address, and the choices for the filter bar. */
export default async function TripsPage({ searchParams }: Props) {
  const filters = readFilters(await searchParams);
  const [list, cars, drivers, departments, pending] = await Promise.all([
    serverGet<TripPage>(`/admin/trips?${apiQuery(filters)}`),
    serverGet<{ cars: FilterOptions["cars"] }>("/admin/cars"),
    serverGet<{ drivers: FilterOptions["drivers"] }>("/admin/drivers"),
    serverGet<{ departments: string[] }>("/admin/passengers/departments"),
    serverGet<{ count: number }>("/admin/trips/approvals"),
  ]);
  if (list.status === 401) redirect(`/admin/login?next=${encodeURIComponent(pageHref(filters))}&expired=1`);
  if (!list.data) return <OfflineCard />;

  // a page number past the end (after filtering): go to the last page that has trips
  const lastPage = Math.max(1, Math.ceil(list.data.total / list.data.limit));
  if (filters.page > lastPage) redirect(pageHref({ ...filters, page: lastPage }));

  return (
    <TripHistory
      filters={filters}
      data={list.data}
      options={{
        cars: cars.data?.cars ?? [],
        drivers: drivers.data?.drivers ?? [],
        departments: departments.data?.departments ?? [],
      }}
      pendingApprovals={pending.data?.count ?? 0}
    />
  );
}
