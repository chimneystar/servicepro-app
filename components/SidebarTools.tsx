"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type ToolItem = { href: string; label: string; icon: string };

export default function SidebarTools({ items, label }: { items: ToolItem[]; label: string }) {
  const pathname = usePathname();
  const active = items.some((i) => pathname === i.href || pathname.startsWith(i.href + "/"));
  const [open, setOpen] = useState(active);
  if (!items.length) return null;

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} style={header}>
        <span style={{ fontSize: 18, width: 22, textAlign: "center" }}>🧰</span>
        <span style={{ flex: 1, textAlign: "start" }}>{label}</span>
        <span style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>›</span>
      </button>
      {open && (
        <div style={{ marginInlineStart: 8, borderInlineStart: "1px solid rgba(255,255,255,.12)", paddingInlineStart: 6 }}>
          {items.map((i) => (
            <Link key={i.href} href={i.href} style={{ ...link, background: pathname === i.href ? "rgba(255,255,255,.10)" : "transparent" }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{i.icon}</span>{i.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

const header: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 11, color: "#c6d6f5", background: "transparent", border: "none", width: "100%", fontSize: 14.5, fontWeight: 600, cursor: "pointer", marginBottom: 3 };
const link: React.CSSProperties = { display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 10, color: "#c6d6f5", textDecoration: "none", fontSize: 14, fontWeight: 600, marginBottom: 2 };
