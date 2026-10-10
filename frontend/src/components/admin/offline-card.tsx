import { WifiSlashIcon } from "@phosphor-icons/react/ssr";
import { getTranslations } from "next-intl/server";

import { Card } from "@/components/ui/card";

/** The backend did not answer: say so plainly instead of an empty page. */
export async function OfflineCard() {
  const t = await getTranslations("adminAuth");
  return (
    <Card className="flex max-w-lg flex-col items-start gap-3 border-0 p-6 shadow-lift">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-wait-bg text-wait-fg">
        <WifiSlashIcon size={28} weight="duotone" />
      </span>
      <h1 className="font-display text-2xl font-bold text-title">{t("offlineTitle")}</h1>
      <p className="text-muted">{t("offlineBody")}</p>
    </Card>
  );
}
