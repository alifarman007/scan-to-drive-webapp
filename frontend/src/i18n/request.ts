import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { LOCALE_COOKIE, toLocale } from "./locales";

// No /en or /bn in the address: QR links like /c/CAR-01 and /p/<token> must stay short and fixed.
// The language comes from a cookie set by the EN / বাং switch; English is the default.
export default getRequestConfig(async () => {
  const locale = toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return {
    locale,
    timeZone: "Asia/Dhaka",
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
