import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";

import { Card } from "@/components/ui/card";

/** A car or driver that does not exist (wrong link). */
export function NotFoundCard({ icon, title, body, back, href }: { icon: React.ReactNode; title: string; body: string; back: string; href: string }) {
  return (
    <Card className="flex max-w-lg flex-col items-start gap-3 border-0 p-6 shadow-lift">
      <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-soft text-accent">{icon}</span>
      <h1 className="font-display text-2xl font-bold text-title">{title}</h1>
      <p className="text-muted">{body}</p>
      <Link href={href} className="mt-1 inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:underline">
        <ArrowLeftIcon size={15} weight="bold" />
        {back}
      </Link>
    </Card>
  );
}
