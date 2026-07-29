import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import ResetPasswordForm from "./ResetPasswordForm";

export default async function ResetPasswordPage() {
  const value = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return <ResetPasswordForm locale={locale} />;
}
