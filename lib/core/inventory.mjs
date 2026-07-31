// =====================================================================
//  inventory.mjs — stock arithmetic and the rules that guard it.
//
//  Stock is the SUM OF A LEDGER, never a counter that gets incremented.
//  `inventory_items.quantity_milli` is a cache the database maintains from
//  `inventory_movements`; the functions here compute the same answers in the
//  application so a screen can explain a refusal before the round trip, and so
//  the rules are unit-tested rather than reasoned about.
//
//  Quantities are integer MILLIUNITS (qty * 1000), the convention used by
//  job_items.qty_milli and every document line. Money is integer minor units
//  and goes through lib/core/money.mjs — nothing here multiplies a float.
//
//  Tests: tests/inventory.test.mjs
// =====================================================================

// @ts-nocheck
import { lineSubtotalMinor } from "./money.mjs";

/** Movement kinds. A receipt only adds, a consumption only removes, an
 *  adjustment may do either — that is precisely what "adjustment" means. */
export const MOVEMENT_KINDS = ["receipt", "consumption", "adjustment"];

const isInt = (v) => Number.isInteger(v);

/**
 * Normalise a magnitude to the signed quantity the ledger stores.
 * Callers hand in "3 units consumed", not "-3000".
 */
export function signedQtyMilli(kind, magnitudeMilli) {
  if (!MOVEMENT_KINDS.includes(kind)) throw new Error(`unknown movement kind: ${kind}`);
  if (!isInt(magnitudeMilli)) throw new Error("quantity must be integer milliunits");
  if (kind === "receipt") return Math.abs(magnitudeMilli);
  if (kind === "consumption") return -Math.abs(magnitudeMilli);
  return magnitudeMilli; // adjustment: the sign is the caller's meaning
}

/** Stock on hand, in milliunits, from the ledger itself. */
export function stockMilli(movements) {
  return (movements ?? []).reduce((sum, m) => sum + (Number(m?.qty_milli) || 0), 0);
}

/** True when stock has been driven below zero and needs a physical count. */
export function isOversold(item) {
  return (Number(item?.quantity_milli) || 0) < 0;
}

/** Milliunits -> a human string ("1500" -> "1.5", "2000" -> "2"). */
export function formatQtyMilli(milli) {
  const n = Number(milli) || 0;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * The same decision the database makes in guard_inventory_movement(), so the UI
 * can explain it without a round trip. The database remains the authority: this
 * is a courtesy, not the enforcement point.
 *
 * Returns `{ ok: true, qtyMilli }` (signed) or `{ ok: false, error, code }`.
 * `code === "insufficient_stock"` tells the caller it may offer the deliberate
 * override rather than a dead end.
 */
export function validateMovement({ kind = "", qtyMilli = 0, availableMilli = 0, allowNegative = false, reason = "" } = {}) {
  if (!MOVEMENT_KINDS.includes(kind)) {
    return { ok: false, code: "bad_kind", error: "Unknown movement type." };
  }
  if (!isInt(qtyMilli) || qtyMilli === 0) {
    return { ok: false, code: "bad_quantity", error: "Enter a quantity." };
  }
  const signed = signedQtyMilli(kind, qtyMilli);
  if (kind === "adjustment" && signed === 0) {
    return { ok: false, code: "bad_quantity", error: "Enter a quantity." };
  }
  if (!String(reason ?? "").trim()) {
    return { ok: false, code: "no_reason", error: "Say why stock changed." };
  }

  const available = Number(availableMilli) || 0;
  const after = available + signed;
  if (after < 0) {
    if (!allowNegative) {
      return {
        ok: false,
        code: "insufficient_stock",
        availableMilli: available,
        error: `Only ${formatQtyMilli(available)} in stock.`,
      };
    }
    // Deliberate: the part was physically fitted. The override needs a real
    // reason, not a keystroke — the database enforces the same minimum.
    if (String(reason).trim().length < 3) {
      return { ok: false, code: "no_reason", error: "Say why stock is going negative." };
    }
  }
  return { ok: true, qtyMilli: signed, afterMilli: after };
}

// ---------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------

export const PO_STATUSES = ["draft", "ordered", "partially_received", "received", "cancelled"];

/** The lifecycle, mirroring guard_purchase_order_status() in db/033. */
export const PO_TRANSITIONS = {
  draft: ["ordered", "cancelled"],
  ordered: ["partially_received", "received", "cancelled"],
  partially_received: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

export function canTransitionPurchaseOrder(from, to) {
  if (from === to) return true; // a no-op update is not a transition
  return (PO_TRANSITIONS[from] ?? []).includes(to);
}

/** What is still owed on a line, in milliunits (never negative). */
export function outstandingMilli(line) {
  const ordered = Number(line?.qty_milli) || 0;
  const received = Number(line?.received_qty_milli) || 0;
  return Math.max(0, ordered - received);
}

/**
 * The status a PO should hold given its lines. Nothing received keeps the
 * current status; some received is 'partially_received'; all received is
 * 'received'. A cancelled PO stays cancelled.
 */
export function purchaseOrderStatusFromLines(lines, current = "ordered") {
  if (current === "cancelled") return "cancelled";
  const rows = lines ?? [];
  if (!rows.length) return current;
  const outstanding = rows.reduce((sum, l) => sum + outstandingMilli(l), 0);
  const received = rows.reduce((sum, l) => sum + (Number(l?.received_qty_milli) || 0), 0);
  if (outstanding === 0) return "received";
  if (received > 0) return "partially_received";
  return current;
}

/**
 * PO total from its lines, through the same integer engine every other document
 * total uses. The database computes the identical figure in
 * sync_purchase_order_total(); this is what the screen shows before saving.
 */
export function purchaseOrderTotalMinor(lines) {
  return (lines ?? []).reduce(
    (sum, l) => sum + lineSubtotalMinor(Number(l?.qty_milli) || 0, Number(l?.unit_cost_minor) || 0),
    0,
  );
}

/** Validate a receipt against a line. Over-receipt is allowed (vendors do ship
 *  extra) but zero, negative and non-integer amounts are not, and a closed PO
 *  cannot be received into. */
export function validateReceipt(line, qtyMilli, poStatus = "ordered") {
  if (!line) return { ok: false, error: "That purchase order line no longer exists." };
  if (poStatus === "cancelled") return { ok: false, error: "This purchase order was cancelled." };
  if (poStatus === "received") return { ok: false, error: "This purchase order is already fully received." };
  if (!isInt(qtyMilli) || qtyMilli <= 0) return { ok: false, error: "Enter how much arrived." };
  return { ok: true, qtyMilli };
}
