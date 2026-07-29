import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { DEFAULT_LOCALE, dirFor, isLocale, type Locale } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "ServicePro | ניהול עסקי שירות",
  description: "לקוחות, עבודות, צוות וכספים במקום אחד",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ServicePro",
    statusBarStyle: "black-translucent",
  },
};

// App-like behaviour on phones: no accidental pinch/double-tap/focus zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLocale = (await cookies()).get("locale")?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&family=Rubik:wght@600;700;800&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#101a2e" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
