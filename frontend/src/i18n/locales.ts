export const LOCALES = ["en", "bn"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Cookie that remembers the chosen language (one year). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function toLocale(value: string | undefined | null): Locale {
  return value === "bn" ? "bn" : DEFAULT_LOCALE;
}
