import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { money } from "@/lib/format";
import PurchaseOrderPanel, { type PoRow } from "./PurchaseOrderPanel";
import * as operationsData from "@/lib/data/operations";
import * as fieldData from "@/lib/data/field";

export const dynamic = "force-dynamic";

/**
 * Receiving — where a purchase order stops being a note and becomes stock.
 *
 * The Operations screen creates POs; this is where they are ordered, received
 * and closed. Receiving a line writes an inventory movement, which is the whole
 * point: before this, stock could only ever go down (and in fact never did).
 */
export default async function ReceivingPage() {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();

  const [orders, inventory, { data: org }] = await Promise.all([
    fieldData.listOpenPurchaseOrders(supabase, 50),
    fieldData.listInventoryNamesUnitOnly(supabase),
    supabase.from("organizations").select("currency").single(),
  ]);

  const ids = orders.map((o) => o.id);
  const lines = ids.length
    ? await operationsData.listPurchaseOrderItems(supabase, ids)
    : ([] as PoRow["lines"]);

  const rows: PoRow[] = orders.map((o) => ({
    id: o.id,
    po_number: o.po_number,
    status: o.status,
    total_minor: o.total_minor,
    expected_date: o.expected_date,
    vendor:
      (Array.isArray(o.vendors)
        ? o.vendors[0]?.name
        : (o.vendors as { name: string } | null)?.name) ?? null,
    lines: lines.filter((l) => l.purchase_order_id === o.id),
  }));

  return (
    <div style={{ maxWidth: 860 }}>
      <Link
        href="/inventory"
        style={{ fontSize: "0.875rem", color: "#2563eb", textDecoration: "none" }}
      >
        ← {he ? "חזרה למלאי" : "Back to inventory"}
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 4px" }}>
        {he ? "קבלת סחורה" : "Receiving"}
      </h1>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 14 }}>
        {he
          ? "הזמנות רכש פתוחות. קבלת שורה מוסיפה תנועת מלאי לפריט המקושר."
          : "Open purchase orders. Receiving a line adds a stock movement to the linked inventory item."}
      </p>

      <PurchaseOrderPanel
        orders={rows}
        inventory={inventory as { id: string; name: string; unit: string }[]}
        currency={org?.currency ?? "USD"}
      />

      {rows.length === 0 && (
        <div className="rempty">
          {he
            ? "אין הזמנות רכש פתוחות. אפשר ליצור הזמנה במסך התפעול."
            : "No open purchase orders. Create one on the Operations screen."}{" "}
          <Link href="/operations">{he ? "תפעול" : "Operations"}</Link>
        </div>
      )}
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginTop: 12 }}>
        {he ? 'סה"כ פתוח: ' : "Open value: "}
        {money(
          rows.reduce((sum, r) => sum + (r.total_minor ?? 0), 0),
          org?.currency ?? "USD",
        )}
      </p>
    </div>
  );
}
