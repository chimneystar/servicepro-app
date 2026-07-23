import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import DocForm from "@/components/DocForm";
import { createEstimate } from "./actions";
import { DocTable } from "../invoices/shared";

export const dynamic = "force-dynamic";

export default async function EstimatesPage() {
  await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const [{ data: estimates }, { data: customers }, { data: org }] = await Promise.all([
    supabase.from("estimates").select("id, number, status, total_minor, issue_date, customers(name)").is("deleted_at", null).order("number", { ascending: false }),
    supabase.from("customers").select("id, name").is("deleted_at", null).order("name"),
    supabase.from("organizations").select("currency").single(),
  ]);
  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "est.title")}</h1>
        <DocForm locale={locale} customers={custOpts} action={createEstimate} newKey="est.new" />
      </div>
      <DocTable rows={estimates ?? []} locale={locale} currency={org?.currency ?? "USD"} emptyKey="est.empty" statusPrefix="dst" />
    </div>
  );
}
