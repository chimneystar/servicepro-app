import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import DocForm from "@/components/DocForm";
import { createInvoice } from "./actions";
import DocList from "@/components/DocList";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: invoices }, { data: customers }, { data: org }, { data: catalog }] = await Promise.all([
    supabase.from("invoices").select("id, number, status, total_minor, issue_date, public_token, customers(name)").is("deleted_at", null).order("number", { ascending: false }),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("organizations").select("currency").single(),
    supabase.from("price_book").select("id, name, price_minor, cost_minor").order("name"),
  ]);
  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "inv.title")}</h1>
        <DocForm locale={locale} customers={custOpts} action={createInvoice} newKey="inv.new" catalog={catalog ?? []} />
      </div>
      <DocList
        rows={(invoices ?? []).map((e: any) => ({ id: e.id, number: e.number, status: e.status, total_minor: e.total_minor, issue_date: e.issue_date, public_token: e.public_token, customer_name: e.customers?.name ?? "—" }))}
        locale={locale} currency={org?.currency ?? "USD"} kind="invoice" emptyKey="inv.empty" statusPrefix="ist" />
    </div>
  );
}
