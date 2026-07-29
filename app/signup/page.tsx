import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import SignUpForm from "./SignUpForm";

export default async function SignUpPage() {
  const value = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(value) ? value : DEFAULT_LOCALE;
  return <SignUpForm locale={locale} />;
}
