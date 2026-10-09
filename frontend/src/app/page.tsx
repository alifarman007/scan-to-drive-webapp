import { ArrowRightIcon, QrCodeIcon, SquaresFourIcon, SteeringWheelIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Odometer } from "@/components/ui/odometer";
import { Reveal } from "@/components/ui/reveal";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Start page: pick driver or transport office. Passengers never land here; they come in through a QR. */
export default async function HomePage() {
  const t = await getTranslations();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="rounded-b-4xl bg-navy px-gutter pt-5 pb-20 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <Wordmark name={t("app.name")} company={t("app.company")} />
          <LanguageSwitch tone="onDark" />
        </div>
        <div className="mx-auto mt-10 grid max-w-5xl items-end gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
          <Reveal className="flex flex-col gap-3">
            <p className="text-xs font-bold tracking-[0.14em] text-sky uppercase">{t("home.eyebrow")}</p>
            <h1 className="max-w-xl font-display text-5xl font-bold">{t("home.title")}</h1>
            <p className="max-w-lg text-lg text-[#c9d3ea]">{t("home.lead")}</p>
          </Reveal>
          <Reveal delay={0.15} className="hidden md:block">
            <Odometer value={45230} size="lg" unit={t("common.km")} />
          </Reveal>
        </div>
      </header>

      <main className="mx-auto -mt-12 grid w-full max-w-5xl gap-4 px-gutter sm:grid-cols-2">
        <Reveal delay={0.1}>
          <Link
            href="/driver"
            className="group flex h-full items-center gap-4 rounded-panel bg-card p-5 shadow-lift transition-transform active:scale-[0.98]"
          >
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-epic text-white">
              <SteeringWheelIcon size={28} weight="duotone" />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="font-display text-xl font-semibold text-title">{t("home.driver")}</span>
              <span className="text-sm text-muted">{t("home.driverHint")}</span>
            </span>
            <ArrowRightIcon size={22} className="text-accent transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>
        <Reveal delay={0.18}>
          <Link
            href="/admin"
            className="group flex h-full items-center gap-4 rounded-panel bg-card p-5 shadow-lift transition-transform active:scale-[0.98]"
          >
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-navy text-white">
              <SquaresFourIcon size={28} weight="duotone" />
            </span>
            <span className="flex flex-1 flex-col">
              <span className="font-display text-xl font-semibold text-title">{t("home.admin")}</span>
              <span className="text-sm text-muted">{t("home.adminHint")}</span>
            </span>
            <ArrowRightIcon size={22} className="text-accent transition-transform group-hover:translate-x-1" />
          </Link>
        </Reveal>
        <Reveal delay={0.26} className="sm:col-span-2">
          <p className="flex items-center gap-3 rounded-card bg-soft px-4 py-3.5 text-sm text-title">
            <QrCodeIcon size={22} weight="duotone" className="shrink-0 text-accent" />
            {t("home.passengerNote")}
          </p>
        </Reveal>
      </main>

      <footer className="mx-auto mt-auto flex w-full max-w-5xl justify-end px-gutter py-6">
        <ThemeToggle />
      </footer>
    </div>
  );
}
