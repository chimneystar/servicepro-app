"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n";

export type Cust = {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  email: string | null;
  source: string | null;
};

const AC = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2"];
function initials(n: string) {
  const p = (n || "?").trim().split(" ");
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}
function colorFor(s: string) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return AC[Math.abs(h) % AC.length];
}

export default function CustomerList({
  customers,
  emptyText,
  locale,
}: {
  customers: Cust[];
  emptyText: string;
  locale: Locale;
}) {
  const he = locale === "he";
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return customers;
    return customers.filter((c) =>
      [c.name, c.phone, c.city, c.address, c.email].some((f) =>
        (f ?? "").toLowerCase().includes(s),
      ),
    );
  }, [q, customers]);

  return (
    <div>
      <div className="customer-search">
        <span aria-hidden="true" className="customer-search-icon">
          🔍
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={he ? "חיפוש לפי שם, כתובת או טלפון…" : "Search by name, address, or phone…"}
          aria-label={he ? "חיפוש לקוחות" : "Search customers"}
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label={he ? "ניקוי החיפוש" : "Clear search"}
            className="customer-search-clear"
          >
            ✕
          </button>
        )}
      </div>
      {q && (
        <div className="customer-search-count" role="status">
          {he
            ? `${filtered.length} תוצאות`
            : `${filtered.length} match${filtered.length === 1 ? "" : "es"}`}
        </div>
      )}

      <div className="rlist">
        {filtered.map((c) => (
          <Link className="ritem" href={`/customers/${c.id}`} key={c.id}>
            <div className="avatar-sm" style={{ background: colorFor(c.name) }} aria-hidden="true">
              <bdi>{initials(c.name)}</bdi>
            </div>
            <div className="rmain">
              <div className="rtitle">{c.name}</div>
              <div className="rsub">
                {c.phone}
                {c.city ? ` · ${c.city}` : ""}
              </div>
            </div>
            {c.source && (
              <span className="pill" style={{ background: "#eef1f6", color: "#57606f" }}>
                {c.source}
              </span>
            )}
            <span aria-hidden="true" style={{ color: "#b6bfcc", fontSize: "1.125rem" }}>
              ›
            </span>
          </Link>
        ))}
        {filtered.length === 0 && (
          <div className="rempty">
            {q
              ? he
                ? "לא נמצאו לקוחות שמתאימים לחיפוש."
                : "No customers match your search."
              : emptyText}
          </div>
        )}
      </div>
    </div>
  );
}
