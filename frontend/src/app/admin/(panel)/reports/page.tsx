import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { OfflineCard } from "@/components/admin/offline-card";
import { Reports, type ReportOptions } from "@/components/admin/reports/reports";
import type { ReportData } from "@/lib/admin-api";
import { readReportFilters, reportHref, reportQuery } from "@/lib/report-filters";
import { serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("reports") };
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Reports: the chosen report for the filters in the address, and the choices for the filter bar. */
export default async function ReportsPage({ searchParams }: Props) {
  const filters = readReportFilters(await searchParams);
  const [report, cars, drivers, departments] = await Promise.all([
    serverGet<ReportData>(`/admin/reports/${filters.r}?${reportQuery(filters)}`),
    serverGet<{ cars: ReportOptions["cars"] }>("/admin/cars"),
    serverGet<{ drivers: ReportOptions["drivers"] }>("/admin/drivers"),
    serverGet<{ departments: string[] }>("/admin/passengers/departments"),
  ]);
  if (report.status === 401) redirect(`/admin/login?next=${encodeURIComponent(reportHref(filters))}&expired=1`);
  // dates the other way round (typed into the address): back to this month
  if (report.status === 422) redirect(reportHref({ ...filters, range: "month", from: "", to: "" }));
  if (!report.data) return <OfflineCard />;

  return (
    <Reports
      filters={filters}
      data={report.data}
      options={{
        cars: cars.data?.cars ?? [],
        drivers: drivers.data?.drivers ?? [],
        departments: departments.data?.departments ?? [],
      }}
    />
  );
}
