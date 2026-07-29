"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppIcon from "@/components/AppIcon";
import type { Locale } from "@/lib/i18n";
import QuickCreate from "@/components/QuickCreate";

export default function TopBar({ canManage, locale }: { canManage: boolean; locale: Locale }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const he = locale === "he";
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const search = query.trim();
    if (search) router.push(`/search?q=${encodeURIComponent(search)}`);
  }

  return (
    <div className="topbar">
      <form onSubmit={submit} className="top-search" role="search">
        <AppIcon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={he ? "חיפוש לקוח, עבודה, חשבונית או הצעת מחיר…" : "Search customers, jobs, invoices or estimates…"} aria-label={he ? "חיפוש" : "Search"} />
      </form>
      <div className="top-actions">
        {canManage && <QuickCreate locale={locale} />}
        {canManage && <Link href="/messages" title={he ? "הודעות" : "Messages"} className="top-icon"><AppIcon name="messages" /></Link>}
        {canManage && <Link href="/settings" title={he ? "הגדרות" : "Settings"} className="top-icon"><AppIcon name="settings" /></Link>}
      </div>
    </div>
  );
}
