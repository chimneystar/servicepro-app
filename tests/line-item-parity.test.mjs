import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase } from "./helpers/pg.mjs";

// ---------------------------------------------------------------------------
// `estimate_items` and `invoice_items` must stay structurally identical.
//
// WHY THIS EXISTS INSTEAD OF THE CONSOLIDATION LEDGER 6.7 ASKED FOR.
//
// 6.7 proposed merging the duplicated line-item tables into one. Measured
// against a real database, the two are already identical: 11 columns each,
// differing only in their parent key (`estimate_id` / `invoice_id`), with no
// difference in type or nullability on any shared column. Migration 002 added
// `cost_minor` and `image_path` to both. The drift that consolidation exists to
// prevent has not happened in the life of this product.
//
// Set against that: merging them means rewriting 14 files and migrating live
// invoice line items — the money — with no access to the production database
// and no environment to rehearse in. Production is already on a different
// schema (102 tables against this branch's 97 at the time of the audit), so we
// cannot even predict the starting state. Every other item on this branch fixed
// something that was WRONG; this one would restructure something that is merely
// duplicated, and would do it to financial records.
//
// So the consolidation is REJECTED, and the obligation it was carrying —
// "remember to change both" — becomes a mechanism instead. That substitution is
// the whole lesson of this branch: the failures here were never people
// forgetting, they were obligations nobody had turned into a check.
//
// If the two ever need to diverge deliberately, this test is the place to say
// so, in writing, with the reason.
// ---------------------------------------------------------------------------

/** The parent key is the one column that is SUPPOSED to differ. */
const PARENT_KEY = { estimate_items: "estimate_id", invoice_items: "invoice_id" };

async function columns(db, table) {
  const { rows } = await db.query(`
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public' and table_name = '${table}'
     order by column_name
  `);
  return rows.filter((r) => r.column_name !== PARENT_KEY[table]);
}

test("estimate_items and invoice_items have the same columns", async () => {
  const { db } = await freshDatabase();
  const estimate = await columns(db, "estimate_items");
  const invoice = await columns(db, "invoice_items");

  const names = (rows) => rows.map((r) => r.column_name);
  assert.deepEqual(
    names(estimate),
    names(invoice),
    "a column added to one line-item table must be added to the other — they are the same concept " +
      "attached to two parents, and a quote becoming an invoice copies these rows across",
  );
  assert.ok(estimate.length >= 10, `expected the real table, saw ${estimate.length} columns`);
});

test("the shared columns agree on type and nullability", async () => {
  // Names matching is not enough. `qty_milli` being bigint on one side and
  // integer on the other, or nullable on one side only, is exactly the silent
  // divergence that turns a quote into an invoice with different arithmetic.
  const { db } = await freshDatabase();
  const estimate = await columns(db, "estimate_items");
  const byName = new Map((await columns(db, "invoice_items")).map((r) => [r.column_name, r]));

  const drift = [];
  for (const col of estimate) {
    const other = byName.get(col.column_name);
    if (!other) continue; // reported by the test above
    if (col.data_type !== other.data_type || col.is_nullable !== other.is_nullable) {
      drift.push(
        `${col.column_name}: estimate_items ${col.data_type}/${col.is_nullable}, ` +
          `invoice_items ${other.data_type}/${other.is_nullable}`,
      );
    }
  }
  assert.deepEqual(
    drift,
    [],
    `these line-item columns have drifted apart:\n  ${drift.join("\n  ")}`,
  );
});

test("both tables carry the money and costing columns the document engine needs", async () => {
  // The other direction, and the reason parity matters rather than being tidy:
  // lib/core/money.mjs computes a document from these columns, and
  // lib/core/reporting.mjs computes margin from cost_minor. A table missing one
  // of them does not fail loudly — it computes a wrong total.
  const { db } = await freshDatabase();
  const required = ["qty_milli", "unit_price_minor", "cost_minor", "taxable"];

  for (const table of ["estimate_items", "invoice_items"]) {
    const present = new Set((await columns(db, table)).map((r) => r.column_name));
    const missing = required.filter((c) => !present.has(c));
    assert.deepEqual(missing, [], `${table} is missing ${missing.join(", ")}`);
  }
});
