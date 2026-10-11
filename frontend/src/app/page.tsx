import {
  ArrowRightIcon,
  ChartLineUpIcon,
  QrCodeIcon,
  SignInIcon,
  SquaresFourIcon,
  SteeringWheelIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Wordmark } from "@/components/brand";
import { ScanVisual } from "@/components/driver/scan-visual";
import { Road } from "@/components/road";
import { Card } from "@/components/ui/card";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { MOTTO } from "@/lib/brand";
import { getAdminSession, getDriverSession } from "@/lib/server-api";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getTranslations("welcome");
  return { title: t("pageTitle") };
}

/**
 * What the bare address shows (for example scantodrive.epicbd.com). Mostly the transport office comes here:
 * one button to sign in. Drivers never need it (the car's QR sticker brings them in and signs them in), and
 * passengers scan the code on the driver's phone. Both get a short line saying so.
 */
export default async function WelcomePage() {
  const t = await getTranslations();
  const [{ admin }, { driver }] = await Promise.all([getAdminSession(), getDriverSession()]);

  const steps = [
    { icon: QrCodeIcon, title: t("welcome.step1Title"), body: t("welcome.step1Body") },
    { icon: UsersThreeIcon, title: t("welcome.step2Title"), body: t("welcome.step2Body") },
    { icon: ChartLineUpIcon, title: t("welcome.step3Title"), body: t("welcome.step3Body") },
  ];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="relative overflow-hidden rounded-b-[2.25rem] bg-navy px-gutter pt-[max(1.25rem,env(safe-area-inset-top))] pb-24 text-white lg:pb-28">
        <Road />
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Wordmark name={t("app.name")} />
          <div className="flex items-center gap-2">
            <LanguageSwitch tone="onDark" />
          </div>
        </div>

        <div className="relative mx-auto mt-12 grid max-w-6xl items-center gap-12 lg:mt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="flex flex-col gap-6">
            <Reveal className="flex flex-col gap-4">
              <p className="text-xs font-bold tracking-[0.16em] text-sky uppercase">{t("welcome.eyebrow")}</p>
              <h1 className="max-w-xl font-display text-4xl leading-[1.08] font-bold sm:text-5xl lg:text-6xl">{t("welcome.title")}</h1>
              <p className="max-w-lg text-lg text-[#c9d3ea]">{t("welcome.lead")}</p>
            </Reveal>
            <Reveal delay={0.12} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={admin ? "/admin" : "/admin/login"}
                className="group inline-flex h-[3.625rem] items-center justify-center gap-3 rounded-2xl bg-white px-7 text-[1.0625rem] font-bold text-navy shadow-[0_14px_30px_-10px_rgb(0_0_0/0.45)] transition-[transform,box-shadow] duration-150 hover:shadow-[0_18px_36px_-10px_rgb(0_0_0/0.5)] active:scale-[0.97]"
              >
                {admin ? <SquaresFourIcon size={22} weight="bold" /> : <SignInIcon size={22} weight="bold" />}
                {admin ? t("welcome.openDashboard") : t("welcome.adminSignIn")}
                <ArrowRightIcon size={18} weight="bold" className="transition-transform group-hover:translate-x-1" />
              </Link>
              {admin ? (
                <span className="text-sm text-[#c9d3ea]">{t("welcome.signedInAs", { name: admin.username })}</span>
              ) : (
                <span className="text-sm text-[#c9d3ea]">{t("welcome.adminHint")}</span>
              )}
            </Reveal>
          </div>

          {/* How a trip works: three stops joined by a moving dashed line */}
          <Stagger className="relative flex flex-col gap-3">
            <svg aria-hidden="true" className="absolute top-10 left-[2.3rem] h-[calc(100%-5rem)] w-1 overflow-visible">
              <line x1="1" y1="0" x2="1" y2="100%" stroke="#9fb4f5" strokeOpacity="0.45" strokeWidth="2" strokeDasharray="8 12" className="road-dash" />
            </svg>
            {steps.map(({ icon: Icon, title, body }, i) => (
              <StaggerItem key={title}>
                <div className="relative flex items-start gap-4 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10 backdrop-blur-sm">
                  <span
                    className={cn(
                      "inline-flex size-11 shrink-0 items-center justify-center rounded-2xl text-white",
                      i === 0 ? "bg-signal" : i === 1 ? "bg-epic" : "bg-[#3b4f9a]",
                    )}
                  >
                    <Icon size={22} weight="duotone" />
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-bold text-sky">{t("welcome.stepLabel", { n: i + 1 })}</span>
                    <span className="font-display text-lg leading-snug font-semibold">{title}</span>
                    <span className="text-sm text-[#c9d3ea]">{body}</span>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </header>

      <main className="relative z-10 -mt-14 px-gutter">
        <div className="mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-2">
          <Reveal delay={0.2}>
            <Card className="flex h-full items-center gap-5 border-0 p-5 shadow-lift sm:p-6">
              <div className="shrink-0">
                <ScanVisual small />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="inline-flex items-center gap-2 text-xs font-bold tracking-wide text-accent uppercase">
                  <SteeringWheelIcon size={16} weight="bold" />
                  {t("welcome.driverEyebrow")}
                </span>
                <h2 className="font-display text-xl font-bold text-title">{t("welcome.driverTitle")}</h2>
                <p className="text-sm text-muted">{t("welcome.driverBody")}</p>
                {driver ? (
                  <Link href="/driver" className="mt-1 inline-flex w-fit items-center gap-1.5 text-sm font-bold text-accent hover:underline">
                    {t("welcome.driverSignedIn", { name: driver.name })}
                    <ArrowRightIcon size={14} weight="bold" />
                  </Link>
                ) : null}
              </div>
            </Card>
          </Reveal>
          <Reveal delay={0.26}>
            <Card className="flex h-full items-center gap-5 border-0 p-5 shadow-lift sm:p-6">
              <span className="inline-flex size-24 shrink-0 items-center justify-center rounded-[1.6rem] bg-soft text-accent">
                <UsersThreeIcon size={46} weight="duotone" />
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="text-xs font-bold tracking-wide text-accent uppercase">{t("welcome.passengerEyebrow")}</span>
                <h2 className="font-display text-xl font-bold text-title">{t("welcome.passengerTitle")}</h2>
                <p className="text-sm text-muted">{t("welcome.passengerBody")}</p>
              </div>
            </Card>
          </Reveal>
        </div>
      </main>

      <footer className="mt-auto px-gutter pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="flex flex-col text-sm">
            <span className="font-display font-semibold text-title italic">{MOTTO}</span>
            <span className="text-xs text-muted">{t("app.company")}</span>
          </p>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
