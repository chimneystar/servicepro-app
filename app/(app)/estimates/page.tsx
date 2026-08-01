import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import DocForm from "@/components/DocForm";
import { createEstimate } from "./actions";
import DocList from "@/components/DocList";
import { listEstimatesForListPage } from "@/lib/data/documents-extra";
import * as customersData from "@/lib/data/customers";
import * as priceBookData from "@/lib/data/price-book";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const search = await searchParams;
  const profile = await requireProfile();
  const locale = await getLocale();
  const supabase = await createClient();
  const [estimates, customers, { data: org }, catalog] = await Promise.all([
    listEstimatesForListPage(supabase),
    customersData.listPickable(supabase),
    supabase.from("organizations").select("currency, name").single(),
    // `PriceBookRow.cost_minor` is typed nullable in lib/data/price-book.ts even
    // though the column is NOT NULL; coerced here to match `CatalogItem` without
    // touching a file this migration doesn't own.
    priceBookData
      .listForPicker(supabase)
      .then((rows) => rows.map((r) => ({ ...r, cost_minor: r.cost_minor ?? 0 }))),
  ]);
  const custOpts = customers.map((c) => ({ id: c.id, label: c.name }));

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
        }}
      >
        <h1 className="sp-heading sp-heading--lg">{t(locale, "est.title")}</h1>
        <DocForm
          locale={locale}
          customers={custOpts}
          action={createEstimate}
          newKey="est.new"
          catalog={catalog}
          orgId={profile.organization_id!}
          initialOpen={search.new === "1"}
        />
      </div>
      <DocList
        rows={estimates.map((e: any) => ({
          id: e.id,
          number: e.number,
          status: e.status,
          total_minor: e.total_minor,
          issue_date: e.issue_date,
          public_token: e.public_token,
          voided_at: e.voided_at ?? null,
          customer_name: e.customers?.name ?? "—",
          customer_email: e.customers?.email ?? null,
          customer_phone: e.customers?.phone ?? null,
        }))}
        locale={locale}
        currency={org?.currency ?? "USD"}
        orgName={org?.name ?? ""}
        kind="estimate"
        emptyKey="est.empty"
        statusPrefix="dst"
      />
    </div>
  );
}
