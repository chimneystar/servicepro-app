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
import { loadCreditNotes, assertDocumentEditable } from "@/lib/documents";
// @ts-ignore -- document integrity rules (JS module, unit-tested)
import { documentLock } from "@/lib/core/documents.mjs";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "id, number, status, discount_minor, tax_rate_bps, issue_date, notes, public_token, estimate_id, version, sent_at, signed_at, paid_at, voided_at, void_reason, credited_minor, customers(name, address, city, phone, email)",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, logo_url, tagline, phone, email, currency, tax_label, accent_color")
    .single();
  if (!inv)
    return (
      <div>
        <Link href="/invoices" style={back}>
          ‹ Invoices
        </Link>
        <div style={{ padding: 40, textAlign: "center", color: "#5c6675" }}>Invoice not found.</div>
      </div>
    );
  const activity = await loadActivity("invoices", id);

  const { data: rows } = await supabase
    .from("invoice_items")
    .select("title, description, qty_milli, unit_price_minor, taxable, image_path")
    .eq("invoice_id", id)
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
    discountMinor: inv.discount_minor,
    taxRateBps: inv.tax_rate_bps,
  });

  // Payment summary.
  //
  // Two corrections here, both of which showed the office more money than the
  // business had actually received:
  //   1. This summed EVERY payment row regardless of status, so a declined card
  //      or an ACH transfer still in flight read as collected. Every other
  //      reader in the codebase filters to settled/partially_refunded — this
  //      screen was the one out of step.
  //   2. Refunds were never subtracted.
  // It also now credits a deposit paid against the originating estimate, matching
  // openBalance() in lib/payments/server.ts. See db/024_deposit_credit.sql.
  const SETTLED = ["settled", "partially_refunded"];
  let paymentQuery = supabase
    .from("payments")
    .select(
      "amount_minor, base_amount_minor, refunded_minor, normalized_status, method, reference, paid_at",
    )
    .in("normalized_status", SETTLED)
    .order("paid_at");
  paymentQuery = inv.estimate_id
    ? paymentQuery.or(`invoice_id.eq.${id},estimate_id.eq.${inv.estimate_id}`)
    : paymentQuery.eq("invoice_id", id);
  const { data: pays } = await paymentQuery;

  const paid = (pays ?? []).reduce(
    (s: number, p: any) =>
      s +
      Math.max(
        0,
        Number(p.base_amount_minor ?? p.amount_minor ?? 0) - Number(p.refunded_minor ?? 0),
      ),
    0,
  );
  // Ledger 6a.1 — a credit note reduces what is owed WITHOUT touching the
  // invoice, so the balance has to net it off here. `credited_minor` is a cache
  // maintained by trigger from the credit_notes ledger (migration 036), exactly
  // as `refunded_minor` is maintained from payment_refunds.
  const creditNotes = await loadCreditNotes(supabase, id);
  const credited = Number(inv.credited_minor ?? 0);
  const billed = Math.max(0, totals.totalMinor - credited);
  const balance = Math.max(0, billed - paid);
  const lockState = documentLock("invoice", { ...inv, collected_minor: paid });
  const editable = await assertDocumentEditable("invoice", inv, locale);
  const c: any = inv.customers;
  const accent = org?.accent_color || "#2563eb";
  const cur = org?.currency ?? "USD";

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
        <Link href="/invoices" style={back}>
          ‹ Invoices
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
          kind="invoice"
          id={inv.id}
          token={inv.public_token}
          status={inv.status}
          number={inv.number}
          locked={lockState.locked}
          voided={!!inv.voided_at}
          customerName={c?.name ?? "—"}
          customerEmail={c?.email ?? null}
          customerPhone={c?.phone ?? null}
          orgName={org?.name ?? ""}
        />
      </div>

      <div className="no-print">
        <DocCorrections
          kind="invoice"
          id={inv.id}
          number={inv.number}
          currency={cur}
          totalMinor={totals.totalMinor}
          creditedMinor={credited}
          collectedMinor={paid}
          voidedAt={inv.voided_at ?? null}
          voidReason={inv.void_reason ?? null}
          locked={lockState.locked}
          lockReason={editable.ok ? null : (editable.error ?? null)}
          reopenable={false}
          creditNotes={creditNotes}
        />
      </div>

      {((pays ?? []).length > 0 || credited > 0) && (
        <div
          className="no-print"
          style={{
            display: "grid",
            gridTemplateColumns: credited > 0 ? "1fr 1fr 1fr" : "1fr 1fr",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div style={{ background: "#e6f6ec", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: "0.75rem", color: "#15803d", fontWeight: 700 }}>Paid</div>
            <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#15803d" }}>
              {money(paid, cur)}
            </div>
          </div>
          {credited > 0 && (
            <div style={{ background: "#eef2f8", borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontSize: "0.75rem", color: "#5c6675", fontWeight: 700 }}>Credited</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#5c6675" }}>
                −{money(credited, cur)}
              </div>
            </div>
          )}
          <div
            style={{
              background: balance > 0 ? "#fdf1dc" : "#eef2f8",
              borderRadius: 12,
              padding: "12px 14px",
            }}
          >
            <div style={{ fontSize: "0.75rem", color: "#b45309", fontWeight: 700 }}>Balance</div>
            <div
              style={{
                fontSize: "1.25rem",
                fontWeight: 800,
                color: balance > 0 ? "#b45309" : "#15803d",
              }}
            >
              {money(balance, cur)}
            </div>
          </div>
        </div>
      )}

      <DocView
        title="Invoice"
        number={inv.number}
        accent={accent}
        currency={cur}
        org={org}
        customer={c}
        issueDate={inv.issue_date}
        items={items}
        totals={totals}
        taxLabel={org?.tax_label ?? "Tax"}
        taxRateBps={inv.tax_rate_bps}
        notes={inv.notes}
      />
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
