import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import DocForm from "@/components/DocForm";
import { createEstimate } from "./actions";
import DocList from "@/components/DocList";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const search = await searchParams;
  const profile = await requireProfile();
  const locale = (await getLocale());
  const supabase = await createClient();
  const [{ data: estimates }, { data: customers }, { data: org }, { data: catalog }] = await Promise.all([
    supabase.from("estimates").select("id, number, status, total_minor, issue_date, public_token, voided_at, customers(name, email, phone)").is("deleted_at", null).eq("archived", false).order("number", { ascending: false }),
    supabase.from("customers").select("id, name").is("deleted_at", null).eq("archived", false).order("name"),
    supabase.from("organizations").select("currency, name").single(),
    supabase.from("price_book").select("id, name, description, price_minor, cost_minor, taxable, image_path").order("name"),
  ]);
  const custOpts = (customers ?? []).map((c) => ({ id: c.id, label: c.name }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "est.title")}</h1>
        <DocForm locale={locale} customers={custOpts} action={createEstimate} newKey="est.new" catalog={catalog ?? []} orgId={profile.organization_id!} initialOpen={search.new === "1"} />
      </div>
      <DocList
        rows={(estimates ?? []).map((e: any) => ({ id: e.id, number: e.number, status: e.status, total_minor: e.total_minor, issue_date: e.issue_date, public_token: e.public_token, voided_at: e.voided_at ?? null, customer_name: e.customers?.name ?? "—", customer_email: e.customers?.email ?? null, customer_phone: e.customers?.phone ?? null }))}
        locale={locale} currency={org?.currency ?? "USD"} orgName={org?.name ?? ""} kind="estimate" emptyKey="est.empty" statusPrefix="dst" />
    </div>
  );
}
