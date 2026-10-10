import { WifiSlashIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { Card } from "@/components/ui/card";
import { safeNext } from "@/lib/api";
import { getAdminSession } from "@/lib/server-api";

/** Every admin page needs a signed-in admin or viewer. An ended session goes to sign-in and comes back here. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { admin, offline } = await getAdminSession();
  if (!admin) {
    if (offline) return <Offline />;
    const here = safeNext((await headers()).get("x-s2d-path"), "/admin");
    redirect(`/admin/login?next=${encodeURIComponent(here)}&expired=1`);
  }
  return <AdminShell user={admin}>{children}</AdminShell>;
}

async function Offline() {
  const t = await getTranslations("adminAuth");
  return (
    <main className="flex min-h-dvh items-center justify-center px-gutter">
      <Card className="flex max-w-md flex-col items-start gap-3 border-0 p-6 shadow-lift">
        <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-wait-bg text-wait-fg">
          <WifiSlashIcon size={28} weight="duotone" />
        </span>
        <h1 className="font-display text-2xl font-bold text-title">{t("offlineTitle")}</h1>
        <p className="text-muted">{t("offlineBody")}</p>
      </Card>
    </main>
  );
}
