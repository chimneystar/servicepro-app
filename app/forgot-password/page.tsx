import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import RecoveryForm from "./RecoveryForm";

export default async function ForgotPasswordPage() {
  const value = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return <RecoveryForm locale={locale} />;
}
