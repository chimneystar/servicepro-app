"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon, { iconForHref } from "@/components/AppIcon";

export default function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  const ref = useRef<HTMLAnchorElement | null>(null);

  // The sidebar scrolls on a laptop (audit A3). If the page you are on is one of
  // the rows below the fold, show it — otherwise the nav opens looking like it
  // has no idea where you are. `block: "nearest"` moves the sidebar's own scroll
  // port only, so the page behind it does not jump.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Link ref={ref} href={href} className={`side-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <AppIcon className="nav-icon" name={iconForHref(href)} /><span>{label}</span>
    </Link>
  );
}
