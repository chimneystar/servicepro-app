"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

export default function QuickCreate({
  locale,
  mobile = false,
}: {
  locale: Locale;
  mobile?: boolean;
}) {
  const he = locale === "he";
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const items = [
    {
      href: "/schedule?new=1",
      icon: "▣",
      title: he ? "עבודה חדשה" : "New job",
      copy: he ? "לקוח, שירות ושיבוץ" : "Customer, service and schedule",
    },
    {
      href: "/customers?new=1",
      icon: "◎",
      title: he ? "לקוח חדש" : "New customer",
      copy: he ? "פרטים וכתובת" : "Contact and address",
    },
    {
      href: "/estimates?new=1",
      icon: "◇",
      title: he ? "הצעת מחיר" : "New estimate",
      copy: he ? "שירותים ומחיר" : "Services and pricing",
    },
    {
      href: "/invoices?new=1",
      icon: "▤",
      title: he ? "חשבונית חדשה" : "New invoice",
      copy: he ? "חיוב וגבייה" : "Billing and collection",
    },
  ];

  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    function keyboard(event: KeyboardEvent) {
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        wrap.current?.querySelector<HTMLButtonElement>(".quick-create-trigger")?.focus();
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const links = [...(menu.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [])];
      if (!links.length) return;
      event.preventDefault();
      const index = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? links.length - 1
            : event.key === "ArrowDown"
              ? (index + 1 + links.length) % links.length
              : (index - 1 + links.length) % links.length;
      links[next]?.focus();
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);

  function toggle() {
    setOpen((value) => {
      const next = !value;
      if (next)
        window.setTimeout(() => menu.current?.querySelector<HTMLAnchorElement>("a")?.focus(), 0);
      return next;
    });
  }

  return (
    <div ref={wrap} className={`quick-create ${mobile ? "mobile" : ""}`}>
      <button
        type="button"
        className="quick-create-trigger"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={he ? "יצירה מהירה" : "Quick create"}
      >
        <span aria-hidden="true">+</span>
        {!mobile && (he ? "יצירה" : "Create")}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className="quick-create-menu"
          role="menu"
          aria-label={he ? "יצירה מהירה" : "Quick create"}
        >
          <header>
            <strong>{he ? "מה רוצים ליצור?" : "What are you creating?"}</strong>
            <small>{he ? "מתחילים רק עם הפרטים החשובים" : "Start with only the essentials"}</small>
          </header>
          {items.map((item) => (
            <Link href={item.href} key={item.href} role="menuitem" onClick={() => setOpen(false)}>
              <b aria-hidden="true">{item.icon}</b>
              <span>
                <strong>{item.title}</strong>
                <small>{item.copy}</small>
              </span>
              <i aria-hidden="true">›</i>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
