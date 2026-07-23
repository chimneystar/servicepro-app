import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import DocForm from "@/components/DocForm";
import { createInvoice } from "./actions";
import { DocTable } from "./shared";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: invoices }, { data: customers }, { data: org }] = await Promise.all([
    supabase.from("invoices").select("id, number, status, total_minor, issue_date, customers(name)").is("deleted_at", null).order("number", { ascending: false }),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("organizations").select("currency").single(),
  ]);
  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "inv.title")}</h1>
        <DocForm locale={locale} customers={custOpts} action={createInvoice} newKey="inv.new" />
      </div>
      <DocTable rows={invoices ?? []} locale={locale} currency={org?.currency ?? "USD"} emptyKey="inv.empty" statusPrefix="ist" />
    </div>
  );
}
