import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n";

/** Current UI locale from the cookie (server components & server actions). */
export async function getLocale(): Promise<Locale> {
  const c = (await cookies()).get("locale")?.value;
  return isLocale(c) ? c : DEFAULT_LOCALE;
}
