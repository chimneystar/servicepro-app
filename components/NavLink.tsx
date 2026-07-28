"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AppIcon, { iconForHref } from "@/components/AppIcon";

export default function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return <Link href={href} className={`side-link${active ? " active" : ""}`}><AppIcon className="nav-icon" name={iconForHref(href)} /><span>{label}</span></Link>;
}
