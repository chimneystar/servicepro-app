import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { DEFAULT_LOCALE, dirFor, isLocale, type Locale } from "@/lib/i18n";
import PwaRegistration from "@/components/PwaRegistration";

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

// Keep the app comfortable on phones without blocking accessibility zoom.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("locale")?.value;
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const theme = ["light", "dark", "system"].includes(cookieStore.get("ui_theme")?.value ?? "") ? cookieStore.get("ui_theme")!.value : "system";
  const contrast = cookieStore.get("ui_contrast")?.value === "high" ? "high" : "normal";
  const textScale = cookieStore.get("ui_text_scale")?.value === "large" ? "large" : "normal";
  const reduceMotion = cookieStore.get("ui_reduce_motion")?.value === "true" ? "true" : "false";
  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme} data-contrast={contrast} data-text-scale={textScale} data-reduce-motion={reduceMotion} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800;900&family=Rubik:wght@600;700;800&display=swap" rel="stylesheet" />
        <meta name="theme-color" content="#101a2e" />
      </head>
      <body suppressHydrationWarning><PwaRegistration />{children}</body>
    </html>
  );
}
