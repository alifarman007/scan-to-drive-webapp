import { LockKeyIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { NotFoundCard } from "@/components/admin/fleet/not-found";
import { OfflineCard } from "@/components/admin/offline-card";
import { OldTripsImport, type ImportBatch } from "@/components/admin/office/import-old";
import { getAdminSession, serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("oldImport");
  return { title: t("title") };
}

/** Hidden page (not in the menu, admins only): trips from the old Driver / Passenger Travel Log forms. */
export default async function ImportPage() {
  const { admin, offline } = await getAdminSession();
  if (offline) return <OfflineCard />;
  if (!admin) redirect(`/admin/login?next=${encodeURIComponent("/admin/import")}&expired=1`);
  if (admin.role !== "admin") {
    const t = await getTranslations("oldImport");
    return <NotFoundCard icon={<LockKeyIcon size={28} weight="duotone" />} title={t("adminsOnly")} body={t("adminsOnlyBody")} back={t("toDashboard")} href="/admin" />;
  }
  const { status, data } = await serverGet<{ batches: ImportBatch[] }>("/admin/import/batches");
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent("/admin/import")}&expired=1`);
  if (!data) return <OfflineCard />;
  return <OldTripsImport batches={data.batches} />;
}
