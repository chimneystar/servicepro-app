import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripSqlComments } from "./helpers/sql.mjs";
import {
  OPTION_TIERS,
  isTier,
  tierRank,
  sortOptions,
  optionTotals,
  optionDepositMinor,
  canSelectOption,
  validateSelection,
  conversionReadiness,
  tierLabel,
  describeOptions,
} from "../lib/core/estimate-options.mjs";
import { computeDocument } from "../lib/core/money.mjs";

// ---------------------------------------------------------------------------
// 6c.4 — the app could only ever produce one flat price. Options must not break
// deposits (db/024) or conversion.
// ---------------------------------------------------------------------------

const good = {
  id: "o1",
  tier: "good",
  title: "Repair",
  deposit_minor: 0,
  items: [{ qty_milli: 1000, unit_price_minor: 50000, taxable: true }],
};
const better = {
  id: "o2",
  tier: "better",
  title: "Repair + service",
  deposit_minor: 10000,
  recommended: true,
  items: [{ qty_milli: 1000, unit_price_minor: 80000, taxable: true }],
};
const best = {
  id: "o3",
  tier: "best",
  title: "Replace",
  deposit_minor: 0,
  items: [
    { qty_milli: 1000, unit_price_minor: 250000, taxable: true },
    { qty_milli: 2000, unit_price_minor: 7500, taxable: false },
  ],
};

test("the tiers are fixed and ordered cheapest-first", () => {
  assert.deepEqual(OPTION_TIERS, ["good", "better", "best"]);
  assert.equal(isTier("better"), true);
  assert.equal(isTier("platinum"), false);
  assert.ok(tierRank("good") < tierRank("better") && tierRank("better") < tierRank("best"));
  assert.deepEqual(
    sortOptions([best, good, better]).map((o) => o.tier),
    ["good", "better", "best"],
  );
});

test("an option is priced through the SAME engine as every other document", () => {
  const context = { discountMinor: 0, taxRateBps: 825 };
  const mine = optionTotals(best, context);
  const engine = computeDocument({
    items: [
      { qtyMilli: 1000, unitPriceMinor: 250000, taxable: true },
      { qtyMilli: 2000, unitPriceMinor: 7500, taxable: false },
    ],
    discountMinor: 0,
    taxRateBps: 825,
  });
  // Two totals computed two ways is how a customer is shown one price and
  // billed another. There is only one engine.
  assert.deepEqual(mine, engine);
  assert.equal(mine.totalMinor, 250000 + 15000 + Math.round(250000 * 0.0825));
});

test("a document-level discount reaches the option's total", () => {
  assert.equal(optionTotals(good, { discountMinor: 5000, taxRateBps: 0 }).totalMinor, 45000);
});

test("an option's own deposit wins", () => {
  assert.equal(
    optionDepositMinor({ optionDeposit: 10000, estimateDeposit: 3000, totalMinor: 80000 }),
    10000,
  );
});

test("an option with no deposit KEEPS the organisation default (5.6 survives)", () => {
  // Migration 031 applies the org default at insert. Choosing an option must
  // not silently cancel a deposit the business configured.
  assert.equal(
    optionDepositMinor({ optionDeposit: 0, estimateDeposit: 25000, totalMinor: 80000 }),
    25000,
  );
});

test("a deposit is CLAMPED to the chosen option's total", () => {
  // A cheaper option must never leave a deposit larger than the job: that would
  // ask for money the invoice can never absorb and would break the 024 credit.
  assert.equal(
    optionDepositMinor({ optionDeposit: 0, estimateDeposit: 90000, totalMinor: 50000 }),
    50000,
  );
  assert.equal(
    optionDepositMinor({ optionDeposit: 99999, estimateDeposit: 0, totalMinor: 40000 }),
    40000,
  );
});

test("a SIGNED estimate cannot be re-priced by choosing an option", () => {
  // Re-pricing under an existing signature defeats 023 §6's sign-once guard as
  // thoroughly as re-signing would.
  assert.deepEqual(canSelectOption({ id: "e1", signed_at: "2026-07-01T10:00:00Z" }), {
    ok: false,
    error: "already_signed",
  });
  assert.deepEqual(canSelectOption({ id: "e1", deleted_at: "2026-07-01T10:00:00Z" }), {
    ok: false,
    error: "not_found",
  });
  assert.deepEqual(canSelectOption(null), { ok: false, error: "not_found" });
  assert.deepEqual(canSelectOption({ id: "e1" }), { ok: true });
});

test("an option from another estimate is refused, not guessed", () => {
  const estimate = { id: "e1" };
  assert.equal(validateSelection({ estimate, options: [good, better], optionId: "o1" }).ok, true);
  assert.deepEqual(validateSelection({ estimate, options: [good, better], optionId: "o9" }), {
    ok: false,
    error: "unknown_option",
  });
});

test("an estimate WITH options and none chosen must NOT convert", () => {
  // This is what makes "the chosen option is what converts" true rather than
  // likely: estimate_items at that moment is whatever was last written.
  assert.equal(conversionReadiness({ optionCount: 3, selectedOptionId: null }).ok, false);
  assert.equal(
    conversionReadiness({ optionCount: 3, selectedOptionId: null }).reason,
    "option_not_chosen",
  );
});

test("an estimate with a CHOICE converts, and one with no options is unaffected", () => {
  assert.equal(conversionReadiness({ optionCount: 3, selectedOptionId: "o2" }).ok, true);
  // Every estimate that exists today has no options and must keep converting.
  assert.deepEqual(conversionReadiness({ optionCount: 0, selectedOptionId: null }), {
    ok: true,
    reason: "no_options",
  });
});

test("the chooser shows the upgrade from the cheapest, not three loose numbers", () => {
  const rows = describeOptions([best, good, better], { taxRateBps: 0, estimateDeposit: 0 });
  assert.deepEqual(
    rows.map((row) => row.tier),
    ["good", "better", "best"],
  );
  assert.equal(rows[0].upgradeMinor, 0);
  assert.equal(rows[1].upgradeMinor, 30000);
  assert.equal(rows[2].upgradeMinor, 215000);
  assert.equal(rows[1].recommended, true);
});

test("tier labels exist in both languages", () => {
  assert.equal(tierLabel("better", "en"), "Better");
  assert.equal(tierLabel("better", "he"), "מומלץ");
  assert.equal(tierLabel("nonsense", "en"), "nonsense");
});

// ---------------------------------------------------------------------------
// Structural. Comments stripped first.
// ---------------------------------------------------------------------------
const migration = stripSqlComments(
  readFileSync(new URL("../db/039_scheduling_sales.sql", import.meta.url), "utf8"),
);
const estimateActions = stripSqlComments(
  readFileSync(new URL("../app/(app)/estimates/actions.ts", import.meta.url), "utf8"),
);
const publicPage = stripSqlComments(
  readFileSync(new URL("../app/p/[token]/page.tsx", import.meta.url), "utf8"),
);
const chooser = stripSqlComments(
  readFileSync(new URL("../app/p/[token]/OptionChooser.tsx", import.meta.url), "utf8"),
);

test("options are bundles of lines on ONE estimate, tenant-safe by FK", () => {
  assert.match(migration, /create table if not exists public\.estimate_options/);
  assert.match(migration, /create table if not exists public\.estimate_option_items/);
  assert.match(
    migration,
    /foreign key \(estimate_id, organization_id\)\s*references public\.estimates\(id, organization_id\)/,
  );
  assert.match(migration, /unique \(estimate_id, tier\)/);
});

test("the estimate row is NOT replaced — the deposit chain in 024 survives", () => {
  // 024 credits a deposit through invoices.estimate_id -> payments.estimate_id.
  // Choosing an option must not mint a new estimate or move the public token.
  const rpc = /create or replace function public\.select_estimate_option[\s\S]*?\$\$;/.exec(
    migration,
  );
  assert.ok(rpc, "select_estimate_option must exist");
  assert.doesNotMatch(rpc[0], /insert into public\.estimates/i);
  assert.doesNotMatch(rpc[0], /public_token\s*=\s*gen_random_uuid/i);
  assert.match(rpc[0], /update public\.estimates/);
  assert.match(rpc[0], /delete from public\.estimate_items/);
  assert.match(rpc[0], /insert into public\.estimate_items/);
});

test("the RPC refuses a signed estimate and an option from elsewhere", () => {
  const rpc = /create or replace function public\.select_estimate_option[\s\S]*?\$\$;/.exec(
    migration,
  )[0];
  assert.match(rpc, /signed_at is not null/);
  assert.match(rpc, /'already_signed'/);
  assert.match(rpc, /estimate_id = e\.id/);
  assert.match(rpc, /'unknown_option'/);
});

test("the RPC clamps the deposit to the chosen total", () => {
  const rpc = /create or replace function public\.select_estimate_option[\s\S]*?\$\$;/.exec(
    migration,
  )[0];
  assert.match(
    rpc,
    /least\(case when opt\.deposit_minor > 0 then opt\.deposit_minor else coalesce\(e\.deposit_minor, 0\) end, v_total\)/,
  );
});

test("public_document still returns every key it returned before, plus options", () => {
  const fn = /create or replace function public\.public_document[\s\S]*?\$\$;/.exec(migration);
  assert.ok(fn);
  for (const key of [
    "'kind'",
    "'number'",
    "'status'",
    "'issue_date'",
    "'notes'",
    "'discount_minor'",
    "'tax_rate_bps'",
    "'total_minor'",
    "'deposit_minor'",
    "'signer_name'",
    "'signed_at'",
    "'currency'",
    "'tax_label'",
    "'customer'",
    "'org'",
    "'items'",
  ]) {
    assert.match(
      fn[0],
      new RegExp(key.replace(/[$]/g, "")),
      `public_document must still return ${key}`,
    );
  }
  assert.match(fn[0], /'options', opts/);
  assert.match(fn[0], /'selected_option_id', sel/);
});

test("conversion refuses an unchosen options estimate, and still links the estimate", () => {
  const convert = /export async function convertEstimateToInvoice[\s\S]*?\n}/.exec(estimateActions);
  assert.ok(convert);
  assert.match(convert[0], /conversionReadiness/);
  // db/024's link must survive untouched — deposits are credited through it.
  assert.match(convert[0], /estimate_id: est\.id/);
  // And the idempotency guard from 2.6 is still there.
  assert.match(convert[0], /eq\("estimate_id", estimateId\)/);
});

test("the customer's page offers the chooser and calls the one RPC", () => {
  assert.match(publicPage, /OptionChooser/);
  assert.match(publicPage, /doc\.options/);
  assert.match(chooser, /select_estimate_option/);
});
