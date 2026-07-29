import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import Link from "next/link";
import CustomerForm from "./CustomerForm";
import CustomerList, { type Cust } from "@/components/CustomerList";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const search = await searchParams;
  await requireProfile();
  const locale = (await getLocale());
  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers").select("id, name, phone, city, address, email, source").is("deleted_at", null).eq("archived", false).order("name", { ascending: true });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 10 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "cust.title")}</h1>
          <p style={{ color: "#5c6675", fontSize: 13 }}>{t(locale, "cust.count", { n: customers?.length ?? 0 })}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link href="/archive" style={{ background: "#fff7ed", color: "#9a3412", borderRadius: 10, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, textDecoration: "none" }}>🗄️ Archive</Link>
          <Link href="/customers/import" style={{ background: "#e2e9f4", color: "#2563eb", borderRadius: 10, padding: "10px 14px", fontWeight: 700, fontSize: 13.5, textDecoration: "none" }}>⬆ Import</Link>
          <CustomerForm locale={locale} initialOpen={search.new === "1"} />
        </div>
      </div>

      <CustomerList customers={(customers ?? []) as Cust[]} emptyText={t(locale, "cust.empty")} />
    </div>
  );
}
