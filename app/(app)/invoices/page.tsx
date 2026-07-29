import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { money } from "@/lib/format";
import DocForm from "@/components/DocForm";
import { createInvoice } from "./actions";
import DocList from "@/components/DocList";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string; new?: string }> }) {
  const search = await searchParams;
  const profile = await requireProfile();
  const locale = (await getLocale());
  const supabase = await createClient();
  const filter = search.filter ?? "all";

  const [{ data: invoices }, { data: customers }, { data: org }, { data: catalog }] = await Promise.all([
    supabase.from("invoices").select("id, number, status, total_minor, issue_date, public_token, customers(name, email, phone)").is("deleted_at", null).eq("archived", false).order("number", { ascending: false }),
    supabase.from("customers").select("id, name").is("deleted_at", null).eq("archived", false).order("name"),
    supabase.from("organizations").select("currency, name").single(),
    supabase.from("price_book").select("id, name, description, price_minor, cost_minor, taxable, image_path").order("name"),
  ]);
  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));
  const cur = org?.currency ?? "USD";
  const all = invoices ?? [];

  // Due vs paid totals
  const outstanding = all.filter((i) => i.status === "unpaid").reduce((s, i) => s + i.total_minor, 0);
  const collected = all.filter((i) => i.status === "paid").reduce((s, i) => s + i.total_minor, 0);
  const dueCount = all.filter((i) => i.status === "unpaid").length;
  const paidCount = all.filter((i) => i.status === "paid").length;

  const shown = filter === "unpaid" ? all.filter((i) => i.status === "unpaid")
    : filter === "paid" ? all.filter((i) => i.status === "paid")
    : all;

  const tab = (key: string, label: string) => (
    <Link href={`/invoices?filter=${key}`} style={{ ...seg, ...(filter === key ? segOn : {}) }}>{label}</Link>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "inv.title")}</h1>
        <DocForm locale={locale} customers={custOpts} action={createInvoice} newKey="inv.new" catalog={catalog ?? []} orgId={profile.organization_id!} initialOpen={search.new === "1"} />
      </div>

      {/* Due vs paid summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div style={{ background: "#fdf1dc", border: "1px solid #f5d99b", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 12.5, color: "#b45309", fontWeight: 700 }}>● Due (unpaid)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#b45309" }}>{money(outstanding, cur)}</div>
          <div style={{ fontSize: 12, color: "#b45309" }}>{dueCount} invoice{dueCount === 1 ? "" : "s"}</div>
        </div>
        <div style={{ background: "#e6f6ec", border: "1px solid #b7e3c6", borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ fontSize: 12.5, color: "#15803d", fontWeight: 700 }}>✓ Paid</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>{money(collected, cur)}</div>
          <div style={{ fontSize: 12, color: "#15803d" }}>{paidCount} invoice{paidCount === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div style={{ display: "inline-flex", background: "#eef2f8", borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {tab("all", `All (${all.length})`)}{tab("unpaid", `Due (${dueCount})`)}{tab("paid", `Paid (${paidCount})`)}
      </div>

      <DocList
        rows={shown.map((e: any) => ({ id: e.id, number: e.number, status: e.status, total_minor: e.total_minor, issue_date: e.issue_date, public_token: e.public_token, customer_name: e.customers?.name ?? "—", customer_email: e.customers?.email ?? null, customer_phone: e.customers?.phone ?? null }))}
        locale={locale} currency={cur} orgName={org?.name ?? ""} kind="invoice" emptyKey="inv.empty" statusPrefix="ist" />
    </div>
  );
}

const seg: React.CSSProperties = { padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: 13, color: "#5c6675", textDecoration: "none" };
const segOn: React.CSSProperties = { background: "#fff", color: "#0b1524", boxShadow: "0 1px 3px rgba(0,0,0,.12)" };
