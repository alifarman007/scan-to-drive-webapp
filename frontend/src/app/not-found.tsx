import { ArrowLeftIcon, HouseIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Wordmark } from "@/components/brand";
import { LostRoad } from "@/components/states/lost-road";
import { buttonVariants } from "@/components/ui/button";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  const t = await getTranslations("states");
  return { title: t("notFoundTitle") };
}

/** Wrong or old address: the road ends here. */
export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="flex min-h-dvh flex-col items-center px-gutter pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
      <div className="flex w-full max-w-5xl items-center justify-between gap-3">
        <span>
          <Wordmark name={t("app.name")} tone="onLight" className="dark:hidden" />
          <Wordmark name={t("app.name")} tone="onDark" className="hidden dark:inline-flex" />
        </span>
        <LanguageSwitch />
      </div>
      <div className="flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 text-center">
        <LostRoad />
        <p className="font-mono text-sm font-bold tracking-[0.3em] text-accent">404</p>
        <h1 className="font-display text-3xl font-bold text-title">{t("states.notFoundTitle")}</h1>
        <p className="text-muted">{t("states.notFoundBody")}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link href="/" className={cn(buttonVariants({ size: "lg", lift: true }))}>
            <HouseIcon size={18} weight="bold" />
            {t("states.home")}
          </Link>
          <Link href="/driver" className={cn(buttonVariants({ size: "lg", variant: "secondary" }))}>
            <ArrowLeftIcon size={18} weight="bold" />
            {t("states.driverHome")}
          </Link>
        </div>
      </div>
      <div className="flex w-full max-w-5xl justify-end">
        <ThemeToggle />
      </div>
    </main>
  );
}
