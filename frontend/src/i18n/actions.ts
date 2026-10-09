"use server";

import { cookies } from "next/headers";

import { LOCALE_COOKIE, toLocale } from "./locales";

/** Remember the chosen language for a year. */
export async function setLocale(locale: string) {
  (await cookies()).set(LOCALE_COOKIE, toLocale(locale), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
