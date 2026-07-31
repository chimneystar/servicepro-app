import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codeShape } from "./helpers/source-shape.mjs";
import {
  defaultDepositMinor,
  bookingDepositMinor,
  DEPOSIT_TYPES,
  BOOKING_PAYMENT_MODES,
} from "../lib/core/deposits.mjs";

// ---------------------------------------------------------------------------
// 5.6 — payment_settings.default_deposit_type/_bps/_minor was saved by
// /settings/payments and READ BY NO DOCUMENT CODE. Every estimate was created
// with deposit_minor = 0.
// 5.7 — booking_settings.payment_mode / deposit_value were shown to the
// customer as a promise of a payment link, and charged nothing.
// ---------------------------------------------------------------------------

test("a percentage default deposit is applied, exactly", () => {
  // Stated first: a deposit rule that never fires is the defect being fixed.
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 2500 }, 100000),
    25000,
  );
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 3333 }, 100000),
    33330,
  );
});

test("a fixed default deposit is applied, exactly", () => {
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "fixed", default_deposit_minor: 15000 }, 100000),
    15000,
  );
});

test("'none' means none", () => {
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "none", default_deposit_bps: 5000 }, 100000),
    0,
  );
  assert.deepEqual(DEPOSIT_TYPES, ["none", "percent", "fixed"]);
});

test("percentage rounding is half-up integer arithmetic", () => {
  // 33.33% of $10.01 = 333.6333 cents. Integer half-up gives 334.
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 3333 }, 1001),
    334,
  );
  // Exactly half rounds up rather than to-even, deterministically.
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 5000 }, 3),
    2,
  );
});

test("a deposit can never exceed the document it belongs to", () => {
  // A $500 fixed deposit on a $200 job would leave a balance that can never be
  // settled and an invoice that never flips to paid.
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "fixed", default_deposit_minor: 50000 }, 20000),
    20000,
  );
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 10000 }, 20000),
    20000,
  );
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 99999 }, 20000),
    20000,
  );
});

test("a zero or negative document total asks for nothing", () => {
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 2500 }, 0),
    0,
  );
  assert.equal(
    defaultDepositMinor({ default_deposit_type: "percent", default_deposit_bps: 2500 }, -100),
    0,
  );
});

test("a malformed settings row yields no deposit, never NaN", () => {
  // NaN here would make deposit_minor unstorable and break estimate creation
  // for the whole organisation.
  for (const bad of [
    null,
    undefined,
    {},
    { default_deposit_type: "sometimes" },
    { default_deposit_type: "percent", default_deposit_bps: "lots" },
  ]) {
    const value = defaultDepositMinor(bad, 100000);
    assert.ok(Number.isInteger(value), `${JSON.stringify(bad)} must yield an integer`);
    assert.equal(value, 0);
  }
});

// ---------------------------------------------------------------------------
// Booking deposits.
// ---------------------------------------------------------------------------

test("each booking payment mode produces the deposit it promises", () => {
  const price = 40000; // $400 service
  assert.equal(bookingDepositMinor({ mode: "none", value: 50, servicePriceMinor: price }), 0);
  assert.equal(
    bookingDepositMinor({ mode: "percentage", value: 50, servicePriceMinor: price }),
    20000,
  );
  assert.equal(bookingDepositMinor({ mode: "full", value: 0, servicePriceMinor: price }), 40000);
  // 'fixed' is whole currency units: the settings input is step=1 and cannot
  // express cents, so reading it as minor units would turn a $75 deposit into
  // 75 cents.
  assert.equal(bookingDepositMinor({ mode: "fixed", value: 75, servicePriceMinor: price }), 7500);
  assert.deepEqual(BOOKING_PAYMENT_MODES, ["none", "fixed", "percentage", "full"]);
});

test("a booking deposit never exceeds the price the customer was shown", () => {
  assert.equal(bookingDepositMinor({ mode: "fixed", value: 900, servicePriceMinor: 40000 }), 40000);
  assert.equal(
    bookingDepositMinor({ mode: "percentage", value: 150, servicePriceMinor: 40000 }),
    40000,
  );
});

test("a service with no price collects no deposit at all", () => {
  // A free inspection, or a business that never filled the price in. Charging a
  // fixed deposit against a priceless booking would be charging for something
  // with no stated value.
  for (const mode of BOOKING_PAYMENT_MODES) {
    assert.equal(
      bookingDepositMinor({ mode, value: 50, servicePriceMinor: 0 }),
      0,
      `${mode} must not charge`,
    );
  }
});

test("a malformed booking setting collects nothing rather than a NaN charge", () => {
  for (const bad of [
    { mode: "percentage", value: "half", servicePriceMinor: 40000 },
    { mode: "wat", value: 50, servicePriceMinor: 40000 },
    {},
  ]) {
    const value = bookingDepositMinor(bad);
    assert.ok(Number.isInteger(value));
    assert.equal(value, 0);
  }
});

// ---------------------------------------------------------------------------
// Structural. Comments stripped first, so prose describing the defect cannot
// satisfy a check.
// ---------------------------------------------------------------------------

// Comments are stripped so a comment ABOUT a defect cannot satisfy a check for
// its absence, and the token stream is canonicalised so these probes keep
// asserting the CALL and its ARGUMENTS rather than where Prettier wrapped the
// line (ledger 6.4). This replaces a hand-rolled `//`-stripper that had to
// special-case `https://`; the parser has no such problem. Proven both ways in
// tests/source-shape.test.mjs.
const read = (p) => codeShape(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"), p);
const readSql = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");

test("the comment stripping these guards rely on actually works", () => {
  const sql = readSql("db/031_payment_features.sql");
  assert.ok(!/READ BY NO\s*DOCUMENT CODE/i.test(sql), "SQL comments must be removed");
  assert.ok(/apply_default_estimate_deposit/.test(sql), "SQL must survive stripping");
});

test("the organisation default deposit is applied where it cannot be forgotten", () => {
  const sql = readSql("db/031_payment_features.sql");
  // lib/documents.ts is the single insert path for estimates AND invoices and
  // returns no id, so an application-side default would have to guess which
  // estimate it had just made. The rule lives at the insert instead.
  assert.ok(/create or replace function public\.apply_default_estimate_deposit/.test(sql));
  assert.ok(/before insert on public\.estimates/.test(sql));
  assert.ok(
    /coalesce\(new\.deposit_minor, 0\) <> 0/.test(sql),
    "an explicitly chosen deposit must be left exactly as given",
  );
  assert.ok(/least\(/.test(sql), "the deposit must be clamped to the document total");
  // The three branches must match defaultDepositMinor(): percent, fixed, none.
  assert.ok(/default_deposit_type = 'percent'/.test(sql));
  assert.ok(/default_deposit_type = 'fixed'/.test(sql));
});

test("the migration drops nothing", () => {
  const sql = readSql("db/031_payment_features.sql");
  assert.ok(!/drop\s+table/i.test(sql), "no table may be dropped");
  assert.ok(!/drop\s+column/i.test(sql), "no column may be dropped");
  assert.ok(!/drop\s+policy/i.test(sql), "no policy may be dropped");
  assert.ok(!/\bdelete\s+from\b/i.test(sql), "no row may be deleted");
  // Every added column and index must be idempotent.
  const adds = sql.match(/alter table [a-z_.]+ add column/gi) ?? [];
  const idempotent = sql.match(/alter table [a-z_.]+ add column if not exists/gi) ?? [];
  assert.equal(adds.length, idempotent.length, "every added column must use IF NOT EXISTS");
  const indexes = sql.match(/create (?:unique )?index/gi) ?? [];
  const safeIndexes = sql.match(/create (?:unique )?index if not exists/gi) ?? [];
  assert.equal(indexes.length, safeIndexes.length, "every index must use IF NOT EXISTS");
});

test("the booking deposit is charged through the payment screen that already works", () => {
  const src = read("lib/payments/booking-deposit.ts");
  assert.ok(
    /bookingDepositMinor\(/.test(src),
    "the deposit must be computed from booking_settings",
  );
  assert.ok(/from\("estimates"\)\.insert/.test(src), "and raised as a real document");
  assert.ok(/deposit_minor:/.test(src));
  assert.ok(
    /allocate_document_number/.test(src),
    "next_document_number() requires current_org_id(), which is null for the service-role booking endpoint",
  );

  const route = read("app/api/booking/[org]/submit/route.ts");
  assert.ok(/raiseBookingDeposit\(/.test(route), "the booking endpoint must actually raise it");
  assert.ok(
    /deposit:\{amountMinor/.test(route.replace(/\s/g, "")) ||
      /deposit=\{amountMinor/.test(route.replace(/\s/g, "")),
    "and return the link, or the customer still cannot pay",
  );

  const form = read("app/book/[org]/BookingForm.tsx");
  assert.ok(/result\.deposit/.test(form), "and the confirmation screen must show it");
  assert.ok(
    !/a secure payment link will be sent after confirmation/.test(form),
    "the promise of a link nobody ever sent must be gone",
  );
});

test("a booking deposit does not create a job until the money is in", () => {
  const route = read("app/api/booking/[org]/submit/route.ts");
  const src = read("lib/payments/booking-deposit.ts");
  assert.ok(
    /auto_release_on_deposit/.test(route) && /auto_release_on_deposit/.test(src),
    "a business that requires approval must still get to approve",
  );
  assert.ok(
    /estimateDepositRelease\(/.test(src),
    "the release must consult the money, not the calendar",
  );
  assert.ok(
    /lead\.status\s*===\s*"won"/.test(src),
    "a redelivered webhook must not put a second job on the calendar",
  );
});
