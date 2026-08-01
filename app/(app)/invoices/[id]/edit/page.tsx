import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DocEditor, { type EditInitial } from "@/components/DocEditor";
import { updateInvoice } from "@/app/(app)/invoices/actions";
import DocLockedNotice from "@/components/DocLockedNotice";
import { assertDocumentEditable } from "@/lib/documents";
import { listItemsWithCost } from "@/lib/data/invoices";
import * as customersData from "@/lib/data/customers";
import * as priceBookData from "@/lib/data/price-book";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const { data: inv } = await supabase
    .from("invoices")
    .select(
      "id, number, customer_id, discount_minor, notes, issue_date, status, version, signed_at, sent_at, paid_at, voided_at, estimate_id",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!inv) return <div>Invoice not found.</div>;

  // Ledger 6a.5 — do not open an editor that cannot save. The same rule runs
  // again in the server action (and a third time as a database trigger), so
  // this is a courtesy, not the guard.
  const editable = await assertDocumentEditable("invoice", inv);
  if (!editable.ok) {
    return (
      <DocLockedNotice kind="invoice" id={inv.id} number={inv.number} reason={editable.error!} />
    );
  }

  const [items, customers, catalog] = await Promise.all([
    listItemsWithCost(supabase, id),
    customersData.listPickable(supabase),
    // `PriceBookRow.cost_minor` is typed nullable in lib/data/price-book.ts even
    // though the column is NOT NULL; coerced here to match `CatalogItem` without
    // touching a file this migration doesn't own.
    priceBookData.listForPicker(supabase),
  ]);

  const initial: EditInitial = {
    customer_id: inv.customer_id,
    discount: (inv.discount_minor / 100).toFixed(2),
    notes: inv.notes ?? "",
    issue_date: inv.issue_date ?? "",
    version: inv.version,
    items: items.map((r: any) => ({
      title: r.title ?? "",
      desc: r.description ?? "",
      qty: (r.qty_milli / 1000).toString(),
      price: (r.unit_price_minor / 100).toFixed(2),
      cost: ((r.cost_minor ?? 0) / 100).toFixed(2),
      taxable: r.taxable !== false,
      image_path: r.image_path ?? "",
    })),
  };

  return (
    <div>
      <Link href={`/invoices/${id}`} className="sp-link">
        ‹ Back
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 14px" }}>
        Edit invoice #{inv.number}
      </h1>
      <DocEditor
        kind="invoice"
        docId={inv.id}
        action={updateInvoice.bind(null, inv.id)}
        customers={customers.map((c) => ({ id: c.id, label: c.name }))}
        catalog={catalog}
        orgId={profile.organization_id!}
        initial={initial}
        returnHref={`/invoices/${inv.id}`}
      />
    </div>
  );
}
