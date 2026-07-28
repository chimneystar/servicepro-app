"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon, { iconForHref } from "@/components/AppIcon";

export type ToolItem = { href: string; label: string; icon: string };

export default function SidebarTools({ items, label }: { items: ToolItem[]; label: string }) {
  const pathname = usePathname();
  const active = items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const [open, setOpen] = useState(active);
  if (!items.length) return null;

  return (
    <div className="tools-wrap">
      <button type="button" onClick={() => setOpen((value) => !value)} className="tools-trigger" aria-expanded={open}>
        <AppIcon className="nav-icon" name="tools" /><span>{label}</span><AppIcon className={`nav-icon tools-chevron${open ? " open" : ""}`} name="chevron" />
      </button>
      {open && <div className="tool-list">{items.map((item) => {
        const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} className={`tool-link${selected ? " active" : ""}`}><AppIcon className="nav-icon" name={iconForHref(item.href)} />{item.label}</Link>;
      })}</div>}
    </div>
  );
}
