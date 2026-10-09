import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-gutter text-center">
      <p className="font-mono text-6xl font-semibold text-accent">404</p>
      <Link href="/" className="font-bold text-accent underline-offset-4 hover:underline">
        {t("backHome")}
      </Link>
    </main>
  );
}
