import { cn } from "@/lib/utils";

import { LiveDot } from "./live-dot";

export type Status = "available" | "on_trip" | "waiting" | "alert" | "maintenance" | "inactive";

// One colour per meaning, on every screen: green free, blue moving, amber waiting, red problem, grey off.
const STYLES: Record<Status, { chip: string; dot: string }> = {
  available: { chip: "bg-ok-bg text-ok-fg", dot: "bg-ok-dot" },
  on_trip: { chip: "bg-trip-bg text-trip-fg", dot: "bg-trip-dot" },
  waiting: { chip: "bg-wait-bg text-wait-fg", dot: "bg-wait-dot" },
  alert: { chip: "bg-bad-bg text-bad-fg", dot: "bg-bad-dot" },
  maintenance: { chip: "bg-off-bg text-off-fg", dot: "bg-off-dot" },
  inactive: { chip: "bg-off-bg text-off-fg", dot: "bg-off-dot" },
};

export function statusDotClass(status: Status) {
  return STYLES[status].dot;
}

export function StatusChip({
  status,
  children,
  live,
  size = "md",
  className,
}: {
  status: Status;
  children: React.ReactNode;
  /** Pulse the dot (a car that is moving right now). */
  live?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const s = STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-bold whitespace-nowrap",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        s.chip,
        className,
      )}
    >
      {live ? <LiveDot className={s.dot} /> : <span className={cn("size-2 rounded-full", s.dot)} />}
      {children}
    </span>
  );
}
