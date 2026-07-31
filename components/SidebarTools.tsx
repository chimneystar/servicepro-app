"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon, { iconForHref } from "@/components/AppIcon";

export type ToolItem = { href: string; label: string; icon: string };

export default function SidebarTools({ items, label }: { items: ToolItem[]; label: string }) {
  const pathname = usePathname();
  const active = items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const [open, setOpen] = useState(active);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // AUDIT A3. The list has always been inside a scrollable column, but opening
  // it put every destination below the fold of that column and left the
  // viewport where it was, so it read as "the links went nowhere". Bring the
  // newly revealed panel into view — `block: "nearest"` scrolls the sidebar's
  // own scroll port and nothing else, so the page behind does not move.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="tools-wrap">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="tools-trigger"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <AppIcon className="nav-icon" name="tools" /><span>{label}</span><AppIcon className={`nav-icon tools-chevron${open ? " open" : ""}`} name="chevron" />
      </button>
      {open && (
        <div className="tool-list" id={panelId} ref={panelRef}>
          {items.map((item) => {
            const selected = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`tool-link${selected ? " active" : ""}`}
                aria-current={selected ? "page" : undefined}
              >
                <AppIcon className="nav-icon" name={iconForHref(item.href)} />{item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
