import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MOVEMENT_KINDS,
  signedQtyMilli,
  stockMilli,
  isOversold,
  formatQtyMilli,
  validateMovement,
  PO_STATUSES,
  PO_TRANSITIONS,
  canTransitionPurchaseOrder,
  outstandingMilli,
  purchaseOrderStatusFromLines,
  purchaseOrderTotalMinor,
  validateReceipt,
} from "../lib/core/inventory.mjs";
import { lineSubtotalMinor, parseQtyToMilli } from "../lib/core/money.mjs";

// ---------------------------------------------------------------------------
// 5.11 — inventory had ONE mutable quantity column, updated by a read-then-write
// that lost concurrent adjustments and recorded nothing. Nothing consumed stock:
// app/(app)/jobs/[id]/actions.ts contained the string "inventory" zero times.
// ---------------------------------------------------------------------------

test("stock is the sum of the ledger, not a counter", () => {
  const ledger = [
    { qty_milli: 10_000 }, // received 10
    { qty_milli: -3_000 }, // fitted 3 on a job
    { qty_milli: -1_500 }, // fitted 1.5 on another
    { qty_milli: 500 }, // half returned
  ];
  assert.equal(stockMilli(ledger), 6_000);
  assert.equal(formatQtyMilli(stockMilli(ledger)), "6");
  // Two entries recorded in the same instant BOTH count. The read-then-write
  // this replaces would have kept only the last writer's arithmetic.
  const concurrent = [{ qty_milli: -1_000 }, { qty_milli: -1_000 }];
  assert.equal(stockMilli([...ledger, ...concurrent]), 4_000);
});

test("sign is decided by the kind, not by the caller remembering a minus", () => {
  assert.equal(signedQtyMilli("receipt", 5_000), 5_000);
  assert.equal(signedQtyMilli("consumption", 5_000), -5_000);
  assert.equal(signedQtyMilli("consumption", -5_000), -5_000, "a magnitude is a magnitude");
  assert.equal(
    signedQtyMilli("adjustment", -5_000),
    -5_000,
    "only an adjustment carries its own sign",
  );
  assert.deepEqual(MOVEMENT_KINDS, ["receipt", "consumption", "adjustment"]);
  assert.throws(() => signedQtyMilli("theft", 1_000), /unknown movement kind/);
  assert.throws(() => signedQtyMilli("receipt", 1.5), /integer milliunits/);
});

test("quantities are integer milliunits, exactly like every other quantity", () => {
  assert.equal(parseQtyToMilli("1.5"), 1_500);
  assert.equal(formatQtyMilli(1_500), "1.5");
  assert.equal(formatQtyMilli(2_000), "2");
  assert.equal(formatQtyMilli(-500), "-0.5");
  assert.equal(formatQtyMilli(0), "0");
  // 0.1 + 0.2 in floats is 0.30000000000000004; in milliunits it is 300.
  assert.equal(stockMilli([{ qty_milli: 100 }, { qty_milli: 200 }]), 300);
});

// --- the negative-stock decision, proven in BOTH directions -----------------

test("a consumption within stock is permitted (the guard is not a cry-wolf)", () => {
  const r = validateMovement({
    kind: "consumption",
    qtyMilli: 2_000,
    availableMilli: 5_000,
    reason: "Fitted on job",
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.qtyMilli, -2_000);
  assert.equal(r.afterMilli, 3_000);
});

test("consuming the exact remaining stock is permitted", () => {
  const r = validateMovement({
    kind: "consumption",
    qtyMilli: 5_000,
    availableMilli: 5_000,
    reason: "Fitted on job",
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.afterMilli, 0);
});

test("consuming more than exists is REFUSED by default — the second of two technicians loses", () => {
  // Both read "1 available". The first consumes it. The second must be told the
  // truth rather than both silently succeeding.
  const r = validateMovement({
    kind: "consumption",
    qtyMilli: 1_000,
    availableMilli: 0,
    reason: "Fitted on job",
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "insufficient_stock");
  assert.match(r.error, /Only 0 in stock/);
  assert.equal(r.availableMilli, 0);
});

test("but an acknowledged over-consumption IS recorded — refusing outright loses the truth", () => {
  // The part is physically in the boiler. Refusing to record it would leave the
  // count wrong AND the job uncosted; this way the count is wrong in a way the
  // business can see, attributed to whoever did it.
  const r = validateMovement({
    kind: "consumption",
    qtyMilli: 1_000,
    availableMilli: 0,
    allowNegative: true,
    reason: "Fitted on site, stock count was wrong",
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.afterMilli, -1_000);
  assert.equal(
    isOversold({ quantity_milli: r.afterMilli }),
    true,
    "and the item is flagged for a count",
  );
  assert.equal(isOversold({ quantity_milli: 0 }), false);
});

test("the override needs a real reason, not a keystroke", () => {
  const bare = validateMovement({
    kind: "consumption",
    qtyMilli: 1_000,
    availableMilli: 0,
    allowNegative: true,
    reason: "x",
  });
  assert.equal(bare.ok, false);
  assert.equal(bare.code, "no_reason");
  // The same movement with an explanation is accepted.
  assert.equal(
    validateMovement({
      kind: "consumption",
      qtyMilli: 1_000,
      availableMilli: 0,
      allowNegative: true,
      reason: "Van stock",
    }).ok,
    true,
  );
});

test("every movement must say why", () => {
  assert.equal(validateMovement({ kind: "receipt", qtyMilli: 1_000, reason: "  " }).ok, false);
  assert.equal(
    validateMovement({ kind: "receipt", qtyMilli: 1_000, reason: "Delivery 8812" }).ok,
    true,
  );
});

test("malformed quantities are refused rather than becoming NaN", () => {
  for (const bad of [0, 1.5, "3", null, undefined, NaN, Infinity]) {
    const r = validateMovement({ kind: "receipt", qtyMilli: bad, reason: "Delivery" });
    assert.equal(r.ok, false, `${String(bad)} must be refused`);
    assert.ok(r.error);
  }
  assert.equal(validateMovement({ kind: "sale", qtyMilli: 1_000, reason: "x" }).code, "bad_kind");
});

test("a receipt is never blocked by a negative balance — putting stock back always works", () => {
  const r = validateMovement({
    kind: "receipt",
    qtyMilli: 4_000,
    availableMilli: -2_000,
    reason: "PO-1234",
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.afterMilli, 2_000);
});

// ---------------------------------------------------------------------------
// 5.19 — purchase orders were a shell: one line, status stuck at 'draft', no
// receive step, no inventory link.
// ---------------------------------------------------------------------------

test("a PO total is the sum of ALL its lines, through the integer engine", () => {
  const lines = [
    { qty_milli: 3_000, unit_cost_minor: 1_250 }, // 3 × 12.50 = 37.50
    { qty_milli: 1_500, unit_cost_minor: 999 }, // 1.5 × 9.99 = 14.985 -> 14.99
    { qty_milli: 10_000, unit_cost_minor: 45 }, // 10 × 0.45 = 4.50
  ];
  assert.equal(purchaseOrderTotalMinor(lines), 3_750 + 1_499 + 450);
  // Identical to the engine every other document total uses — no second
  // rounding path for purchasing.
  assert.equal(
    purchaseOrderTotalMinor(lines),
    lines.reduce((s, l) => s + lineSubtotalMinor(l.qty_milli, l.unit_cost_minor), 0),
  );
  // The old single-line shape is just a one-element list.
  assert.equal(purchaseOrderTotalMinor([lines[0]]), 3_750);
  assert.equal(purchaseOrderTotalMinor([]), 0);
});

test("the PO lifecycle advances, and cannot go backwards", () => {
  assert.deepEqual(PO_STATUSES, [
    "draft",
    "ordered",
    "partially_received",
    "received",
    "cancelled",
  ]);
  assert.equal(canTransitionPurchaseOrder("draft", "ordered"), true);
  assert.equal(canTransitionPurchaseOrder("ordered", "partially_received"), true);
  assert.equal(canTransitionPurchaseOrder("partially_received", "received"), true);
  assert.equal(canTransitionPurchaseOrder("ordered", "cancelled"), true);
  // Terminal means terminal: a received PO cannot be reopened and re-received.
  assert.equal(canTransitionPurchaseOrder("received", "ordered"), false);
  assert.equal(canTransitionPurchaseOrder("received", "partially_received"), false);
  assert.equal(canTransitionPurchaseOrder("cancelled", "ordered"), false);
  assert.equal(
    canTransitionPurchaseOrder("draft", "received"),
    false,
    "stock cannot arrive before it is ordered",
  );
  assert.equal(
    canTransitionPurchaseOrder("ordered", "ordered"),
    true,
    "a no-op is not a transition",
  );
  assert.deepEqual(PO_TRANSITIONS.received, []);
  assert.deepEqual(PO_TRANSITIONS.cancelled, []);
});

test("status follows the lines: partially received, then received", () => {
  const lines = [
    { qty_milli: 4_000, received_qty_milli: 0 },
    { qty_milli: 2_000, received_qty_milli: 0 },
  ];
  assert.equal(purchaseOrderStatusFromLines(lines, "ordered"), "ordered");
  lines[0].received_qty_milli = 4_000;
  assert.equal(purchaseOrderStatusFromLines(lines, "ordered"), "partially_received");
  lines[1].received_qty_milli = 2_000;
  assert.equal(purchaseOrderStatusFromLines(lines, "partially_received"), "received");
  // Over-delivery still closes the line rather than leaving it forever open.
  lines[1].received_qty_milli = 2_500;
  assert.equal(outstandingMilli(lines[1]), 0);
  assert.equal(purchaseOrderStatusFromLines(lines, "partially_received"), "received");
  // A cancelled PO stays cancelled whatever its lines say.
  assert.equal(purchaseOrderStatusFromLines(lines, "cancelled"), "cancelled");
});

test("receiving refuses the impossible and permits the ordinary", () => {
  const line = { id: "l1", qty_milli: 5_000, received_qty_milli: 1_000 };
  assert.equal(outstandingMilli(line), 4_000);
  assert.equal(validateReceipt(line, 4_000, "ordered").ok, true);
  assert.equal(validateReceipt(line, 6_000, "ordered").ok, true, "vendors do ship extra");
  assert.equal(validateReceipt(line, 0, "ordered").ok, false);
  assert.equal(validateReceipt(line, -1_000, "ordered").ok, false);
  assert.equal(validateReceipt(line, 1.5, "ordered").ok, false);
  assert.equal(validateReceipt(null, 1_000, "ordered").ok, false);
  assert.equal(validateReceipt(line, 1_000, "cancelled").ok, false);
  assert.equal(validateReceipt(line, 1_000, "received").ok, false);
});

// ---------------------------------------------------------------------------
// Structural: the ledger, its guards and the app wiring must actually exist.
// Comments are stripped first — every one of these files DESCRIBES the defect it
// fixes in prose, so an un-stripped grep would pass on the comment alone.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const stripSql = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
const stripTs = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the comment stripping used by these guards actually works", () => {
  const sql = stripSql("db/033_inventory_movements.sql");
  assert.ok(!/THE GAP/.test(sql), "SQL line comments must be removed");
  assert.ok(
    /create table if not exists public\.inventory_movements/.test(sql),
    "SQL must survive stripping",
  );
  const ts = stripTs("lib/inventory.ts");
  assert.ok(!/THE GAP THIS CLOSES/.test(ts), "TS block comments must be removed");
  assert.ok(/recordInventoryMovement/.test(ts), "code must survive stripping");
});

test("stock is an append-only ledger with a derived cache, not a mutable counter", () => {
  const sql = stripSql("db/033_inventory_movements.sql").toLowerCase();
  assert.ok(/create table if not exists public\.inventory_movements/.test(sql));
  assert.ok(
    /sync_inventory_quantity/.test(sql),
    "inventory_items.quantity must be derived from the ledger so it cannot drift",
  );
  assert.ok(
    /guard_inventory_quantity/.test(sql),
    "a hand-written quantity is exactly the drift this exists to stop",
  );
  assert.ok(
    /guard_inventory_movement_immutable/.test(sql),
    "a movement must not be editable after the fact",
  );
  assert.ok(!/create policy inventory_movements_update/.test(sql));
  assert.ok(!/create policy inventory_movements_delete/.test(sql));
  assert.ok(
    /grant select, insert on public\.inventory_movements to authenticated/.test(sql),
    "authenticated must not hold update or delete on the ledger",
  );
});

test("the last unit cannot be consumed twice: the guard locks the item row", () => {
  const sql = stripSql("db/033_inventory_movements.sql").toLowerCase();
  const guard = sql.slice(sql.indexOf("function public.guard_inventory_movement()"));
  assert.ok(
    /for update/.test(guard.slice(0, 1400)),
    "without a row lock two concurrent consumers both read the same balance and both succeed",
  );
  assert.ok(/insufficient_stock/.test(guard));
  assert.ok(
    /allow_negative/.test(guard),
    "and the deliberate override must be the ONLY way past it",
  );
  // The available figure is summed from the ledger, not read from the cache: a
  // corrupted cache must not authorise a consumption the ledger cannot support.
  assert.ok(/sum\(m\.qty_milli\)/.test(guard.slice(0, 1400)));
});

test("the negative-stock decision is written down where the next person will find it", () => {
  // Deliberately reads the UNSTRIPPED file: the requirement here is that the
  // choice is documented, and a documented choice lives in a comment.
  const sql = read("db/033_inventory_movements.sql");
  assert.ok(/MAY STOCK GO NEGATIVE/.test(sql));
  assert.ok(/allow_negative/.test(sql));
});

test("a job line consumes stock — the thing that did not exist at all", () => {
  const src = stripTs("app/(app)/jobs/[id]/actions.ts");
  assert.ok(
    /recordInventoryMovement/.test(src),
    'grep -n "inventory" over this file used to return nothing',
  );
  assert.ok(/kind: "consumption"/.test(src));
  assert.ok(
    /cost_minor: part\.cost_minor/.test(src),
    "job cost must include materials, or the margin is a fiction",
  );
  // The compensating delete matters: consuming stock for a line that failed to
  // save is the failure nobody can spot afterwards.
  const addAt = src.indexOf("export async function addJobPart");
  const body = src.slice(addAt, src.indexOf("export async function deleteJobItem"));
  assert.ok(
    body.indexOf('from("job_items").insert') < body.indexOf("recordInventoryMovement"),
    "the line must be written before the stock is taken",
  );
  assert.ok(
    /delete\(\)\.eq\("id", line\.id\)/.test(body),
    "a refused consumption must not leave the line behind",
  );
});

test("removing a job line puts the stock back with a new entry, never by deleting one", () => {
  const src = stripTs("app/(app)/jobs/[id]/actions.ts");
  const body = src.slice(src.indexOf("export async function deleteJobItem"));
  assert.ok(/Returned to stock/.test(body));
  assert.ok(!/inventory_movements"\)\.delete/.test(body), "the ledger is append-only");
});

test("purchase orders are multi-line, and receiving writes inventory movements", () => {
  const actions = stripTs("app/(app)/operations/actions.ts");
  assert.ok(
    /form\.getAll\("description"\)/.test(actions),
    "a PO that can only ever hold one line is not a purchase order",
  );
  assert.ok(/addPurchaseOrderLine/.test(actions));
  assert.ok(/advancePurchaseOrderStatus/.test(actions), "the status used to never leave 'draft'");
  assert.ok(/canTransitionPurchaseOrder/.test(actions));
  assert.ok(
    /receive_purchase_order_line/.test(actions),
    "receiving must go through the atomic DB function",
  );
  assert.ok(
    !/quantity: qtyMilli \/ 1000, unit_cost_minor: unitCostMinor \}\)/.test(actions),
    "the single-line insert should be gone",
  );

  const sql = stripSql("db/033_inventory_movements.sql").toLowerCase();
  assert.ok(/function public\.receive_purchase_order_line/.test(sql));
  const fn = sql.slice(sql.indexOf("function public.receive_purchase_order_line"));
  assert.ok(/for update/.test(fn.slice(0, 2500)), "a double-click must not receive twice");
  assert.ok(
    /insert into public\.inventory_movements/.test(fn.slice(0, 3000)),
    "receiving stock that never touches inventory_items is the whole 5.19 defect",
  );
  assert.ok(
    /guard_purchase_order_status/.test(sql),
    "the lifecycle is enforced at the database too",
  );
});

test("purchase_order_items.quantity is no longer a raw float", () => {
  const sql = stripSql("db/033_inventory_movements.sql").toLowerCase();
  assert.ok(
    /add column if not exists qty_milli\s+bigint/.test(sql),
    "every other quantity in the product is integer milliunits",
  );
  assert.ok(/add column if not exists received_qty_milli\s+bigint/.test(sql));
  assert.ok(
    /sync_purchase_order_item_qty/.test(sql),
    "the legacy numeric column must be kept in step, not dropped",
  );
  assert.ok(
    /sync_purchase_order_total/.test(sql),
    "the PO total must be the sum of its lines, not whatever was written once",
  );
  // Nothing is dropped: the preservation contract in docs/FEATURE-INVENTORY.md.
  assert.ok(!/drop table/.test(sql));
  assert.ok(!/drop column/.test(sql));
});

test("the migration is idempotent — it can be run twice", () => {
  const sql = stripSql("db/033_inventory_movements.sql").toLowerCase();
  const creates = sql.match(/create table (?!if not exists)/g) ?? [];
  assert.equal(creates.length, 0, "every create table must be `if not exists`");
  const indexes = sql.match(/create index (?!if not exists)/g) ?? [];
  assert.equal(indexes.length, 0, "every create index must be `if not exists`");
  const columns = sql.match(/add column (?!if not exists)/g) ?? [];
  assert.equal(columns.length, 0, "every add column must be `if not exists`");
  // Constraints have no IF NOT EXISTS, so they must be wrapped in a
  // duplicate-swallowing DO block — the pattern migrations 014 and 030 use.
  for (const m of sql.match(/add constraint \w+/g) ?? []) {
    const at = sql.indexOf(m);
    const before = sql.slice(Math.max(0, at - 400), at);
    assert.ok(
      /do \$\$/.test(before),
      `${m} must be inside a DO block that swallows duplicate_object`,
    );
  }
});

test("technicians can record what they fitted, and nothing more", () => {
  const sql = stripSql("db/033_inventory_movements.sql");
  const policy = sql.slice(sql.indexOf("create policy inventory_movements_insert"));
  const head = policy.slice(0, 800);
  assert.ok(
    /kind = 'consumption'/.test(head),
    "a technician must be able to record a part they fitted",
  );
  assert.ok(/created_by = auth\.uid\(\)/.test(head), "and only as themselves");
  assert.ok(
    /current_user_role\(\) in \('owner','office'\)/.test(head),
    "receiving and free-hand adjustments stay with owner/office",
  );
  assert.ok(
    /job_id is not null/.test(head),
    "a technician's positive adjustment must be tied to a job, not conjured from nothing",
  );
});
