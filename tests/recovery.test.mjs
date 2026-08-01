import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RECOVERABLE_KINDS,
  KIND_TABLE,
  RESTORE_ROLES,
  isRecoverableKind,
  tableForKind,
  restoreBlockers,
  canRestore,
  restoreFailureMessage,
} from "../lib/core/recovery.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// Structural assertions must not be satisfied by a comment that merely MENTIONS
// the thing. Strip comments first, then look at the code that actually runs.
const readCode = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const readSql = (p) => read(p).replace(/--[^\n]*/g, "");

// ---------------------------------------------------------------------------
// Ledger 6a.4 — trash / restore.
//
// `deleted_at` was written on four tables and honoured on every read, and no
// screen could list or restore a single one of those rows. The rules below are
// the half of "can this come back?" that is pure decision, so each one is proven
// to REFUSE when it must and to ALLOW when it must. A rule that can only ever
// refuse is not a safety rule, it is a broken button.
// ---------------------------------------------------------------------------

test("the four soft-deletable tables are exactly the ones that carry deleted_at", () => {
  // Verified against db/001_schema.sql: these four declare `deleted_at timestamptz`.
  assert.deepEqual([...RECOVERABLE_KINDS].sort(), ["customer", "estimate", "invoice", "job"]);
  assert.deepEqual(KIND_TABLE, {
    customer: "customers",
    job: "jobs",
    estimate: "estimates",
    invoice: "invoices",
  });
  const schema = readSql("db/001_schema.sql");
  for (const table of Object.values(KIND_TABLE)) {
    const block = schema.slice(schema.indexOf(`create table if not exists public.${table} (`));
    assert.ok(
      /deleted_at\s+timestamptz/.test(block.slice(0, 2000)),
      `public.${table} must have deleted_at`,
    );
  }
});

test("an unknown kind is refused rather than guessed at", () => {
  assert.equal(isRecoverableKind("payment"), false);
  assert.equal(isRecoverableKind(""), false);
  assert.equal(isRecoverableKind(undefined), false);
  assert.equal(tableForKind("payment"), null);
  assert.equal(restoreBlockers("payment", { deleted: true })[0].code, "unknown_kind");
  // ...and the ones that ARE recoverable resolve to a real table name.
  assert.equal(tableForKind("invoice"), "invoices");
  assert.equal(isRecoverableKind("invoice"), true);
});

test("a row that is not deleted cannot be 'restored'", () => {
  const blockers = restoreBlockers("invoice", { deleted: false, customer: { deleted: false } });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, "not_deleted");
  // The other way: the identical row, actually deleted, restores cleanly.
  assert.equal(canRestore("invoice", { deleted: true, customer: { deleted: false } }), true);
});

// --- Rule 1: parent-first --------------------------------------------------

test("a child cannot be restored while its customer is still deleted", () => {
  for (const kind of ["job", "estimate", "invoice"]) {
    const blockers = restoreBlockers(kind, {
      deleted: true,
      customer: { deleted: true, name: "Ada Lovelace" },
    });
    assert.equal(blockers.length, 1, `${kind} must be blocked`);
    assert.equal(blockers[0].code, "parent_customer_deleted");
    assert.match(
      blockers[0].message,
      /Ada Lovelace/,
      "the refusal must name the customer to restore first",
    );
  }
});

test("the same child restores the moment its customer is back", () => {
  // The both-ways half. If this failed, the rule above would just be a wall.
  for (const kind of ["job", "estimate", "invoice"]) {
    assert.deepEqual(
      restoreBlockers(kind, { deleted: true, customer: { deleted: false, name: "Ada Lovelace" } }),
      [],
    );
    assert.equal(canRestore(kind, { deleted: true, customer: { deleted: false } }), true);
  }
});

test("a child whose customer row has vanished entirely is refused, not silently restored", () => {
  const blockers = restoreBlockers("job", { deleted: true, customer: null });
  assert.equal(blockers[0].code, "parent_customer_deleted");
  assert.equal(blockers[0].reason, "missing");
});

test("an invoice also waits for its job and its originating estimate", () => {
  const live = { deleted: false, name: "x" };
  assert.deepEqual(
    restoreBlockers("invoice", { deleted: true, customer: live, job: live, estimate: live }),
    [],
    "everything live: it must restore",
  );
  assert.equal(
    restoreBlockers("invoice", {
      deleted: true,
      customer: live,
      job: { deleted: true, name: "Boiler service" },
    })[0].code,
    "parent_job_deleted",
  );
  assert.equal(
    restoreBlockers("invoice", {
      deleted: true,
      customer: live,
      estimate: { deleted: true, name: "104" },
    })[0].code,
    "parent_estimate_deleted",
  );
  // Both parents gone: BOTH are reported, so the user is not told one at a time.
  const both = restoreBlockers("invoice", {
    deleted: true,
    customer: live,
    job: { deleted: true },
    estimate: { deleted: true },
  });
  assert.deepEqual(
    both.map((b) => b.code),
    ["parent_job_deleted", "parent_estimate_deleted"],
  );
});

test("an invoice with no job and no estimate is not blocked by parents it never had", () => {
  // invoices.job_id and invoices.estimate_id are both nullable (db/001_schema.sql,
  // db/024_deposit_credit.sql). Absent keys must not fabricate a blocker.
  assert.deepEqual(restoreBlockers("invoice", { deleted: true, customer: { deleted: false } }), []);
});

test("a dangling job reference blocks, because the KEY is the signal, not the value", () => {
  // The key present with a null value means "this invoice points at a job that
  // could not be found". Reading that as "no job" would restore an invoice
  // attached to nothing at all.
  const blockers = restoreBlockers("invoice", {
    deleted: true,
    customer: { deleted: false },
    job: null,
  });
  assert.equal(blockers[0].code, "parent_job_deleted");
  assert.equal(blockers[0].reason, "missing");
});

test("restoring a parent is never blocked by its children — no cascade in either direction", () => {
  // A customer restores on its own merit. Children are separate decisions.
  assert.deepEqual(restoreBlockers("customer", { deleted: true }), []);
});

// --- Rule 2: a privacy erasure is not a mis-click --------------------------

test("a customer erased under a completed privacy request can never be restored", () => {
  const blockers = restoreBlockers("customer", { deleted: true, privacyErased: true });
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].code, "privacy_erased");
  assert.match(blockers[0].message, /privacy deletion request/i);
});

test("an ordinary deleted customer IS restorable", () => {
  assert.equal(canRestore("customer", { deleted: true, privacyErased: false }), true);
  assert.equal(canRestore("customer", { deleted: true }), true);
});

// --- Rule 3: the double-booking constraint is translated, not leaked --------

test("an exclusion-constraint violation becomes an instruction a dispatcher can follow", () => {
  const result = restoreFailureMessage({
    code: "23P01",
    message: 'conflicting key value violates exclusion constraint "jobs_no_double_book"',
  });
  assert.equal(result.code, "double_booked");
  assert.match(result.message, /already booked/i);
  assert.doesNotMatch(
    result.message,
    /23P01|exclusion constraint/,
    "raw Postgres is not an explanation",
  );
});

test("each trigger refusal maps to its own sentence, and anything unknown fails safe", () => {
  assert.equal(restoreFailureMessage({ message: "restore_privacy_erased" }).code, "privacy_erased");
  assert.equal(restoreFailureMessage({ message: "restore_parent_deleted" }).code, "parent_deleted");
  assert.equal(
    restoreFailureMessage({ code: "42501", message: "permission denied for table invoices" }).code,
    "forbidden",
  );
  const unknown = restoreFailureMessage({ code: "08006", message: "connection failure" });
  assert.equal(unknown.code, "restore_failed");
  assert.match(unknown.message, /Nothing was changed/);
  assert.doesNotMatch(
    unknown.message,
    /connection failure/,
    "internal errors are not shown verbatim",
  );
});

// ---------------------------------------------------------------------------
// Structural: the screen, the action and the migration must actually implement
// the rules above. Comments are stripped first — a rule described in prose and
// not executed is the failure mode this whole file exists to catch.
// ---------------------------------------------------------------------------

test("the trash screen exists, is owner/office, and pages", () => {
  const page = readCode("app/(app)/trash/page.tsx");
  // The recovery reads moved into lib/data/crm.ts's `pageDeletedRows` (ledger
  // 6.2's data layer) — that is what actually runs the query now, so the
  // properties below are proven against whichever file runs them.
  const query = readCode("lib/data/crm.ts");
  assert.match(
    page,
    /role === "tech"[\s\S]{0,40}redirect/,
    "restoring is owner/office, exactly as deleting is",
  );
  assert.match(
    query,
    /\.not\("deleted_at", "is", null\)/,
    "the trash lists deleted rows and only deleted rows",
  );
  assert.match(
    query,
    /\.range\(range\.from, range\.to\)/,
    "an unpaginated list would stop at PostgREST's 1000-row cap",
  );
  assert.match(
    page + query,
    /organization_id/,
    "every query is scoped to the caller's organisation",
  );
  for (const table of ["customers", "jobs", "estimates", "invoices"]) {
    assert.ok(page.includes(`"${table}"`), `${table} must be listed — it carries deleted_at`);
  }
  assert.match(page, /restoreBlockers/, "the screen must use the shared rules, not its own copy");
});

test("trash and archive are kept apart", () => {
  const page = readCode("app/(app)/trash/page.tsx");
  const trashQuery = readCode("lib/data/crm.ts");
  // Trash must never filter on `archived`, and the archive screen must never
  // start listing deleted rows. They are different columns and different ideas.
  assert.doesNotMatch(
    page + trashQuery,
    /\.eq\("archived", true\)/,
    "archived=true is the ARCHIVE, not the trash",
  );
  const archive = readCode("app/(app)/archive/page.tsx");
  // The archive's query moved into lib/data/customers.ts's `listArchived`
  // (ledger 6.2's data layer) — that is what actually runs it now.
  const archiveQuery = readCode("lib/data/customers.ts");
  assert.match(
    archiveQuery,
    /\.is\("deleted_at", null\)/,
    "the archive still excludes deleted rows",
  );
  assert.match(
    archiveQuery,
    /\.eq\("archived", true\)/,
    "the archive is still driven by archived=true",
  );
});

test("the restore action re-checks the rules and cannot be called by a technician", () => {
  const actions = readCode("app/(app)/trash/actions.ts");
  // `[...RESTORE_ROLES]` is the same list, spread into a mutable array because
  // ledger 6.1 annotated RESTORE_ROLES as a readonly tuple (that annotation is
  // what lets `KIND_TABLE[kind]` reach `supabase.from()` as a literal table
  // name). Either spelling passes the same list to the same server-side check;
  // deleting the call still fails this assertion.
  assert.match(
    actions,
    /assertRole\(profile, \[?\.{0,3}RESTORE_ROLES/,
    "role is checked server-side, not in the component",
  );
  assert.match(
    actions,
    /restoreBlockers/,
    "the action must apply the same rules the screen displayed",
  );
  assert.match(
    actions,
    /isRecoverableKind\(kind\)/,
    "the table name comes from a fixed map, never from the caller",
  );
  assert.match(actions, /deleted_at: null/, "restore clears deleted_at");
  assert.match(
    actions,
    /\.not\("deleted_at", "is", null\)/,
    "the write itself is conditional on the row still being deleted",
  );
  assert.match(
    actions,
    /\.eq\("organization_id"/,
    "the write is scoped to the caller's organisation",
  );
  assert.match(
    actions,
    /restoreFailureMessage/,
    "a database refusal must be translated, not leaked",
  );
  assert.deepEqual(RESTORE_ROLES, ["owner", "office"]);
});

test("migration 037 enforces the same rules in the database, and drops nothing", () => {
  const sql = readSql("db/037_recovery.sql");
  // deleted_by: the "by whom" the screen promises. It did not exist anywhere.
  for (const table of ["customers", "jobs", "estimates", "invoices"]) {
    assert.ok(
      new RegExp(`alter table public\\.${table}\\s+add column if not exists deleted_by`).test(sql),
      `${table}.deleted_by must be added idempotently`,
    );
  }
  assert.match(
    sql,
    /restore_privacy_erased/,
    "the privacy-erasure rule must be enforced by the database, not only the UI",
  );
  assert.match(
    sql,
    /restore_parent_deleted/,
    "the parent-first rule must be enforced by the database",
  );
  assert.match(sql, /restore_denied/, "restore must be owner/office at the database too");
  assert.match(
    sql,
    /audit_log/,
    "historical deleted_by must be backfilled, not left blank forever",
  );
  assert.match(
    sql,
    /create index if not exists idx_customers_trash/,
    "every existing index excludes deleted rows",
  );

  // Idempotent, and destroys nothing. The only DROPs allowed are of triggers
  // this file immediately recreates.
  for (const drop of sql.match(/drop\s+[a-z ]+/gi) ?? []) {
    assert.match(drop, /drop trigger if exists/i, `037 must not ${drop.trim()}`);
  }
  assert.doesNotMatch(sql, /drop\s+(table|column|policy|index|constraint)/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i, "a recovery migration must never delete rows");
  for (const create of sql.match(/create (table|index|trigger)[^;]*/gi) ?? []) {
    assert.match(create, /if not exists|create trigger/i, `not idempotent: ${create.slice(0, 60)}`);
  }
});

test("the trash screen is reachable", () => {
  // 6a.4's actual bug was not missing data. It was that no screen could reach
  // it. A trash route with no way in would repeat the fault exactly.
  const nav = readCode("lib/nav.ts");
  assert.match(nav, /href: "\/trash"/, "the trash must be in the navigation");
  assert.match(nav, /"\/trash", key: "nav\.trash"[\s\S]{0,80}roles: \["owner", "office"\]/);
  const i18n = read("lib/i18n.ts");
  assert.equal((i18n.match(/"nav\.trash":/g) ?? []).length, 2, "English and Hebrew");
});
