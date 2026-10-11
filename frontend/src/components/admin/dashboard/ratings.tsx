"use client";

import { ChatCircleTextIcon, StarIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";

import { Stars } from "@/components/admin/stars";
import { Card } from "@/components/ui/card";
import type { Dashboard } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

import { PanelTitle } from "./bits";

/**
 * What passengers think: this month's average with how the stars spread, and the latest few ratings
 * (stars, tags, comment) with a link to the trip.
 */
export function RatingsPanel({ ratings, asOf }: { ratings: Dashboard["ratings"]; asOf: string }) {
  const t = useTranslations("dashboard.ratings");
  const tt = useTranslations("reviewTags");
  const format = useFormatter();
  const avg = ratings.average_this_month;
  const most = Math.max(1, ...ratings.stars_this_month);

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4 sm:p-5">
      <PanelTitle title={t("title")} hint={t("hint")} />

      {ratings.count_this_month === 0 && ratings.recent.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl bg-star-soft/45 px-4 py-7 text-center">
          <StarIcon size={34} weight="duotone" className="text-star" />
          <p className="font-semibold text-title">{t("emptyTitle")}</p>
          <p className="text-sm text-muted">{t("emptyBody")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-5">
            <div className="flex flex-col items-start gap-1">
              <span className="font-display text-4xl leading-none font-bold text-title tabular-nums">
                {avg === null ? "–" : format.number(avg, { minimumFractionDigits: 1, maximumFractionDigits: 1, numberingSystem: "latn" })}
              </span>
              {avg !== null ? <Stars value={avg} size={15} label={t("average", { avg })} /> : null}
              <span className="text-xs text-muted">{t("count", { count: ratings.count_this_month })}</span>
            </div>
            <ul className="flex flex-col gap-1" aria-label={t("spread")}>
              {[5, 4, 3, 2, 1].map((n, i) => {
                const count = ratings.stars_this_month[n - 1] ?? 0;
                return (
                  <li key={n} className="grid grid-cols-[1.4rem_minmax(0,1fr)_1.5rem] items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-0.5 font-semibold text-muted tabular-nums">
                      {n}
                      <StarIcon size={10} weight="fill" className="text-star" />
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-bay">
                      <motion.span
                        className={cn("block h-full rounded-full", n >= 4 ? "bg-star" : n === 3 ? "bg-wait-dot/70" : "bg-bad-dot/70")}
                        initial={{ width: 0 }}
                        animate={{ width: `${(count / most) * 100}%` }}
                        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.1 + i * 0.05 }}
                      />
                    </span>
                    <span className="text-right font-semibold text-muted tabular-nums">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {ratings.recent.length ? (
            <ul className="flex flex-col divide-y divide-border border-t border-border">
              {ratings.recent.map((r) => (
                <li key={r.trip_id}>
                  <Link href={`/admin/trips/${r.trip_id}`} className="group flex flex-col gap-1.5 py-3 outline-none">
                    <span className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <Stars value={r.rating} size={13} />
                        <span className="truncate text-sm font-semibold text-title group-hover:underline">{r.driver_name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{format.relativeTime(new Date(r.at), new Date(asOf))}</span>
                    </span>
                    {r.tags.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.tags.map((tag) => (
                          <span
                            key={tag}
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                              r.rating >= 4 ? "bg-ok-bg text-ok-fg" : "bg-bad-bg text-bad-fg",
                            )}
                          >
                            {tt(tag)}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {r.comment ? (
                      <span className="flex items-start gap-1.5 text-sm text-text">
                        <ChatCircleTextIcon size={15} weight="duotone" className="mt-0.5 shrink-0 text-muted" />
                        <span className="line-clamp-2">{r.comment}</span>
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Card>
  );
}
