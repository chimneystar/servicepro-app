import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ServicePro — ניהול העסק",
    template: "%s | ServicePro",
  },
  description: "לקוחות, עבודות וכספים במקום אחד.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/mark.svg", apple: "/mark.svg" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ServicePro" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#101a2e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
