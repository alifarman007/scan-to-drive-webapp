"use client";

import { useTranslations } from "next-intl";

import { StatusChip, type Status } from "@/components/ui/status-chip";
import type { TripStatus } from "@/lib/admin-api";

const COLOUR: Record<TripStatus, Status> = {
  waiting_for_passenger: "waiting",
  in_progress: "on_trip",
  waiting_for_end_confirm: "waiting",
  completed: "available",
  cancelled: "inactive",
  closed_by_admin: "alert",
};

/** A trip's status in the app's status colours: amber waiting, blue driving, green done, grey cancelled, red closed by the office. */
export function TripStatusChip({ status, size = "sm" }: { status: TripStatus; size?: "sm" | "md" }) {
  const t = useTranslations("dashboard.tripStatus");
  return (
    <StatusChip status={COLOUR[status]} size={size} live={status === "in_progress"}>
      {t(status)}
    </StatusChip>
  );
}
