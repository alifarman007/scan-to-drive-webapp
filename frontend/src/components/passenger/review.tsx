"use client";

import { CheckIcon, CircleNotchIcon, HeartIcon, LockSimpleIcon, StarIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { BAD_TAGS, GOOD_TAGS, passengerApi, type ReviewTag } from "@/lib/passenger-api";
import { cn } from "@/lib/utils";

import { ErrorText } from "./pieces";

type Phase = "rate" | "sending" | "sent" | "skipped";

/**
 * After the end is confirmed: "How was your ride?" Five stars, then quick tags that fit the stars (what went
 * well, or what could be better), an optional comment, Send or Skip. Only the transport office sees it.
 */
export function ReviewCard({ token, driver }: { token: string; driver: string }) {
  const t = useTranslations("passenger.review");
  const tt = useTranslations("reviewTags");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [tags, setTags] = useState<ReviewTag[]>([]);
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<Phase>("rate");
  const [error, setError] = useState<string | null>(null);

  const good = rating >= 4;
  const offered: readonly ReviewTag[] = rating === 0 ? [] : good ? GOOD_TAGS : BAD_TAGS;
  const shown = hover || rating;

  function rate(n: number) {
    navigator.vibrate?.(10);
    // moving between "went well" and "could be better" swaps the tags, so the old picks go
    if (n >= 4 !== rating >= 4) setTags([]);
    setRating(n);
    setError(null);
  }

  async function send() {
    if (!rating || phase === "sending") return;
    setPhase("sending");
    setError(null);
    try {
      await passengerApi.review({ token, rating, tags, comment: comment.trim() });
      navigator.vibrate?.(30);
      setPhase("sent");
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_REVIEWED") return setPhase("sent");
      setError(err instanceof ApiError && err.code === "REVIEW_LINK_EXPIRED" ? t("expired") : t("failed"));
      setPhase("rate");
    }
  }

  return (
    <Card className="relative overflow-hidden border-0 p-0 text-center shadow-lift">
      <AnimatePresence mode="wait" initial={false}>
        {phase === "sent" ? (
          <Thanks key="sent" rating={rating} />
        ) : phase === "skipped" ? (
          <motion.p
            key="skipped"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-5 py-6 text-sm font-semibold text-muted"
          >
            {t("skipped")}
          </motion.p>
        ) : (
          <motion.div key="rate" exit={{ opacity: 0, scale: 0.98 }} className="flex flex-col items-center gap-4 px-5 pt-6 pb-5">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-xl font-bold text-title">{t("title")}</h2>
              <p className="text-sm text-muted">{t("withDriver", { driver })}</p>
            </div>

            <div
              role="radiogroup"
              aria-label={t("starsLabel")}
              className="flex items-center gap-1"
              onPointerLeave={() => setHover(0)}
            >
              {[1, 2, 3, 4, 5].map((n) => {
                const lit = n <= shown;
                return (
                  <motion.button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={t("stars", { n })}
                    onClick={() => rate(n)}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHover(n)}
                    whileTap={{ scale: 0.82 }}
                    className="relative inline-flex size-12 items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-ring-soft"
                  >
                    <motion.span
                      // a little pop running left to right up to the chosen star
                      key={`${n}-${rating}`}
                      initial={rating && n <= rating ? { scale: 0.6, rotate: -25 } : false}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={{ type: "spring", stiffness: 520, damping: 14, delay: rating ? (n - 1) * 0.045 : 0 }}
                      className={cn("inline-flex transition-colors duration-150", lit ? "text-star" : "text-border-strong")}
                    >
                      <StarIcon size={40} weight={lit ? "fill" : "regular"} />
                    </motion.span>
                  </motion.button>
                );
              })}
            </div>

            <div className="relative h-5 w-full overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.p
                  key={shown}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className={cn("absolute inset-x-0 text-sm font-bold", shown ? "text-title" : "text-muted")}
                >
                  {shown ? t(`word${shown}`) : t("tapAStar")}
                </motion.p>
              </AnimatePresence>
            </div>

            <AnimatePresence initial={false}>
              {rating ? (
                <motion.div
                  key="more"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  // a little room around the content, so the focus ring of the comment box is not cut off
                  className="-mx-1.5 w-[calc(100%+0.75rem)] overflow-hidden"
                >
                  <div className="flex flex-col gap-4 px-1.5 pt-1 pb-1.5">
                    <div className="flex flex-col gap-2.5">
                      <p className="text-xs font-bold tracking-wide text-muted uppercase">{good ? t("wentWell") : t("couldBeBetter")}</p>
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={good ? "good" : "bad"}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.16 }}
                          className="flex flex-wrap justify-center gap-2"
                        >
                          {offered.map((tag) => {
                            const on = tags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setTags((list) => (on ? list.filter((x) => x !== tag) : [...list, tag]))}
                                className={cn(
                                  "inline-flex h-10 items-center gap-1.5 rounded-full border-[1.5px] px-3.5 text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-95",
                                  on ? "border-accent bg-accent text-white" : "border-border-strong bg-card text-title hover:bg-soft",
                                )}
                              >
                                <AnimatePresence initial={false}>
                                  {on ? (
                                    <motion.span
                                      initial={{ width: 0, opacity: 0 }}
                                      animate={{ width: "auto", opacity: 1 }}
                                      exit={{ width: 0, opacity: 0 }}
                                      className="inline-flex overflow-hidden"
                                    >
                                      <CheckIcon size={15} weight="bold" />
                                    </motion.span>
                                  ) : null}
                                </AnimatePresence>
                                {tt(tag)}
                              </button>
                            );
                          })}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                    <textarea
                      rows={2}
                      maxLength={500}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      aria-label={t("commentLabel")}
                      placeholder={t("commentPlaceholder")}
                      className="w-full resize-none rounded-control border-[1.5px] border-border-strong bg-card px-4 py-3 text-left text-base text-text outline-none placeholder:text-muted/70 focus:border-ring focus:shadow-[0_0_0_4px_var(--ring-soft)]"
                    />
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="w-full">
              <ErrorText text={error} />
            </div>

            <div className="grid w-full grid-cols-[1fr_2fr] gap-2">
              <Button variant="ghost" size="lg" onClick={() => setPhase("skipped")} disabled={phase === "sending"}>
                {t("skip")}
              </Button>
              <Button size="lg" lift onClick={() => void send()} disabled={!rating || phase === "sending"} aria-busy={phase === "sending"}>
                {phase === "sending" ? <CircleNotchIcon size={20} className="animate-spin" /> : t("send")}
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <LockSimpleIcon size={13} weight="bold" />
              {t("private")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** The thank-you: the chosen stars fly up and settle around a heart. */
function Thanks({ rating }: { rating: number }) {
  const t = useTranslations("passenger.review");
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center gap-3 bg-gradient-to-b from-star-soft/70 to-transparent px-5 pt-7 pb-6"
    >
      <div className="relative flex size-20 items-center justify-center">
        {Array.from({ length: rating }, (_, i) => {
          const angle = (-90 + (i - (rating - 1) / 2) * 34) * (Math.PI / 180);
          return (
            <motion.span
              key={i}
              className="absolute text-star"
              initial={{ x: 0, y: 30, scale: 0.2, opacity: 0 }}
              animate={{ x: Math.cos(angle) * 46, y: Math.sin(angle) * 46, scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.05 + i * 0.06 }}
            >
              <StarIcon size={18} weight="fill" />
            </motion.span>
          );
        })}
        <motion.span
          className="flex size-16 items-center justify-center rounded-full bg-star text-white shadow-lg"
          initial={{ scale: 0.3, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 14 }}
        >
          <HeartIcon size={30} weight="fill" />
        </motion.span>
      </div>
      <h2 className="font-display text-xl font-bold text-title">{t("thanksTitle")}</h2>
      <p className="max-w-xs text-sm text-muted">{t("thanksBody")}</p>
    </motion.div>
  );
}
