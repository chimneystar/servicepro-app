import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const c = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(c) ? c : DEFAULT_LOCALE;
  return <LoginForm locale={locale} />;
}
