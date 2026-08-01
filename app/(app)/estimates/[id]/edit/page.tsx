import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DocEditor, { type EditInitial } from "@/components/DocEditor";
import { updateEstimate } from "@/app/(app)/estimates/actions";
import DocLockedNotice from "@/components/DocLockedNotice";
import { assertDocumentEditable } from "@/lib/documents";
import { listItemsWithCost } from "@/lib/data/estimates";
import * as customersData from "@/lib/data/customers";
import * as priceBookData from "@/lib/data/price-book";

export const dynamic = "force-dynamic";

export default async function EditEstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const { data: est } = await supabase
    .from("estimates")
    .select(
      "id, number, customer_id, discount_minor, deposit_minor, notes, issue_date, status, version, signed_at, sent_at, voided_at",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!est) return <div>Estimate not found.</div>;

  // Ledger 6a.5 — do not open an editor that cannot save. Re-checked in the
  // server action and again by a database trigger.
  const editable = await assertDocumentEditable("estimate", est);
  if (!editable.ok) {
    return (
      <DocLockedNotice kind="estimate" id={est.id} number={est.number} reason={editable.error!} />
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
    customer_id: est.customer_id,
    discount: (est.discount_minor / 100).toFixed(2),
    notes: est.notes ?? "",
    issue_date: est.issue_date ?? "",
    deposit: ((est.deposit_minor ?? 0) / 100).toFixed(2),
    version: est.version,
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
      <Link href={`/estimates/${id}`} className="sp-link">
        ‹ Back
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 14px" }}>
        Edit estimate #{est.number}
      </h1>
      <DocEditor
        kind="estimate"
        docId={est.id}
        action={updateEstimate.bind(null, est.id)}
        customers={customers.map((c) => ({ id: c.id, label: c.name }))}
        catalog={catalog}
        orgId={profile.organization_id!}
        initial={initial}
        returnHref={`/estimates/${est.id}`}
      />
    </div>
  );
}
