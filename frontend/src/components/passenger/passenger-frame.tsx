import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Passenger pages: a light, calm frame (white bar with the navy logo). Nothing to sign in to. */
export function PassengerFrame({ children }: { children: React.ReactNode }) {
  const t = useTranslations("app");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 px-gutter py-3">
          <Wordmark name={t("name")} tone="onLight" className="dark:hidden" />
          <Wordmark name={t("name")} tone="onDark" className="hidden dark:inline-flex" />
          <LanguageSwitch />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-gutter pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
        <div className="mt-auto flex justify-end pt-4">
          <ThemeToggle />
        </div>
      </main>
    </div>
  );
}
