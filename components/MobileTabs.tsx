"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon, { iconForHref } from "@/components/AppIcon";

export default function MobileTabs({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mobile-tabs">
      {items.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
        return <Link key={item.href} href={item.href} className={active ? "on" : ""} aria-current={active ? "page" : undefined}><span className="ic" aria-hidden="true">{item.href === "/more" ? "•••" : <AppIcon name={iconForHref(item.href)} />}</span><span>{item.label}</span></Link>;
      })}
    </nav>
  );
}
