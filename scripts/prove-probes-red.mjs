#!/usr/bin/env node
/**
 * BOTH-WAYS PROOF for every structural probe that ledger 6.4 had to touch.
 *
 * WHY THIS EXISTS
 * ---------------
 * Reformatting the tree broke 16 probes that read source files as text and
 * asserted regexes against them. The tempting repair is to relax each regex
 * until it passes again — which turns a guard into decoration, and this
 * codebase already has three examples of exactly that (a booking test that
 * never ran, RLS assertions that were true for every table, an i18n parity
 * check comparing two empty strings).
 *
 * So every touched probe was rewritten to guard the same property against the
 * new formatting, and then re-proven HERE: this script plants a deliberate
 * violation of the property in the real source file, runs the probe, and
 * requires it to FAIL. The green run is the other half — `npm test` passes on
 * the unmutated tree.
 *
 * A probe that stays green under its planted violation is reported as a
 * FAILURE of this script, because that is a probe that no longer guards
 * anything.
 *
 * The source file is restored from an in-memory copy in a `finally`, so an
 * interrupted run cannot leave a mutation behind. `git stash` is never used —
 * the stash stack is shared across every worktree of this repository.
 *
 * USAGE
 *   node scripts/prove-probes-red.mjs            # all cases
 *   node scripts/prove-probes-red.mjs invitations  # cases whose id matches
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each case: the probe file, the source file to sabotage, the exact edit, and
 * the property that edit destroys. `find` must occur exactly once, so a case
 * can never silently become a no-op after an unrelated change.
 */
const CASES = [
  {
    id: "accessibility/a11y-rules-are-errors",
    probe: "tests/accessibility.test.mjs",
    source: "eslint.config.mjs",
    find: `"jsx-a11y/aria-role": "error"`,
    replace: `"jsx-a11y/aria-role": "warn"`,
    guards: "each named a11y rule is configured at severity error, not warn",
  },
  {
    id: "availability/slots-reads-approved-time-off",
    probe: "tests/availability.test.mjs",
    source: "app/api/booking/[org]/slots/route.ts",
    find: `.eq("status", "approved")`,
    replace: `.eq("status", "pending")`,
    guards: "the slots route filters time off to APPROVED requests",
  },
  {
    id: "availability/submit-applies-the-same-closed-windows",
    probe: "tests/availability.test.mjs",
    source: "app/api/booking/[org]/submit/route.ts",
    find: `closedWindows: availability.closedWindows`,
    replace: `closedWindows: []`,
    guards: "the POST enforces the same closed windows the slot list showed",
  },
  {
    id: "booking-locale/settings-reads-both-translations",
    probe: "tests/booking-locale.test.mjs",
    source: "app/(app)/settings/booking/page.tsx",
    find: `"id,name,name_en,name_he`,
    replace: `"id,name,name_en`,
    guards: "the booking settings screen reads the job type's own Hebrew name",
  },
  {
    id: "booking-locale/catalogue-matches-the-packs-row-for-row",
    probe: "tests/booking-locale.test.mjs",
    source: "lib/industry-packs.ts",
    find: `s("inspection", "Air duct system inspection", "בדיקת מערכת תעלות המיזוג"),`,
    replace: ``,
    guards: "every service declared in a pack is seeded by migration 041",
  },
  {
    id: "booking-locale/price-book-still-seeded",
    probe: "tests/booking-locale.test.mjs",
    source: "app/onboarding/page.tsx",
    find: `.from("price_book")`,
    replace: `.from("price_books")`,
    guards: "onboarding still seeds the price book from the chosen packs",
  },
  {
    id: "deposits/booking-deposit-raises-an-estimate",
    probe: "tests/deposits.test.mjs",
    source: "lib/payments/booking-deposit.ts",
    find: `.from("estimates")\n    .insert`,
    replace: `.from("estimates")\n    .upsert`,
    guards: "the booking deposit is raised as a real estimate document",
  },
  {
    id: "dispatch-integrity/recurring-sets-end-date",
    probe: "tests/dispatch-integrity.test.mjs",
    source: "app/(app)/recurring/actions.ts",
    find: `end_date: dueDate`,
    replace: `end_date: null`,
    guards: "the recurring generator writes end_date, so jobs cannot go phantom",
  },
  {
    id: "invitations/acceptance-passes-the-token",
    probe: "tests/invitations.test.mjs",
    source: "app/onboarding/page.tsx",
    find: `invite_token: inviteToken`,
    replace: `invite_token: null`,
    guards: "joining a business goes through the invitation TOKEN",
  },
  {
    id: "job-assignment/only-lead-rows-are-retired",
    probe: "tests/job-assignment-integrity.test.mjs",
    source: "app/(app)/dispatch/actions.ts",
    find: `.eq("is_lead", true)`,
    replace: `.eq("is_lead", false)`,
    guards: "reassignment deletes the stale LEAD row and leaves the crew alone",
  },
  {
    id: "job-photos/failed-toggle-is-surfaced",
    probe: "tests/job-status-and-photos.test.mjs",
    source: "components/JobPhotos.tsx",
    find: `if (!result.ok)\n      setError(`,
    replace: `if (!result.ok)\n      void (`,
    guards: "a failed visibility toggle sets an error instead of failing silently",
  },
  {
    id: "nav/module-is-compiled-from-the-real-source",
    probe: "tests/nav-reachability.test.mjs",
    source: "lib/nav.ts",
    find: `export function splitNavigation`,
    replace: `function splitNavigation`,
    guards: "the split executed by the test is the one lib/nav.ts exports",
  },
  {
    id: "outreach/refusals-are-recorded",
    probe: "tests/outreach.test.mjs",
    source: "lib/cron-tasks.ts",
    // Two write sites record a refusal (campaigns and dunning); the probe needs
    // only one to be present, so BOTH must be sabotaged for it to go red.
    find: `reason: eligibility.reason,`,
    replace: `reason: null,`,
    expectHits: 2,
    guards: "a customer deliberately not contacted is recorded with the reason",
  },
  {
    id: "push/dead-subscriptions-are-deleted",
    probe: "tests/push.test.mjs",
    source: "lib/push.ts",
    find: `.from("device_subscriptions")\n          .delete()`,
    replace: `.from("device_subscriptions")\n          .select()`,
    guards: "a subscription the push service reports gone is removed",
  },
  {
    id: "schedules/payment-schedule-is-written",
    probe: "tests/schedules.test.mjs",
    source: "lib/payments/deposits.ts",
    find: `.from("payment_schedules")\n    .insert`,
    replace: `.from("payment_schedules")\n    .upsert`,
    guards: "a payment schedule row is actually created",
  },
  {
    id: "staff-notifications/inbox-row-claimed-before-sending",
    probe: "tests/staff-notifications.test.mjs",
    source: "lib/notify.ts",
    find: `.from("staff_notifications")\n    .insert`,
    replace: `.from("staff_notifications")\n    .upsert`,
    guards: "the inbox row is claimed before the push is attempted",
  },

  // --- ledger 6.5, the design system --------------------------------------
  // The four ways a design system rots quietly, each planted in real source.
  {
    id: "design-system/tokens-are-used-not-duplicated",
    probe: "tests/design-system.test.mjs",
    source: "app/globals.css",
    find: `  background: var(--sp-accent);\n  color: var(--sp-text-on-accent);`,
    replace: `  background: #2563eb;\n  color: var(--sp-text-on-accent);`,
    guards: "no primitive spells a colour out again instead of reading the token",
  },
  {
    id: "design-system/a-primitive-cannot-be-repainted",
    probe: "tests/design-system.test.mjs",
    source: "app/globals.css",
    find: `--sp-text-muted: #5c6675;`,
    replace: `--sp-text-muted: #66728a;`,
    guards:
      "every primitive still paints exactly what the inline object it replaced painted — " +
      "this is the only thing standing in for a browser",
  },
  {
    id: "design-system/primitives-out-specify-the-sheet",
    probe: "tests/design-system.test.mjs",
    source: "app/globals.css",
    find: `.sp-notice.sp-notice.sp-notice {`,
    replace: `.sp-notice {`,
    guards:
      "a primitive rule out-specifies the ~200 element-targeting selectors already in " +
      "the sheet, as the inline style it replaced did",
  },
  {
    id: "design-system/accessible-name-cannot-be-hidden",
    probe: "tests/design-system.test.mjs",
    source: "components/ui/Select.tsx",
    find: `<select className={cls} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} {...rest} />`,
    replace: `<select className={cls} {...rest} />`,
    guards:
      "a control primitive forwards its accessible name visibly, where a static scan " +
      "can confirm it, rather than through a spread",
  },
  {
    id: "typography/the-type-scale-cannot-leave-rem",
    probe: "tests/typography.test.mjs",
    source: "app/globals.css",
    find: `--sp-font-sm: 0.8125rem;`,
    replace: `--sp-font-sm: 13px;`,
    guards:
      "the 6.5 type scale is resolved through var() and held to rem, so a token cannot " +
      "opt every primitive out of the Larger-text toggle at once",
  },
];

// The working tree is CRLF (core.autocrlf=true) while these anchors are written
// with `\n`, so every newline in a `find` matches either spelling.
function anchorRegExp(find) {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\n/g, "\\r?\\n");
  return new RegExp(escaped, "g");
}

function runProbe(probe) {
  try {
    execFileSync(process.execPath, ["--test", probe], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { failed: false, output: "" };
  } catch (err) {
    return { failed: true, output: String(err.stdout ?? "") };
  }
}

const filter = process.argv[2];
const cases = filter ? CASES.filter((c) => c.id.includes(filter)) : CASES;

// A guard that is green before the mutation is a precondition for the proof to
// mean anything: a probe that is already red would "fail" for the wrong reason.
// Retried once: on Windows a probe occasionally loses a race with the file
// handle another `node --test` process still holds. A retry cannot mask a
// genuinely red probe (that fails deterministically) but does stop a flake from
// silently downgrading a real proof into a SKIP.
const baseline = new Map();
for (const probe of new Set(cases.map((c) => c.probe))) {
  let result = runProbe(probe);
  if (result.failed) result = runProbe(probe);
  baseline.set(probe, result);
}

let bad = 0;
console.log(`Proving ${cases.length} probe(s) RED against a planted violation.\n`);

for (const c of cases) {
  const full = path.join(ROOT, c.source);
  const original = fs.readFileSync(full, "utf8");

  if (baseline.get(c.probe).failed) {
    console.log(`SKIP  ${c.id}\n      ${c.probe} is already failing before any mutation`);
    bad++;
    continue;
  }

  const anchor = anchorRegExp(c.find);
  const want = c.expectHits ?? 1;
  const hits = (original.match(anchor) ?? []).length;
  if (hits !== want) {
    console.log(
      `BAD   ${c.id}\n      the planted edit matches ${hits} times in ${c.source} (need exactly ${want})`,
    );
    bad++;
    continue;
  }

  let result;
  try {
    fs.writeFileSync(full, original.replace(anchor, c.replace));
    result = runProbe(c.probe);
    // Same retry, in the other direction: a green result is the one that would
    // let a decorative probe through, so confirm it before believing it.
    if (!result.failed) result = runProbe(c.probe);
  } finally {
    fs.writeFileSync(full, original);
  }
  if (fs.readFileSync(full, "utf8") !== original) {
    console.log(`BAD   ${c.id}\n      ${c.source} was not restored`);
    bad++;
  }

  if (result.failed) {
    const which = (result.output.match(/^not ok \d+ - (.+)$/gm) ?? []).map((l) =>
      l.replace(/^not ok \d+ - /, ""),
    );
    console.log(`RED   ${c.id}`);
    console.log(`      guards: ${c.guards}`);
    console.log(`      planted in ${c.source}`);
    console.log(`      fired: ${which.slice(0, 3).join(" | ") || "(file-level failure)"}`);
  } else {
    console.log(`GREEN ${c.id}  <-- PROBE DID NOT FIRE`);
    console.log(`      guards: ${c.guards}`);
    console.log(
      `      planted in ${c.source}: ${JSON.stringify(c.find)} -> ${JSON.stringify(c.replace)}`,
    );
    bad++;
  }
}

console.log(`\n${cases.length - bad}/${cases.length} probes fired on their planted violation.`);
process.exit(bad === 0 ? 0 : 1);
