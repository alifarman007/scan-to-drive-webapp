import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { StyleguideDemo } from "@/components/styleguide/demo";

export const metadata = { title: "Style guide" };

/** Every shared component in one place, for checking the look. Not available in production. */
export default async function StyleguidePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("styleguide");
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-section px-gutter py-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-4xl font-bold text-title">{t("title")}</h1>
        <p className="text-muted">{t("lead")}</p>
      </div>
      <StyleguideDemo />
    </main>
  );
}
