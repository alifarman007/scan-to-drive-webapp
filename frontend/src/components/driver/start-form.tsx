"use client";

import { CircleNotchIcon, UserIcon, UserMinusIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/input";
import { Stagger, StaggerItem } from "@/components/ui/reveal";
import { ApiError } from "@/lib/api";
import { driverApi, saveQr, type CarPage } from "@/lib/driver-api";
import { useGeolocation } from "@/lib/hooks";
import { cn } from "@/lib/utils";

import { LocationField } from "./location-field";
import { PhotoField } from "./photo-field";
import { tripErrorKey } from "./trip-errors";

const RECENT_KEY = "s2d.recentDestinations";
const noSubscribe = () => () => {};

function readRecent(): string {
  try {
    return localStorage.getItem(RECENT_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function rememberDestination(place: string) {
  try {
    const list = (JSON.parse(readRecent()) as string[]).filter((p) => p.toLowerCase() !== place.toLowerCase());
    localStorage.setItem(RECENT_KEY, JSON.stringify([place, ...list].slice(0, 4)));
  } catch {
    /* only a convenience */
  }
}

type Missing = Partial<Record<"km" | "start" | "destination" | "purpose" | "photo", true>>;

/** The start form on the car page (PDF 6.2 D2-D3): km, places, passenger or not, purpose, live dashboard photo. */
export function StartForm({ page }: { page: CarPage }) {
  const t = useTranslations("tripForm");
  const te = useTranslations("tripErrors");
  const router = useRouter();
  const { car } = page;
  const { geo, retry } = useGeolocation();

  const [km, setKm] = useState(String(car.last_end_km));
  const [startPlace, setStartPlace] = useState(car.last_end_place ?? "");
  const [destination, setDestination] = useState("");
  const [withPassenger, setWithPassenger] = useState(true);
  const [purpose, setPurpose] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [purposes, setPurposes] = useState<string[]>([]);
  const [missing, setMissing] = useState<Missing>({});
  const [error, setError] = useState<string | null>(null); // from the server
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  function touch(field: keyof Missing) {
    setMissing((m) => ({ ...m, [field]: undefined }));
    setError(null);
  }

  const recentRaw = useSyncExternalStore(noSubscribe, readRecent, () => "[]");
  const recent = safeList(recentRaw);

  useEffect(() => {
    let alive = true;
    driverApi
      .purposes()
      .then((r) => alive && setPurposes(r.purposes))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const kmNum = /^\d{1,7}$/.test(km.trim()) ? Number(km.trim()) : NaN;
  const kmTooLow = Number.isFinite(kmNum) && kmNum < car.last_end_km;
  const kmGap = Number.isFinite(kmNum) ? kmNum - car.last_end_km : 0;
  const kmWarn = !kmTooLow && kmGap > page.km_gap_limit_km;

  // the "fill in the marked fields" note goes away as soon as nothing is marked any more
  const message = error ?? (attempted && Object.values(missing).some(Boolean) ? t("fixHighlighted") : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const miss: Missing = {};
    if (!Number.isFinite(kmNum) || kmTooLow) miss.km = true;
    if (!startPlace.trim()) miss.start = true;
    if (!destination.trim()) miss.destination = true;
    if (!withPassenger && !purpose.trim()) miss.purpose = true;
    if (!photo) miss.photo = true;
    setMissing(miss);
    setAttempted(true);
    if (Object.keys(miss).length) {
      const first = ["km", "start", "destination", "purpose", "photo"].find((k) => miss[k as keyof Missing]);
      document.getElementById(`f-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const form = new FormData();
    form.set("car_code", car.car_code);
    form.set("qr_version", String(car.qr_version));
    form.set("start_km", String(kmNum));
    form.set("start_place", startPlace.trim());
    form.set("destination", destination.trim());
    form.set("with_passenger", withPassenger ? "true" : "false");
    if (purpose.trim()) form.set("purpose", purpose.trim());
    if (geo.status === "ok") {
      form.set("start_lat", String(geo.lat));
      form.set("start_lng", String(geo.lng));
    }
    form.set("photo", photo!, "dashboard-start.jpg");

    setBusy(true);
    setError(null);
    try {
      const res = await driverApi.start(form);
      rememberDestination(destination.trim());
      if (res.start_qr) saveQr(res.trip.id, "start", res.start_qr);
      navigator.vibrate?.(30);
      router.replace("/driver/trip");
      router.refresh();
    } catch (err) {
      setBusy(false);
      const key = tripErrorKey(err);
      if (key === "START_KM_TOO_LOW") setMissing({ km: true });
      if (key === "PURPOSE_REQUIRED") setMissing({ purpose: true });
      if (key === "PHOTO_TOO_LARGE" || key === "INVALID_PHOTO") setMissing({ photo: true });
      if (key === "DRIVER_HAS_OPEN_TRIP" || key === "OPEN_TRIP_EXISTS" || key === "CAR_IN_USE") router.refresh();
      setError(te(key, { km: car.last_end_km, detail: err instanceof ApiError ? err.message : "" }));
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Stagger className="flex flex-col gap-4">
        <StaggerItem>
          <Section>
            <Field
              label={t("startKm")}
              htmlFor="f-km"
              error={kmTooLow ? t("kmTooLow", { km: car.last_end_km.toLocaleString("en-US") }) : missing.km ? t("kmRequired") : undefined}
              hint={!kmTooLow && !missing.km && !kmWarn ? t("kmHint", { km: car.last_end_km.toLocaleString("en-US") }) : undefined}
            >
              <Input
                id="f-km"
                mono
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={7}
                value={km}
                onChange={(e) => {
                  setKm(e.target.value.replace(/\D/g, ""));
                  touch("km");
                }}
                invalid={kmTooLow || missing.km}
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
            <AnimatePresence initial={false}>
              {kmWarn ? (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-start gap-2 overflow-hidden rounded-xl bg-wait-bg px-3 py-2.5 text-sm font-medium text-wait-fg"
                >
                  <WarningIcon size={18} weight="fill" className="mt-px shrink-0" />
                  {t("kmGapWarn", { gap: kmGap.toLocaleString("en-US") })}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section>
            <LocationField
              id="f-start"
              label={t("startPlace")}
              value={startPlace}
              onChange={(v) => {
                setStartPlace(v);
                touch("start");
              }}
              geo={geo}
              onRetry={retry}
              placeholder={t("startPlacePlaceholder")}
              invalid={missing.start}
            />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-destination">{t("destination")}</Label>
              <Input
                id="f-destination"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value);
                  touch("destination");
                }}
                placeholder={t("destinationPlaceholder")}
                invalid={missing.destination}
                maxLength={255}
              />
              {recent.length ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {recent.map((p) => (
                    <Chip key={p} active={destination === p} onClick={() => setDestination(p)}>
                      {p}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-text">{t("passengerQuestion")}</span>
              <div role="radiogroup" aria-label={t("passengerQuestion")} className="grid grid-cols-2 gap-1 rounded-control bg-soft p-1">
                {[
                  { v: true, label: t("withPassenger"), Icon: UserIcon },
                  { v: false, label: t("noPassenger"), Icon: UserMinusIcon },
                ].map(({ v, label, Icon }) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={withPassenger === v}
                    onClick={() => {
                      setWithPassenger(v);
                      touch("purpose");
                    }}
                    className={cn(
                      "relative flex h-12 items-center justify-center gap-2 rounded-[0.7rem] text-sm font-bold transition-colors",
                      withPassenger === v ? "text-title" : "text-muted",
                    )}
                  >
                    {withPassenger === v ? (
                      <motion.span layoutId="passenger-pill" className="absolute inset-0 rounded-[0.7rem] bg-card shadow-sm" />
                    ) : null}
                    <Icon size={18} weight={withPassenger === v ? "fill" : "regular"} className="relative" />
                    <span className="relative">{label}</span>
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted">{withPassenger ? t("withPassengerHint") : t("noPassengerHint")}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="f-purpose">
                {t("purpose")}{" "}
                <span className="font-medium text-muted">{withPassenger ? t("optional") : t("required")}</span>
              </Label>
              {purposes.length ? (
                <div className="flex flex-wrap gap-2 pb-1">
                  {purposes.map((p) => (
                    <Chip
                      key={p}
                      active={purpose === p}
                      onClick={() => {
                        setPurpose(purpose === p ? "" : p);
                        touch("purpose");
                      }}
                    >
                      {p}
                    </Chip>
                  ))}
                </div>
              ) : null}
              <Input
                id="f-purpose"
                value={purpose}
                onChange={(e) => {
                  setPurpose(e.target.value);
                  touch("purpose");
                }}
                placeholder={t("purposePlaceholder")}
                invalid={missing.purpose}
                maxLength={500}
              />
              {missing.purpose ? <p className="text-sm font-medium text-bad-fg">{t("purposeRequired")}</p> : null}
            </div>
          </Section>
        </StaggerItem>

        <StaggerItem>
          <Section>
            <PhotoField
              id="f-photo"
              label={t("photoStart")}
              hint={t("photoHint")}
              value={photo}
              onChange={(p) => {
                setPhoto(p);
                touch("photo");
              }}
              invalid={missing.photo}
            />
          </Section>
        </StaggerItem>
      </Stagger>

      <AnimatePresence initial={false}>
        {message ? (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-start gap-2 rounded-xl bg-bad-bg px-3.5 py-3 text-sm font-semibold text-bad-fg"
          >
            <WarningCircleIcon size={18} weight="fill" className="mt-px shrink-0" />
            {message}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="sticky bottom-0 z-10 -mx-gutter bg-gradient-to-t from-bg via-bg to-transparent px-gutter pt-6 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="submit" size="xl" lift disabled={busy} aria-busy={busy}>
          {busy ? (
            <>
              <CircleNotchIcon size={22} className="animate-spin" />
              {t("starting")}
            </>
          ) : withPassenger ? (
            t("startWithQr")
          ) : (
            t("startNoPassenger")
          )}
        </Button>
      </div>
    </form>
  );
}

function safeList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 rounded-card bg-card p-4 shadow-[0_1px_2px_rgb(15_26_61/0.06)] sm:p-5">{children}</div>;
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 max-w-full truncate rounded-full border-[1.5px] px-3.5 text-[0.82rem] font-bold transition-[background-color,border-color,color,transform] active:scale-95",
        active ? "border-accent bg-soft text-title" : "border-border-strong bg-card text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
