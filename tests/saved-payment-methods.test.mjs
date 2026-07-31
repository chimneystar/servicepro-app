import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 5.3 — SAVED PAYMENT METHODS: DELIBERATELY NOT BUILT.
//
// `payment_settings.save_methods_enabled` defaults to true and is rendered as
// "Allow saved payment methods — only after clear customer consent". Nothing
// has ever stored a card token, and nothing can: reusable Helcim card
// tokenisation needs vault credentials that do not exist in this environment,
// there is no table to hold a token, and the one provider call this codebase
// makes (lib/payments/refunds.ts) has itself never been exercised against
// Helcim for want of sandbox credentials.
//
// Faking it would be the worst available outcome: a business would tell its
// customers their card is on file, and there would be no card. So the switch is
// made HONEST instead — presented as unavailable, saying why, and with the
// stored preference preserved untouched so nothing is silently rewritten.
//
// These assertions exist to stop the toggle quietly becoming a lie again.
// ---------------------------------------------------------------------------

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readRaw = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("the comment stripping these guards rely on actually works", () => {
  const stripped = read("app/(app)/settings/payments/PaymentSettingsForm.tsx");
  assert.ok(!/worst available outcome|Storing a reusable card/i.test(stripped), "block comments must be removed");
  assert.ok(/save_methods_enabled/.test(stripped), "code must survive stripping");
});

test("the switch tells the truth: saved methods are not available", () => {
  const form = read("app/(app)/settings/payments/PaymentSettingsForm.tsx");
  const control = form.slice(form.indexOf('name="save_methods_enabled"'));
  assert.ok(/disabled/.test(control.slice(0, 400)),
    "a switch a business can turn on must do something; this one cannot, so it must not be operable");
  assert.ok(/not available yet/i.test(form) || /Not available yet/.test(form),
    "and it must say so in the label, where the owner reads it");
  // The old copy promised a capability.
  assert.ok(!/Only after clear customer consent\./.test(form),
    "copy implying cards are saved once consent is given must be gone");
});

test("saving the settings form does not silently switch the stored preference off", () => {
  // A disabled checkbox is not submitted by the browser. Reading the form for
  // this key would rewrite the stored value to false on every save — a settings
  // screen quietly editing a field it is not showing.
  const actions = read("app/(app)/settings/payments/actions.ts");
  assert.ok(!/save_methods_enabled: enabled\(formData/.test(actions),
    "the form must not be the source for a control the form does not submit");
  assert.ok(/save_methods_enabled: current\?\.save_methods_enabled/.test(actions),
    "the stored value must be carried through untouched");
});

test("nothing in the product pretends to store a card token", () => {
  // If this ever fails, saved methods are being half-built and the ledger entry
  // must move off PARTIAL with a real implementation behind it.
  for (const file of ["lib/payments/server.ts", "lib/payments/deposits.ts", "lib/payments/booking-deposit.ts", "components/CustomerPaymentOptions.tsx"]) {
    const src = read(file);
    assert.ok(!/card_token|cardToken|saved_payment_method|customerCode/.test(src),
      `${file} must not carry a stored-card token: none can be stored safely here`);
  }
});

test("the limitation is written where the next person will see it", () => {
  const plan = readRaw("docs/REMEDIATION-PLAN.md");
  const row = plan.split("\n").find((line) => line.includes("| 5.3 |"));
  assert.ok(row, "the ledger must still have a row for saved payment methods");
  assert.ok(/PARTIAL/.test(row), "an unbuildable feature must never be marked DONE");
  assert.ok(/tokenis|token/i.test(row), "and the row must say what is actually missing");
});
