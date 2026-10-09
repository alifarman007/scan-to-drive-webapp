import { getTranslations } from "next-intl/server";

import { Wordmark } from "@/components/brand";
import { LanguageSwitch } from "@/components/ui/language-switch";
import { ThemeToggle } from "@/components/ui/theme-toggle";

/** Phone layout for driver screens: navy header (logo, language) with the content card pulled up over it. */
export async function DriverFrame({
  header,
  children,
  footer,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const t = await getTranslations("app");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="rounded-b-[2rem] bg-navy px-gutter pt-[max(1.1rem,env(safe-area-inset-top))] pb-16 text-white">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <Wordmark name={t("name")} />
          <LanguageSwitch tone="onDark" />
        </div>
        {header ? <div className="mx-auto mt-7 w-full max-w-md">{header}</div> : null}
      </header>
      <main className="mx-auto -mt-10 flex w-full max-w-md flex-1 flex-col gap-4 px-gutter pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {children}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          {footer ?? <span />}
          <ThemeToggle />
        </div>
      </main>
    </div>
  );
}
