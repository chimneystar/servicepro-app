import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { money, fmtDate } from "@/lib/format";
import MovementForm from "./MovementForm";
// @ts-ignore — pure logic, unit-tested in tests/inventory.test.mjs
import { formatQtyMilli } from "@/lib/core/inventory.mjs";
import * as profilesData from "@/lib/data/profiles";
import * as fieldData from "@/lib/data/field";

export const dynamic = "force-dynamic";

const PAGE = 100;

/**
 * The stock ledger — who moved what, when, and why.
 *
 * Until now there was no answer to "where did those twelve fittings go": stock
 * was one mutable number with no history at all.
 */
export default async function InventoryMovementsPage() {
  const profile = await requireProfile();
  const he = (await getLocale()) === "he";
  if (profile.role === "tech") redirect("/");
  const supabase = await createClient();

  const [rows, items, { data: org }] = await Promise.all([
    fieldData.listRecentInventoryMovements(supabase, PAGE),
    fieldData.listInventoryItemsForPicker(supabase),
    supabase.from("organizations").select("currency").single(),
  ]);

  const movements = rows;
  const actorIds = Array.from(
    new Set(movements.map((m) => m.created_by).filter(Boolean)),
  ) as string[];
  const actors = actorIds.length
    ? await profilesData.listNamesByIds(supabase, actorIds)
    : ([] as { id: string; full_name: string }[]);

  const nameOfItem = new Map(items.map((i) => [i.id, i.name as string]));
  const nameOfActor = new Map(actors.map((a) => [a.id, a.full_name as string]));
  const cur = org?.currency ?? "USD";

  return (
    <div style={{ maxWidth: 860 }}>
      <Link
        href="/inventory"
        style={{ fontSize: "0.875rem", color: "#2563eb", textDecoration: "none" }}
      >
        ← {he ? "חזרה למלאי" : "Back to inventory"}
      </Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 4px" }}>
        {he ? "יומן תנועות מלאי" : "Stock ledger"}
      </h1>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 14 }}>
        {he
          ? "כל קבלה, שימוש ותיקון — עם מי, מתי ולמה. היומן הוא מקור האמת; הכמות בפריט נגזרת ממנו."
          : "Every receipt, consumption and correction — with who, when and why. The ledger is the source of truth; the quantity on each item is derived from it."}
      </p>

      <MovementForm
        items={items as { id: string; name: string; unit: string; quantity_milli: number }[]}
      />

      <div className="rlist" style={{ marginTop: 16 }}>
        {movements.map((m) => {
          const positive = m.qty_milli > 0;
          return (
            <div className="ritem" key={m.id}>
              <div className="rmain">
                <div className="rtitle">
                  {nameOfItem.get(m.item_id) ?? (he ? "פריט שנמחק" : "Deleted item")}
                  {m.allow_negative && (
                    <span style={{ color: "#9a3412", fontSize: "0.875rem" }}>
                      {" "}
                      · {he ? "מתחת לאפס" : "below zero"}
                    </span>
                  )}
                </div>
                <div className="rsub">
                  {m.kind} · {m.reason} ·{" "}
                  {nameOfActor.get(m.created_by ?? "") ?? (he ? "מערכת" : "system")} ·{" "}
                  {fmtDate(String(m.created_at).slice(0, 10))}
                  {m.job_id && (
                    <>
                      {" "}
                      · <Link href={`/jobs/${m.job_id}`}>{he ? "עבודה" : "job"}</Link>
                    </>
                  )}
                </div>
              </div>
              <div className="rend">
                <b style={{ color: positive ? "#15803d" : "#b91c1c" }}>
                  {positive ? "+" : ""}
                  {formatQtyMilli(m.qty_milli)}
                </b>
                <small>
                  {money(Math.round((Math.abs(m.qty_milli) * m.unit_cost_minor) / 1000), cur)}
                </small>
              </div>
            </div>
          );
        })}
        {movements.length === 0 && (
          <div className="rempty">
            {he ? "עוד לא נרשמו תנועות." : "No stock movements recorded yet."}
          </div>
        )}
      </div>
      {movements.length === PAGE && (
        <p style={{ color: "#5c6675", fontSize: "0.875rem", marginTop: 10 }}>
          {he ? `מוצגות ${PAGE} התנועות האחרונות.` : `Showing the ${PAGE} most recent movements.`}
        </p>
      )}
    </div>
  );
}
