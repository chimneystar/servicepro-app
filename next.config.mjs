/** @type {import('next').NextConfig} */

// Security response headers. This app serves card-payment and e-signature pages,
// so it must not be framable and must not silently allow injected script hosts.
//
// CSP notes:
//  - 'unsafe-inline' on style-src is required: the app uses inline style={{}}
//    objects extensively. Removing it is Phase 7 work (design-system extraction).
//  - 'unsafe-inline'/'unsafe-eval' on script-src are required by the Next.js
//    dev overlay and by HelcimPay.js, which injects its checkout iframe.
//  - connect-src must include the Supabase project host; it is derived from the
//    public env var so it stays correct across environments.
const supabaseOrigin = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
      : "";
  } catch {
    return "";
  }
})();

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://secure.helcim.app",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} https://api.helcim.com https://secure.helcim.app`.trim(),
  "frame-src 'self' https://secure.helcim.app https://js.stripe.com https://checkout.stripe.com",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(self), payment=(self)",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
