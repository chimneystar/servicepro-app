import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// A refused write must say so.
//
// `actionFailureMessage` treats an absent result as SUCCESS, deliberately: some
// actions predate the `{ ok, error }` contract and inventing failures for them
// would be its own bug. The cost of that decision is that an action which
// `return;`s on a refusal is INDISTINGUISHABLE from one that succeeded.
//
// `reviewManualPayment` was exactly that, on money. It returned bare on every
// refusal including the authorization check, so an office user without
// `can_confirm_manual_payments` pressed "Confirm received", the page refreshed,
// and the payment was still sitting there unexplained.
//
// `submitPortalRequest` was the customer-facing twin: the RPC's `error` was
// destructured away and never read, so a customer asking for a different date
// got their message back empty with no explanation.
//
// There is a second trap, and it is why two of these tests are about markup
// rather than about actions. `<form action={serverAction}>` inside a SERVER
// component DISCARDS the return value — so an action can report its refusals
// perfectly and still be silent in practice. Fixing the action alone would have
// looked complete and changed nothing a user sees.
// ---------------------------------------------------------------------------

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const APP = path.join(ROOT, "app");
const actionFiles = walk(APP).filter((f) => f.endsWith("actions.ts"));
const tsxFiles = walk(APP).filter((f) => f.endsWith(".tsx"));

test("no server action returns bare on a refusal path", () => {
  // `return;` inside an exported action means "I decided not to do it" and says
  // nothing. Every such path must carry a result the caller can show.
  const offenders = [];
  for (const file of actionFiles) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (!/^"use server"/m.test(src)) continue;
    // Only look inside exported async functions, and stop at the next one.
    const fns = src.split(/\nexport async function /).slice(1);
    for (const fn of fns) {
      const name = fn.slice(0, fn.indexOf("(")).trim();
      // A bare `return;` at any nesting level.
      if (/\n\s*return\s*;/.test(fn)) {
        offenders.push(`${path.relative(ROOT, file)} :: ${name}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these actions return bare on at least one path, which the contract reads as SUCCESS:\n  " +
      offenders.join("\n  "),
  );
});

test("the two actions this was found on report every refusal", () => {
  const payments = stripComments(
    readFileSync(path.join(APP, "(app)/settings/payments/actions.ts"), "utf8"),
  );
  const review = payments.slice(payments.indexOf("export async function reviewManualPayment"));
  const body = review.slice(0, review.indexOf("\nexport async function "));

  // The authorization refusal specifically — the one that silently did nothing.
  assert.match(
    body,
    /if \(!allowed\)\s*\n?\s*return \{ ok: false/,
    "an office user without permission must be told, not silently ignored",
  );
  assert.ok(/return \{ ok: true \}/.test(body), "and the successful path must confirm");

  const portal = stripComments(readFileSync(path.join(APP, "portal/[token]/actions.ts"), "utf8"));
  assert.match(portal, /const \{ data, error \}/, "the RPC error must be read, not discarded");
  assert.match(portal, /if \(error\)/, "and acted on");
  assert.match(portal, /data !== true/, "a refusal by the RPC is distinct from an error");
});

test("no server-component form discards a reporting action's result", () => {
  // `<form action={someAction}>` in a server component throws the return value
  // away. An action that reports its refusals is still silent there.
  const REPORTING = ["reviewManualPayment", "submitPortalRequest"];
  const offenders = [];
  for (const file of tsxFiles) {
    const src = stripComments(readFileSync(file, "utf8"));
    if (/^"use client"/m.test(src)) continue; // a client component reads the result
    for (const action of REPORTING) {
      if (new RegExp(`action=\\{${action}[\\s.}]`).test(src)) {
        offenders.push(`${path.relative(ROOT, file)} -> ${action}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these server components pass a reporting action straight to <form action>, which discards " +
      "its result:\n  " +
      offenders.join("\n  "),
  );
});

test("the client wrappers actually surface what came back", () => {
  for (const file of [
    "app/(app)/settings/payments/ManualPaymentReview.tsx",
    "app/portal/[token]/PortalRequestForm.tsx",
  ]) {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    assert.match(src, /^"use client"/m, `${file} must be a client component`);
    assert.match(src, /useActionStatus/, `${file} must use the shared contract hook`);
    // Rendering the error is the entire point; a wrapper that keeps it in state
    // and never displays it is the original bug with extra steps.
    assert.match(src, /\{error &&/, `${file} must render the error`);
    assert.match(src, /role="alert"/, `${file} must announce it`);
  }
});

test("the portal tells a customer the request actually went", () => {
  // A customer has no dashboard and no account. Without an explicit
  // confirmation they cannot tell a delivered request from a discarded one —
  // which is the same ambiguity, pointed the other way.
  const src = readFileSync(path.join(ROOT, "app/portal/[token]/PortalRequestForm.tsx"), "utf8");
  assert.match(src, /successMessage/, "success must be stated");
  assert.match(src, /role="status"/, "and announced");
});
