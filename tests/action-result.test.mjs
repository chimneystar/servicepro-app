// Guards for ledger item 4.10 — writes that failed and looked like they hadn't.
//
// Two patterns were in play:
//   * ~26 client call sites did `start(async () => { await action(); router.refresh(); })`
//     and threw the `{ ok, error }` result away.
//   * 21 server actions in /operations and /growth returned bare `void` and
//     dropped the Supabase error entirely.
//
// Behaviour first, then structure. The structural half strips comments before
// scanning, because these files now describe the discarding pattern in prose
// and a naive scan would match the description instead of the code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionFailureMessage, actionFailed, fallbackMessage } from "../lib/core/action-result.mjs";

// ---------------------------------------------------------------------------
// The decision itself.
// ---------------------------------------------------------------------------

test("a refused write always produces a message", () => {
  assert.equal(
    actionFailureMessage({ ok: false, error: "Row level security" }),
    "Row level security",
  );
  assert.equal(
    actionFailureMessage({ ok: false }),
    fallbackMessage(false),
    "a failure with no reason still has to say something",
  );
  assert.equal(actionFailureMessage({ ok: false, error: "" }), fallbackMessage(false));
  assert.equal(
    actionFailureMessage({ ok: false, error: "   " }),
    fallbackMessage(false),
    "whitespace is not an explanation",
  );
  assert.equal(actionFailed({ ok: false }), true);
});

test("a successful write produces NO message — the guard does not cry wolf", () => {
  // The other half of the both-ways proof. A banner that appears on every save
  // gets ignored within a day, which puts us back where we started.
  assert.equal(actionFailureMessage({ ok: true }), null);
  assert.equal(actionFailureMessage({ ok: true, error: "ignored" }), null);
  assert.equal(actionFailed({ ok: true }), false);
});

test("actions that predate the contract are treated as success, not invented failures", () => {
  for (const result of [undefined, null, void 0]) {
    assert.equal(
      actionFailureMessage(result),
      null,
      `${String(result)} must not be reported as a failure`,
    );
  }
  assert.equal(actionFailureMessage({ ok: true, newId: "abc" }), null, "extra fields are fine");
  assert.equal(actionFailureMessage({ sent: true }), null, "no ok field at all is not a failure");
});

test("the failure message is localised", () => {
  assert.notEqual(fallbackMessage(true), fallbackMessage(false));
  assert.match(fallbackMessage(true), /[֐-׿]/, "the Hebrew fallback must actually be Hebrew");
  assert.equal(actionFailureMessage({ ok: false }, true), fallbackMessage(true));
});

// ---------------------------------------------------------------------------
// Structural guards.
// ---------------------------------------------------------------------------

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Matches a server-action call whose result is thrown away: an `await f(...)`
 * that begins a statement rather than being assigned or returned.
 *
 * `const r = await f()` is preceded by `=`, `return await f()` by a word — only
 * a bare statement is preceded by `{`, `;`, `(` or the start of the file.
 */
const DISCARDED_AWAIT = /(?:^|[;{]|=>\s*)\s*await\s+[A-Za-z_$][\w$]*\s*\(/m;

test("the discarded-await pattern detector recognises the real bug, and only it", () => {
  // Prove the detector before trusting twenty assertions built on it.
  assert.ok(
    DISCARDED_AWAIT.test("start(async () => { await setJobStage(jobId, s); router.refresh(); });"),
    "this is the exact shape that was shipped 26 times",
  );
  assert.ok(DISCARDED_AWAIT.test("await deleteLead(id);"));
  assert.equal(
    DISCARDED_AWAIT.test("const r = await deleteLead(id);"),
    false,
    "an assigned result is not discarded",
  );
  assert.equal(
    DISCARDED_AWAIT.test("return await deleteLead(id);"),
    false,
    "a returned result is not discarded",
  );
  assert.equal(DISCARDED_AWAIT.test("const { data } = await supabase.from('x').select();"), false);
});

// Every client component that used to discard the result of a server action.
const CALL_SITES = [
  "components/JobActions.tsx",
  "components/JobChecklist.tsx",
  "components/JobTasks.tsx",
  "components/JobTagsEditor.tsx",
  "components/JobItems.tsx",
  "components/JobEquipment.tsx",
  "components/JobExpensesField.tsx",
  "components/JobAddressForm.tsx",
  "components/JobFieldTools.tsx",
  "components/DocList.tsx",
  "components/DocDetailActions.tsx",
  "components/CommissionClient.tsx",
  "components/ReviewForm.tsx",
  "components/SetupChecklist.tsx",
  "components/RecurringClient.tsx",
  "app/(app)/leads/LeadsBoard.tsx",
  "app/(app)/team/TeamClient.tsx",
  "app/(app)/archive/ArchiveList.tsx",
];

test("no client component discards the result of a server action", () => {
  const offenders = [];
  for (const file of CALL_SITES) {
    for (const line of read(file).split("\n")) {
      if (DISCARDED_AWAIT.test(line)) offenders.push(`${file}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a discarded {ok,error} makes a refused write look identical to a saved one",
  );
});

test("every one of those components can actually show a failure", () => {
  const missing = CALL_SITES.filter((file) => {
    const src = read(file);
    // Either it uses the shared status hook, or it keeps its own error state
    // and renders it. Both are fine; silence is not.
    return (
      !/useActionStatus|ActionError/.test(src) &&
      !/set(Err|Error|Msg|Message|Toast|Notice)/.test(src)
    );
  });
  assert.deepEqual(missing, [], "these components have nowhere to put an error");
});

test("JobActions no longer paints success in the error colour", () => {
  const src = read("components/JobActions.tsx");
  assert.ok(
    !/msg\.startsWith\("✓"\)/.test(src),
    'success was decided by a leading "✓" that the success string ("Invoice created") never had, so a created invoice rendered in red',
  );
  assert.ok(
    /#15803d/.test(src) && /ActionError/.test(src),
    "success and failure must be separate states, not inferred from the text",
  );
});

test("the recurring plans banner is no longer hard-coded green", () => {
  const src = read("components/RecurringClient.tsx");
  assert.ok(
    !/background: "#e6f6ec", color: "#15803d", padding: "9px 12px"/.test(src),
    "an error reported in the success colour is the same bug as no error at all",
  );
  assert.ok(/msg\.ok \?/.test(src), "tone must be carried with the message");
});

// ---------------------------------------------------------------------------
// The void server actions.
// ---------------------------------------------------------------------------

const VOID_ACTIONS = {
  "app/(app)/operations/actions.ts": [
    "createCrew",
    "createServiceArea",
    "createAutomation",
    "createVendor",
    "createPurchaseOrder",
    "createSubcontractor",
  ],
  "app/(app)/growth/actions.ts": [
    "createCampaign",
    "createReferralProgram",
    "recordAdSpend",
    "scheduleEstimateFollowup",
  ],
};

test("every /operations and /growth action returns the house {ok,error} contract", () => {
  for (const [file, names] of Object.entries(VOID_ACTIONS)) {
    const src = read(file);
    for (const name of names) {
      const signature = new RegExp(
        `export async function ${name}\\([^)]*\\):\\s*Promise<ActionResult>`,
      );
      assert.ok(
        signature.test(src),
        `${file}#${name} must declare Promise<ActionResult>, not void`,
      );
    }
    assert.ok(
      /export type ActionResult = \{ ok: boolean; error\?: string \}/.test(src),
      `${file} must use the same shape as app/(app)/customers/actions.ts`,
    );
  }
});

test("no /operations or /growth action ignores the Supabase error", () => {
  for (const file of Object.keys(VOID_ACTIONS)) {
    const src = read(file);
    // `await supabase.from(...)` with nothing destructured off it is the shape
    // that dropped the error: the row was never written and nobody was told.
    assert.ok(
      !/(?:^|[;{]|=>\s*)\s*await\s+ctx\.supabase\.from\(/m.test(src),
      `${file} still has an insert whose error is discarded`,
    );
    assert.ok(!/return;\s*\/\/ malformed/.test(src), `${file} still returns silently on bad input`);
    const inserts = (src.match(/\.from\("[a-z_]+"\)\.insert\(/g) ?? []).length;
    const checks = (src.match(/if \(\s*!?[a-zA-Z]*[eE]rror\b/g) ?? []).length;
    assert.ok(checks >= inserts, `${file}: ${inserts} inserts but only ${checks} error checks`);
  }
});

test("/operations and /growth actually render what the action said", () => {
  for (const page of ["app/(app)/operations/page.tsx", "app/(app)/growth/page.tsx"]) {
    const src = read(page);
    assert.ok(
      !/<form action=\{create/.test(src) &&
        !/<form action=\{record/.test(src) &&
        !/<form action=\{schedule/.test(src),
      `${page} still posts to a bare <form>, which cannot show a result`,
    );
    assert.ok(/<ActionForm/.test(src), `${page} must use the form that surfaces {ok,error}`);
  }
  const form = read("components/ActionForm.tsx");
  assert.ok(
    /state\.error/.test(form) && /role="alert"/.test(form),
    "the error must reach the screen",
  );
  assert.ok(/useActionState/.test(form));
});

test("/operations and /growth keep every form they had", () => {
  // Rewiring the forms must not lose one. FEATURE-INVENTORY.md is a contract.
  const ops = readFileSync(new URL("../app/(app)/operations/page.tsx", import.meta.url), "utf8");
  for (const name of VOID_ACTIONS["app/(app)/operations/actions.ts"]) {
    assert.ok(ops.includes(`action={${name}}`), `operations lost its ${name} form`);
  }
  for (const heading of [
    "Crews",
    "Service areas",
    "Automations",
    "Vendors",
    "Purchase orders",
    "Subcontractors",
  ]) {
    assert.ok(ops.includes(heading), `operations lost the ${heading} section`);
  }
  const growth = readFileSync(new URL("../app/(app)/growth/page.tsx", import.meta.url), "utf8");
  for (const name of VOID_ACTIONS["app/(app)/growth/actions.ts"]) {
    assert.ok(growth.includes(`action={${name}}`), `growth lost its ${name} form`);
  }
});
