// Guards for ledger item 4.7 — the screens that loaded whole tables.
//
// Two kinds of assertion here, and the split is deliberate:
//   1. Behavioural, on lib/core/query-window.mjs, including the one property
//      the calendar's correctness actually rests on (the fetched window always
//      contains the rendered range).
//   2. Structural, on the pages themselves, because "this query has a date
//      filter" is a property of the source and cannot be observed from a pure
//      function. Those reads strip comments first — every one of these files
//      DESCRIBES the unbounded query it replaced, so a naive scan would match
//      the prose and either pass or fail for the wrong reason.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDays,
  addMonths,
  monthStart,
  monthEnd,
  weekStart,
  visibleRange,
  fetchWindow,
  covers,
  monthsBack,
  isTruncated,
  clampLimit,
  toIsoDate,
  isIsoDate,
} from "../lib/core/query-window.mjs";
import { phoneSearchSuffix, normalizeUsPhone } from "../lib/core/calls.mjs";

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

test("date arithmetic crosses month, year and leap-day boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29", "2024 is a leap year");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01", "2026 is not");
  assert.equal(monthStart("2026-07-31"), "2026-07-01");
  assert.equal(monthEnd("2026-02-10"), "2026-02-28");
  assert.equal(monthEnd("2024-02-10"), "2024-02-29");
  assert.equal(monthEnd("2026-12-01"), "2026-12-31");
});

test("addMonths clamps rather than rolling over", () => {
  // Naive month arithmetic turns 31 March minus one month into 3 March, which
  // would silently move a reporting window by three days.
  assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(addMonths("2024-03-31", -1), "2024-02-29");
  assert.equal(addMonths("2026-01-15", -12), "2025-01-15");
  assert.equal(monthsBack("2026-07-31", 12), "2025-07-31");
});

test("the week starts on Sunday, matching the calendar grid", () => {
  assert.equal(weekStart("2026-07-31"), "2026-07-26", "2026-07-31 is a Friday");
  assert.equal(weekStart("2026-07-26"), "2026-07-26", "a Sunday is its own week start");
});

// ---------------------------------------------------------------------------
// The invariant the calendar depends on.
// ---------------------------------------------------------------------------

test("the fetched window contains every rendered range, for every day of 8 years", () => {
  // If this ever fails the calendar either shows an empty day it should have
  // loaded, or ping-pongs between anchors re-fetching forever. Both are worse
  // than the unbounded query this replaced, so it is proven exhaustively
  // rather than spot-checked.
  let checked = 0;
  for (
    let day = new Date(Date.UTC(2023, 0, 1));
    day < new Date(Date.UTC(2031, 0, 1));
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const anchor = day.toISOString().slice(0, 10);
    const window = fetchWindow(anchor);
    for (const view of ["day", "week", "month"]) {
      assert.ok(
        covers(window, visibleRange(anchor, view)),
        `${view} view of ${anchor} needs ${JSON.stringify(visibleRange(anchor, view))} but only ${JSON.stringify(window)} is loaded`,
      );
      checked++;
    }
  }
  assert.ok(checked > 8000, `expected thousands of cases, ran ${checked}`);
});

test("covers() actually refuses a range that falls outside — it is not a rubber stamp", () => {
  const window = fetchWindow("2026-07-15");
  assert.equal(covers(window, { from: "2026-07-01", to: "2026-07-31" }), true);
  assert.equal(
    covers(window, { from: "2026-01-01", to: "2026-01-07" }),
    false,
    "a month in the past must trigger a refetch",
  );
  assert.equal(
    covers(window, { from: "2027-01-01", to: "2027-01-07" }),
    false,
    "so must a month in the future",
  );
  assert.equal(
    covers(window, { from: window.from, to: addDays(window.to, 1) }),
    false,
    "one day past the edge is still outside",
  );
});

test("the month view really does reach outside its own month", () => {
  // This is why the window is padded at all. February 2026 starts on a Sunday,
  // so its 6x7 grid runs to 14 March.
  const range = visibleRange("2026-02-10", "month");
  assert.equal(range.from, "2026-02-01");
  assert.equal(range.to, "2026-03-14");
  // August 2026 starts on a Saturday, so the grid opens in July.
  assert.equal(visibleRange("2026-08-10", "month").from, "2026-07-26");
});

// ---------------------------------------------------------------------------
// Truncation and untrusted input
// ---------------------------------------------------------------------------

test("truncation is detected exactly at the ceiling, in both directions", () => {
  assert.equal(isTruncated(500, 500), true, "a full page is the signal that more may exist");
  assert.equal(isTruncated(499, 500), false, "a short page must NOT claim truncation");
  assert.equal(isTruncated(0, 500), false);
  assert.equal(isTruncated(501, 500), true);
});

test("a caller-supplied page size cannot be used to demand the whole table", () => {
  assert.equal(clampLimit("1000", 500, 5000), 1000);
  assert.equal(clampLimit("999999", 500, 5000), 5000, "the ceiling is the point");
  assert.equal(clampLimit(undefined, 500, 5000), 500);
  assert.equal(clampLimit("", 500, 5000), 500);
  assert.equal(clampLimit("-1", 500, 5000), 500);
  assert.equal(clampLimit("0", 500, 5000), 500);
  assert.equal(clampLimit("abc", 500, 5000), 500);
  assert.equal(
    clampLimit("12; drop table jobs", 500, 5000),
    12,
    "parsed as a number, never interpolated as text",
  );
});

test("an anchor from the query string is validated, not trusted", () => {
  assert.equal(toIsoDate("2026-07-31", "2000-01-01"), "2026-07-31");
  assert.equal(toIsoDate("2026-02-31", "2000-01-01"), "2000-01-01", "31 February is not a date");
  assert.equal(toIsoDate("not-a-date", "2000-01-01"), "2000-01-01");
  assert.equal(toIsoDate(undefined, "2000-01-01"), "2000-01-01");
  assert.equal(toIsoDate("2026-07-31'; select 1--", "2000-01-01"), "2000-01-01");
  assert.equal(
    isIsoDate("2026-7-1"),
    false,
    "the shape must be strict, or arithmetic silently drifts",
  );
});

// ---------------------------------------------------------------------------
// Phone lookup — the /service-records logCall fix.
// ---------------------------------------------------------------------------

test("the phone suffix is digits only, so it can carry no ILIKE wildcard", () => {
  for (const written of ["+1 (555) 123-4567", "555.123.4567", "5551234567", "+15551234567"]) {
    assert.equal(
      phoneSearchSuffix(written),
      "4567",
      `${written} should reduce to its last four digits`,
    );
  }
  assert.equal(phoneSearchSuffix("%_*"), "", "a value with no digits yields no filter at all");
  assert.equal(phoneSearchSuffix("12"), "", "too short to be a suffix");
  assert.match(phoneSearchSuffix("+1 (555) 123-4567"), /^\d+$/);
});

test("the suffix narrows, and the exact normalized comparison still decides", () => {
  // The suffix is deliberately loose: two different numbers can share their
  // last four digits, so the caller must still confirm. Proving the collision
  // exists is what makes the second stage necessary rather than decorative.
  assert.equal(phoneSearchSuffix("+15551234567"), phoneSearchSuffix("+15559994567"));
  assert.notEqual(normalizeUsPhone("+15551234567"), normalizeUsPhone("+15559994567"));
});

// ---------------------------------------------------------------------------
// Structural guards on the pages themselves.
// ---------------------------------------------------------------------------

/**
 * Read a source file with comments stripped.
 *
 * Each of these files explains, in a comment, the unbounded query it replaced.
 * Scanning the raw text would match that explanation — a guard that passes
 * because of the prose describing the bug is no guard at all.
 */
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

test("the comment stripper used below removes prose and keeps code", () => {
  const stripped = read("app/(app)/schedule/page.tsx");
  assert.ok(!/THE BUG/.test(stripped), "comments must be gone");
  assert.ok(/fetchWindow/.test(stripped), "code must survive");
});

test("/schedule asks the database for the visible period only", () => {
  const src = read("app/(app)/schedule/page.tsx");
  assert.ok(/from\("jobs"\)/.test(src));
  assert.ok(
    /\.gte\("scheduled_date"/.test(src) && /\.lte\("scheduled_date"/.test(src),
    "the job query must be bounded at both ends of the visible window",
  );
  assert.ok(/\.limit\(/.test(src), "and still carry a ceiling");
  assert.ok(
    /fetchWindow\(/.test(src),
    "the window must come from the tested helper, not be recomputed inline",
  );
});

test("the calendar re-fetches instead of showing an empty month", () => {
  const src = read("components/Calendar.tsx");
  assert.ok(
    /visibleRange\(/.test(src) && /covers\(/.test(src),
    "the calendar must compare what it renders against what was loaded",
  );
  assert.ok(/anchor=/.test(src), "and ask the server for the new period");
});

test("/messages no longer reads every message and every customer", () => {
  const src = read("app/(app)/messages/page.tsx");
  assert.ok(
    /from\("sms_messages"\)[\s\S]{0,240}\.limit\(/.test(src),
    "the message query must be limited",
  );
  assert.ok(
    !/from\("customers"\)\.select\("name, phone"\)\.is\("deleted_at", null\)\s*[,)]/.test(src),
    "the whole customer table must not be pulled in to label threads",
  );
  assert.ok(
    /\.or\(/.test(src) && /phone\.ilike/.test(src),
    "customer names must be matched in SQL",
  );
  assert.ok(
    /isTruncated/.test(src),
    "and the user must be told when older conversations are not shown",
  );
});

test("a single /messages thread is selected in SQL", () => {
  const src = read("app/(app)/messages/[phone]/page.tsx");
  assert.ok(
    /to_phone\.ilike/.test(src) && /from_phone\.ilike/.test(src),
    "the thread must be filtered by phone in the query, not in JavaScript",
  );
  assert.ok(/\.limit\(/.test(src));
  assert.ok(
    /quoteFilterValue/.test(src),
    "the phone goes into a PostgREST or= expression and must be escaped like /search",
  );
});

test("the owner dashboard is bounded and says so when it is", () => {
  const src = read("app/(app)/page.tsx");
  assert.ok(/monthsBack\(/.test(src), "the rolling window must come from the tested helper");
  assert.ok(
    /from\("invoices"\)[\s\S]{0,300}issue_date\.gte\./.test(src),
    "invoices must be date-filtered",
  );
  assert.ok(
    /from\("estimates"\)[\s\S]{0,300}issue_date\.gte\./.test(src),
    "estimates must be date-filtered",
  );
  assert.ok(
    /from\("expenses"\)[\s\S]{0,200}\.gte\("expense_date"/.test(src),
    "expenses must be date-filtered",
  );
  assert.ok(
    /from\("jobs"\)[\s\S]{0,400}\.gte\("scheduled_date"/.test(src),
    "jobs must be date-filtered",
  );
  assert.ok(
    /from\("leads"\)[\s\S]{0,120}head: true/.test(src),
    "leads were only counted, so they must be counted in SQL",
  );
  assert.ok(/isTruncated\(/.test(src), "and a partial page must announce itself");
});

test("the dashboard keeps every card it had", () => {
  // Bounding the queries must not quietly drop a panel. FEATURE-INVENTORY.md is
  // a contract, so the labels are asserted directly.
  const src = readFileSync(new URL("../app/(app)/page.tsx", import.meta.url), "utf8");
  for (const label of [
    "Collections",
    "Pipeline",
    "Sales · this month",
    "Invoices",
    "This month",
    "Estimates",
    "Today",
    "Coming up",
    "Recent jobs",
    "Top job types & sources",
  ]) {
    assert.ok(src.includes(label), `dashboard card disappeared: ${label}`);
  }
  assert.ok(
    /estimateCount/.test(src) && /jobCount/.test(src),
    "the setup checklist asks 'have you ever', which a rolling window cannot answer",
  );
});

test("/jobs still truncates but no longer hides it", () => {
  const page = read("app/(app)/jobs/page.tsx");
  const list = read("components/JobsList.tsx");
  assert.ok(
    /count: "exact", head: true/.test(page),
    "the real total must be counted at the database",
  );
  assert.ok(/truncated=\{truncated\}/.test(page), "and handed to the list");
  assert.ok(/loadMoreHref/.test(page), "with a way to see more");
  assert.ok(/truncated &&/.test(list), "the list must render the notice");
  assert.ok(!/\.limit\(500\)/.test(page), "the hard-coded 500 with no escape hatch was the bug");
});

test("logCall matches the caller in SQL instead of paging the customer table", () => {
  const src = read("app/(app)/service-records/actions.ts");
  assert.ok(
    !/from\("customers"\)[\s\S]{0,160}\.limit\(1000\)/.test(src),
    "selecting 1000 customers to find one phone match is wrong past 1000 customers, not just slow",
  );
  assert.ok(/\.ilike\("phone"/.test(src), "the phone must be filtered in the query");
  assert.ok(/phoneSearchSuffix\(/.test(src), "via the tested suffix helper");
  assert.ok(
    /normalizeUsPhone\(row\.phone\) === caller/.test(src),
    "and the exact normalized comparison must still decide, because suffixes collide",
  );
});
