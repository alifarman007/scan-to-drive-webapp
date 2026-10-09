import { HammerIcon } from "@phosphor-icons/react/ssr";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PAGE_STEP, type NavKey } from "@/components/admin/nav-meta";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";

type Props = { params: Promise<{ section: string }> };

function stepOf(section: string) {
  return PAGE_STEP[section as NavKey];
}

export async function generateMetadata({ params }: Props) {
  const { section } = await params;
  if (!stepOf(section)) return {};
  const t = await getTranslations("nav");
  return { title: t(section as NavKey) };
}

/** Stand-in for admin pages that are not built yet; says which build step brings them. */
export default async function SectionPlaceholder({ params }: Props) {
  const { section } = await params;
  const step = stepOf(section);
  if (!step) notFound();
  const t = await getTranslations();
  return (
    <div className="flex flex-col gap-section">
      <h1 className="font-display text-3xl font-bold text-title">{t(`nav.${section as NavKey}`)}</h1>
      <Reveal>
        <Card className="flex max-w-xl items-start gap-4 p-6">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-soft text-accent">
            <HammerIcon size={24} weight="duotone" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-display text-lg font-semibold text-title">{t("placeholder.title")}</p>
            <p className="text-muted">{t("placeholder.body", { step })}</p>
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
