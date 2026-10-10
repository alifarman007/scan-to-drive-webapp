import { ChartLineUpIcon, CheckCircleIcon, MapPinLineIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { AdminLogin } from "@/components/admin/admin-login";
import { Wordmark } from "@/components/brand";
import { Card } from "@/components/ui/card";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { safeNext } from "@/lib/api";
import { getAdminSession } from "@/lib/server-api";

export async function generateMetadata() {
  const t = await getTranslations("adminAuth");
  return { title: t("pageTitle") };
}

type Props = { searchParams: Promise<{ next?: string; expired?: string }> };

/** Transport office sign-in. Navy brand panel on laptops (on top on phones), the form on the right. */
export default async function AdminLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNext(params.next, "/admin");
  const { admin } = await getAdminSession();
  if (admin) redirect(next.startsWith("/admin") ? next : "/admin");

  const t = await getTranslations();
  const points = [
    { icon: MapPinLineIcon, text: t("adminAuth.point1") },
    { icon: CheckCircleIcon, text: t("adminAuth.point2") },
    { icon: ChartLineUpIcon, text: t("adminAuth.point3") },
  ];

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="relative overflow-hidden bg-navy px-gutter pt-[max(1.25rem,env(safe-area-inset-top))] pb-24 text-white lg:flex lg:flex-col lg:pb-12">
        <Road />
        <div className="relative flex items-center justify-between gap-3">
          <Link href="/" className="rounded-lg">
            <Wordmark name={t("app.name")} />
          </Link>
          <div className="lg:hidden">
            <LanguageSwitch tone="onDark" />
          </div>
        </div>
        <div className="relative mt-10 flex max-w-lg flex-col gap-4 lg:my-auto lg:gap-6">
          <Reveal className="flex flex-col gap-3">
            <p className="text-xs font-bold tracking-[0.16em] text-sky uppercase">{t("adminAuth.eyebrow")}</p>
            <p className="font-display text-3xl leading-tight font-bold lg:text-5xl">{t("adminAuth.hero")}</p>
          </Reveal>
          <Stagger className="hidden flex-col gap-3 lg:flex">
            {points.map(({ icon: Icon, text }) => (
              <StaggerItem key={text}>
                <p className="flex items-center gap-3 text-[#c9d3ea]">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/8 text-sky">
                    <Icon size={20} weight="duotone" />
                  </span>
                  {text}
                </p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
        <p className="relative mt-8 hidden text-xs text-sky lg:block">{t("app.company")}</p>
      </section>

      <section className="relative z-10 -mt-14 flex flex-col px-gutter pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:mt-0 lg:justify-center lg:bg-bg lg:py-12">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 hidden items-center justify-end gap-2 lg:flex">
            <LanguageSwitch />
            <ThemeToggle />
          </div>
          <Reveal delay={0.08}>
            <Card className="border-0 p-6 shadow-lift sm:p-8">
              <AdminLogin next={next} expired={params.expired === "1"} />
            </Card>
          </Reveal>
          <div className="mt-6 flex items-center justify-between gap-3 lg:hidden">
            <Link href="/driver" className="text-sm font-semibold text-accent">
              {t("adminAuth.driverLink")}
            </Link>
            <ThemeToggle />
          </div>
          <p className="mt-6 hidden text-center text-sm lg:block">
            <Link href="/driver" className="font-semibold text-accent">
              {t("adminAuth.driverLink")}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

/** A soft road curve with dashes drifting along it, behind the brand panel. */
function Road() {
  return (
    <svg aria-hidden="true" viewBox="0 0 600 800" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full opacity-60">
      <defs>
        <linearGradient id="road-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#284dae" stopOpacity="0" />
          <stop offset="0.5" stopColor="#284dae" stopOpacity="0.55" />
          <stop offset="1" stopColor="#284dae" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <path d="M640 -40 C 420 160, 560 360, 330 520 S 120 760, -60 860" fill="none" stroke="url(#road-fade)" strokeWidth="120" strokeLinecap="round" />
      <path
        d="M640 -40 C 420 160, 560 360, 330 520 S 120 760, -60 860"
        fill="none"
        stroke="#9fb4f5"
        strokeOpacity="0.55"
        strokeWidth="3"
        strokeDasharray="18 22"
        className="road-dash"
      />
    </svg>
  );
}
