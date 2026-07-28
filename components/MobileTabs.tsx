"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function MobileTabs({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mobile-tabs">
      {items.map((i) => {
        const on = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={on ? "on" : ""}>
            <span className="ic">{i.icon}</span>
            <span>{i.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
