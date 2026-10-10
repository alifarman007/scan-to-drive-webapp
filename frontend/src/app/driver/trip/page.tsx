import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { TripScreen } from "@/components/driver/trip-screen";
import type { ActiveTrip, Trip } from "@/lib/driver-api";
import { getDriverSession, serverGet } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("tripView");
  return { title: t("pageTitle") };
}

/** The driver's open trip (Start QR, driving, end form, End QR, summary). No open trip: back to the driver home. */
export default async function TripPage() {
  const { driver } = await getDriverSession();
  if (!driver) redirect("/driver/login?next=/driver/trip");
  const { data } = await serverGet<ActiveTrip>("/trips/active");
  if (!data?.trip) redirect("/driver");
  return <TripScreen initial={data as ActiveTrip & { trip: Trip }} />;
}
