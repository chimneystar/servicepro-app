import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import DocEditor, { type EditInitial } from "@/components/DocEditor";
import { updateInvoice } from "@/app/(app)/invoices/actions";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();
  const { data: inv } = await supabase.from("invoices").select("id, number, customer_id, discount_minor, notes, issue_date").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!inv) return <div>Invoice not found.</div>;
  const [{ data: items }, { data: customers }, { data: catalog }] = await Promise.all([
    supabase.from("invoice_items").select("title, description, qty_milli, unit_price_minor, cost_minor, taxable, image_path").eq("invoice_id", id).order("sort"),
    supabase.from("customers").select("id, name").is("deleted_at", null).eq("archived", false).order("name"),
    supabase.from("price_book").select("id, name, description, price_minor, cost_minor, taxable, image_path").order("name"),
  ]);

  const initial: EditInitial = {
    customer_id: inv.customer_id, discount: (inv.discount_minor / 100).toFixed(2), notes: inv.notes ?? "", issue_date: inv.issue_date ?? "",
    items: (items ?? []).map((r: any) => ({ title: r.title ?? "", desc: r.description ?? "", qty: (r.qty_milli / 1000).toString(), price: (r.unit_price_minor / 100).toFixed(2), cost: ((r.cost_minor ?? 0) / 100).toFixed(2), taxable: r.taxable !== false, image_path: r.image_path ?? "" })),
  };

  return (
    <div>
      <Link href={`/invoices/${id}`} style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Back</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 14px" }}>Edit invoice #{inv.number}</h1>
      <DocEditor kind="invoice" docId={inv.id} action={updateInvoice.bind(null, inv.id)} customers={(customers ?? []).map((c) => ({ id: c.id, label: c.name }))} catalog={catalog ?? []} orgId={profile.organization_id!} initial={initial} returnHref={`/invoices/${inv.id}`} />
    </div>
  );
}
