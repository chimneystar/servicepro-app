import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import Link from "next/link";
import CustomerForm from "./CustomerForm";

export const dynamic = "force-dynamic";

const AC = ["#2563eb", "#16a34a", "#d97706", "#7c3aed", "#db2777", "#0891b2"];
function initials(n: string) { const p = (n || "?").trim().split(" "); return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase(); }
function colorFor(s: string) { let h = 0; for (let i = 0; i < (s || "").length; i++) h = s.charCodeAt(i) + ((h << 5) - h); return AC[Math.abs(h) % AC.length]; }

export default async function CustomersPage() {
  await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const { data: customers } = await supabase
    .from("customers").select("id, name, phone, city, email, source").is("deleted_at", null).order("name", { ascending: true });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "cust.title")}</h1>
          <p style={{ color: "#5c6675", fontSize: 13 }}>{t(locale, "cust.count", { n: customers?.length ?? 0 })}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/customers/import" style={{ background: "#e2e9f4", color: "#2563eb", borderRadius: 10, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, textDecoration: "none" }}>⬆ Import</Link>
          <CustomerForm locale={locale} />
        </div>
      </div>

      <div className="rlist">
        {(customers ?? []).map((c) => (
          <Link className="ritem" href={`/customers/${c.id}`} key={c.id}>
            <div className="avatar-sm" style={{ background: colorFor(c.name) }}>{initials(c.name)}</div>
            <div className="rmain">
              <div className="rtitle">{c.name}</div>
              <div className="rsub">{c.phone}{c.city ? ` · ${c.city}` : ""}</div>
            </div>
            {c.source && <span className="pill" style={{ background: "#eef1f6", color: "#57606f" }}>{c.source}</span>}
            <span style={{ color: "#b6bfcc", fontSize: 18 }}>›</span>
          </Link>
        ))}
        {(!customers || customers.length === 0) && <div className="rempty">{t(locale, "cust.empty")}</div>}
      </div>
    </div>
  );
}
