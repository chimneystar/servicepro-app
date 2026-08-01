import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import Link from "next/link";
import DocView, { type ViewItem } from "@/components/DocView";
import DocDetailActions from "@/components/DocDetailActions";
import PrintButton from "@/components/PrintButton";
// @ts-ignore
import { computeDocument } from "@/lib/core/money.mjs";
import ActivityTimeline from "@/components/ActivityTimeline";
import { loadActivity } from "@/lib/activity";
import { getLocale } from "@/lib/locale-server";
import DocCorrections from "@/components/DocCorrections";
import { assertDocumentEditable, collectedOnDocument } from "@/lib/documents";
// @ts-ignore -- document integrity rules (JS module, unit-tested)
import { documentLock, canReopen } from "@/lib/core/documents.mjs";
import EstimateOptionsEditor, { type OptionRow, type OptionItemRow } from "./EstimateOptionsEditor";

export const dynamic = "force-dynamic";

export default async function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select(
      "id, number, status, discount_minor, deposit_minor, tax_rate_bps, issue_date, notes, public_token, version, sent_at, signed_at, voided_at, void_reason, reopened_at, reopen_reason, reopen_count, customers(name, address, city, phone, email), selected_option_id",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, logo_url, tagline, phone, email, currency, tax_label, accent_color")
    .single();
  if (!est)
    return (
      <div>
        <Link href="/estimates" style={back}>
          ‹ Estimates
        </Link>
        <div className="sp-empty">Estimate not found.</div>
      </div>
    );
  const activity = await loadActivity("estimates", id);

  const { data: rows } = await supabase
    .from("estimate_items")
    .select("title, description, qty_milli, unit_price_minor, taxable, image_path")
    .eq("estimate_id", id)
    .order("sort");
  const items: ViewItem[] = (rows ?? []).map((r: any) => ({
    title: r.title,
    description: r.description,
    qty_milli: r.qty_milli,
    unit_price_minor: r.unit_price_minor,
    taxable: r.taxable,
    imageUrl: r.image_path
      ? supabase.storage.from("item-photos").getPublicUrl(r.image_path).data.publicUrl
      : null,
  }));
  const totals = computeDocument({
    items: items.map((i) => ({
      qtyMilli: i.qty_milli,
      unitPriceMinor: i.unit_price_minor,
      taxable: i.taxable,
    })),
    discountMinor: est.discount_minor,
    taxRateBps: est.tax_rate_bps,
  });
  const c: any = est.customers;
  const accent = org?.accent_color || "#2563eb";
  const cur = org?.currency ?? "USD";
  // A paid deposit is money collected against the estimate, and it is why an
  // estimate can be locked (and un-voidable) just like an invoice.
  const collected = await collectedOnDocument("estimate", id);
  const lockState = documentLock("estimate", { ...est, collected_minor: collected });
  const editable = await assertDocumentEditable("estimate", est, locale);
  const reopenable = canReopen("estimate", est, { collectedMinor: collected });

  // 6c.4 — the good/better/best bundles for this estimate.
  const [{ data: optionRows }, { data: optionItemRows }] = await Promise.all([
    supabase
      .from("estimate_options")
      .select("id, tier, title, description, recommended, deposit_minor, total_minor, sort")
      .eq("estimate_id", id)
      .order("sort"),
    supabase
      .from("estimate_option_items")
      .select("id, option_id, title, description, qty_milli, unit_price_minor, cost_minor, taxable")
      .order("sort"),
  ]);
  const optionIds = new Set((optionRows ?? []).map((row) => row.id));
  const optionItems = (optionItemRows ?? []).filter((row) => optionIds.has(row.option_id));

  return (
    <div style={{ maxWidth: 680 }}>
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <Link href="/estimates" style={back}>
          ‹ Estimates
        </Link>
        <PrintButton label="Save as PDF" />
      </div>
      <div
        className="no-print"
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 14,
          marginBottom: 14,
        }}
      >
        <DocDetailActions
          kind="estimate"
          id={est.id}
          token={est.public_token}
          status={est.status}
          number={est.number}
          locked={lockState.locked}
          voided={!!est.voided_at}
          customerName={c?.name ?? "—"}
          customerEmail={c?.email ?? null}
          customerPhone={c?.phone ?? null}
          orgName={org?.name ?? ""}
        />
      </div>
      <div className="no-print">
        <DocCorrections
          kind="estimate"
          id={est.id}
          number={est.number}
          currency={cur}
          totalMinor={totals.totalMinor}
          creditedMinor={0}
          collectedMinor={collected}
          voidedAt={est.voided_at ?? null}
          voidReason={est.void_reason ?? null}
          locked={lockState.locked}
          lockReason={editable.ok ? null : (editable.error ?? null)}
          reopenable={reopenable}
        />
      </div>
      <DocView
        title="Estimate"
        number={est.number}
        accent={accent}
        currency={cur}
        org={org}
        customer={c}
        issueDate={est.issue_date}
        items={items}
        totals={totals}
        taxLabel={org?.tax_label ?? "Tax"}
        taxRateBps={est.tax_rate_bps}
        notes={est.notes}
      />
      {(est.deposit_minor ?? 0) > 0 && (
        <div
          style={{
            marginTop: 12,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 12,
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontWeight: 700 }}>Deposit requested</span>
          <b style={{ color: accent }}>{money(est.deposit_minor, org?.currency ?? "USD")}</b>
        </div>
      )}
      <div className="no-print">
        <EstimateOptionsEditor
          locale={locale}
          currency={org?.currency ?? "USD"}
          estimateId={est.id}
          options={(optionRows ?? []) as OptionRow[]}
          items={optionItems as OptionItemRow[]}
          selectedOptionId={(est as any).selected_option_id ?? null}
          signed={!!(est as any).signed_at}
          discountMinor={est.discount_minor ?? 0}
          taxRateBps={est.tax_rate_bps ?? 0}
          estimateDeposit={est.deposit_minor ?? 0}
        />
      </div>
      <ActivityTimeline entries={activity} locale={locale} />
    </div>
  );
}
const back: React.CSSProperties = {
  color: "#2563eb",
  fontWeight: 700,
  fontSize: "0.875rem",
  textDecoration: "none",
};
