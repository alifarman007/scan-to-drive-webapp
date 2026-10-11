import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { UsersView } from "@/components/admin/office/users";
import { OfflineCard } from "@/components/admin/offline-card";
import type { AdminAccount } from "@/lib/admin-api";
import { getAdminSession, serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("nav");
  return { title: t("users") };
}

/** Accounts (admins only) and "my account" (everyone: change my own password). */
export default async function UsersPage() {
  const { admin, offline } = await getAdminSession();
  if (offline) return <OfflineCard />;
  if (!admin) redirect(`/admin/login?next=${encodeURIComponent("/admin/users")}&expired=1`);
  if (admin.role !== "admin") return <UsersView accounts={null} />;
  const { status, data } = await serverGet<{ items: AdminAccount[] }>("/admin/users");
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent("/admin/users")}&expired=1`);
  if (!data) return <OfflineCard />;
  return <UsersView accounts={data.items} />;
}
