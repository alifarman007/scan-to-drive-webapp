import { ArrowLeftIcon, MagnifyingGlassIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cache } from "react";

import { OfflineCard } from "@/components/admin/offline-card";
import { TripDetailView } from "@/components/admin/trips/detail";
import { Card } from "@/components/ui/card";
import type { TripDetail } from "@/lib/admin-api";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ id: string }> };

// one backend call for the title and the page
const load = cache(async (id: string) => {
  if (!/^\d{1,9}$/.test(id)) return { status: 404, data: null };
  return serverGet<TripDetail>(`/admin/trips/${id}`);
});

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const { data } = await load(id);
  const t = await getTranslations("nav");
  return { title: data ? data.trip.trip_no : t("trips") };
}

/** One trip. Photo links in the reply last 10 minutes; the page asks again when one has run out. */
export default async function TripPage({ params }: Props) {
  const { id } = await params;
  const { status, data } = await load(id);
  if (status === 401) redirect(`/admin/login?next=${encodeURIComponent(`/admin/trips/${id}`)}&expired=1`);
  if (status === 404) return <NotFound />;
  if (!data) return <OfflineCard />;
  return <TripDetailView data={data} />;
}

async function NotFound() {
  const t = await getTranslations("tripDetail");
  return (
    <Card className="flex max-w-lg flex-col items-start gap-3 border-0 p-6 shadow-lift">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-soft text-accent">
        <MagnifyingGlassIcon size={28} weight="duotone" />
      </span>
      <h1 className="font-display text-2xl font-bold text-title">{t("notFoundTitle")}</h1>
      <p className="text-muted">{t("notFoundBody")}</p>
      <Link href="/admin/trips" className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:underline">
        <ArrowLeftIcon size={15} weight="bold" />
        {t("back")}
      </Link>
    </Card>
  );
}
