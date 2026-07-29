import type { SVGProps } from "react";

export type AppIconName =
  | "dashboard" | "calendar" | "briefcase" | "target" | "customers"
  | "messages" | "document" | "invoice" | "reports" | "settings"
  | "route" | "recurring" | "inventory" | "book" | "tools"
  | "search" | "chevron" | "team" | "payments";

export function iconForHref(href: string): AppIconName {
  if (href === "/") return "dashboard";
  if (href.startsWith("/schedule")) return "calendar";
  if (href.startsWith("/jobs")) return "briefcase";
  if (href.startsWith("/leads")) return "target";
  if (href.startsWith("/customers")) return "customers";
  if (href.startsWith("/messages")) return "messages";
  if (href.startsWith("/estimates")) return "document";
  if (href.startsWith("/invoices")) return "invoice";
  if (href.startsWith("/reports")) return "reports";
  if (href.startsWith("/settings/payments")) return "payments";
  if (href.startsWith("/settings")) return "settings";
  if (href.startsWith("/route")) return "route";
  if (href.startsWith("/recurring")) return "recurring";
  if (href.startsWith("/inventory")) return "inventory";
  if (href.startsWith("/pricebook")) return "book";
  if (href.startsWith("/team")) return "team";
  return "briefcase";
}

export default function AppIcon({ name, ...props }: { name: AppIconName } & SVGProps<SVGSVGElement>) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common} {...props}>
      {name === "dashboard" && <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>}
      {name === "calendar" && <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></>}
      {name === "briefcase" && <><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></>}
      {name === "target" && <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m15 9 6-6M17 3h4v4"/></>}
      {name === "customers" && <><path d="M16 20v-1.5A4.5 4.5 0 0 0 11.5 14h-5A4.5 4.5 0 0 0 2 18.5V20"/><circle cx="9" cy="7" r="4"/><path d="M17 11a3.5 3.5 0 1 0 0-7M22 20v-1.5a4.5 4.5 0 0 0-3-4.24"/></>}
      {name === "messages" && <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></>}
      {name === "document" && <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>}
      {name === "invoice" && <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h4"/></>}
      {name === "reports" && <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/><path d="m4 7 6-4 6 7 5-5"/></>}
      {name === "settings" && <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3v-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.5 1h.1v4h-.09a1.7 1.7 0 0 0-1.51 1z"/></>}
      {name === "route" && <><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h3a3 3 0 0 0 3-3V8a3 3 0 0 1 3-3"/></>}
      {name === "recurring" && <><path d="M20 7h-5V2M4 17h5v5"/><path d="M19 12a7 7 0 0 0-12-5L4 10M5 12a7 7 0 0 0 12 5l3-3"/></>}
      {name === "inventory" && <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 8 9 5 9-5v8l-9 5-9-5zM12 13v8"/></>}
      {name === "book" && <><path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 3z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 3z"/></>}
      {name === "tools" && <><path d="m14.7 6.3 3-3a4 4 0 0 1-5 5l-7.9 7.9a2 2 0 1 0 2.8 2.8l7.9-7.9a4 4 0 0 1 5-5l-3 3z"/></>}
      {name === "search" && <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>}
      {name === "chevron" && <path d="m9 18 6-6-6-6"/>}
      {name === "team" && <><circle cx="9" cy="8" r="4"/><path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M16 4a4 4 0 0 1 0 8M18 14a5 5 0 0 1 4 5v2"/></>}
      {name === "payments" && <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3M16 14v2M15 15h2"/></>}
    </svg>
  );
}
