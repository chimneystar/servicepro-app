import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { DEFAULT_LOCALE, dirFor, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "ServicePro",
  description: "Smart service management for field-service businesses",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLocale = cookies().get("locale")?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body>{children}</body>
    </html>
  );
}
