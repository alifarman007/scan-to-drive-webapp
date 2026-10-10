import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { EndFlow } from "@/components/passenger/end-flow";
import { PassengerFrame } from "@/components/passenger/passenger-frame";
import { DeadCode } from "@/components/passenger/pieces";
import { StartFlow } from "@/components/passenger/start-flow";
import type { PassengerPage } from "@/lib/passenger-api";
import { serverGet } from "@/lib/server-api";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("passenger");
  // The address holds a one-time code: keep it out of search engines and out of the Referer header.
  return { title: t("pageTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * Where the one-time QR on the driver's phone leads (/p/<token>). No sign-in for the passenger:
 * the code itself is the key. Start code: confirm the start. End code: confirm the end.
 * A code that cannot be used (expired, used, replaced ...) gets one clear message instead.
 */
export default async function PassengerRoute({ params }: Props) {
  const { token } = await params;
  const { status, data, code } = await serverGet<PassengerPage>(`/p/${encodeURIComponent(token)}`);

  let body: React.ReactNode;
  if (data?.kind === "start") body = <StartFlow token={token} page={data} />;
  else if (data?.kind === "end") body = <EndFlow token={token} page={data} />;
  else body = <DeadCode code={status === 0 || status >= 500 ? "OFFLINE" : (code ?? "QR_INVALID")} />;

  return <PassengerFrame>{body}</PassengerFrame>;
}
