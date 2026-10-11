import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { DriversList } from "@/components/admin/fleet/drivers";
import { OfflineCard } from "@/components/admin/offline-card";
import type { Driver } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("drivers") };
}

type Props = { searchParams: Promise<{ q?: string; state?: string }> };
const FILTERS = ["on_trip", "free", "inactive"] as const;

export default async function DriversPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { status, data } = await serverGet<{ drivers: Driver[]; next_employee_id: string }>("/admin/drivers");
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent("/admin/drivers")}&expired=1`);
  if (!data) return <OfflineCard />;
  const filter = FILTERS.find((f) => f === sp.state) ?? "";
  return <DriversList drivers={data.drivers} nextId={data.next_employee_id} initialQ={(sp.q ?? "").slice(0, 80)} initialFilter={filter} />;
}
