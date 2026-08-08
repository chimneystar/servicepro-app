import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const readCode = (p) =>
  readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------------------
// Deleting a customer was a HARD `.delete()` — the row was destroyed outright.
// `jobs.customer_id` is `on delete restrict`, so it happened to fail for
// customers WITH jobs and silently destroyed everyone else: the newest records,
// which are exactly the ones most likely to have been added by mistake.
//
// The trash screen (6a.4) reads `deleted_at`, so a hard delete never reached it.
// A recovery feature that cannot recover the most common deletion is decoration.
// ---------------------------------------------------------------------------

test("deleting a customer is recoverable, not destructive", () => {
  const src = readCode("app/(app)/customers/actions.ts");
  const fn = src.slice(src.indexOf("export async function deleteCustomer"));
  const body = fn.slice(0, fn.indexOf("\n}") + 2);
  assert.ok(
    !/\.delete\(\)/.test(body),
    "a hard delete destroys the row and bypasses /trash entirely",
  );
  assert.ok(
    /deleted_at: new Date\(\)/.test(body),
    "it must set deleted_at so the record can be restored",
  );
});

test("the detector fires on the original code", () => {
  // Both-ways proof against the real pre-fix line.
  const before = `const { error } = await supabase.from("customers").delete().eq("id", id);`;
  const after = `const { error } = await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", id);`;
  assert.ok(/\.delete\(\)/.test(before), "must catch what was actually there");
  assert.ok(!/\.delete\(\)/.test(after), "and pass on the fix");
});

test("customer lists still hide deleted rows, so nothing visibly changes", () => {
  const page = readCode("app/(app)/customers/page.tsx");
  // The customer list's query moved into lib/data/customers.ts's `listActive`
  // (ledger 6.2's data layer) — that is what actually runs it now.
  const query = readCode("lib/data/customers.ts");
  assert.ok(
    /listActive/.test(page),
    "the customer list must still go through the repository's active-customers read",
  );
  assert.ok(
    /is\("deleted_at", null\)/.test(query),
    "a soft delete only works if every list filters it out — otherwise deleting appears to do nothing",
  );
});

test("no user-facing action hard-deletes a record that trash is meant to hold", () => {
  // Sweep: the four tables /trash restores must never be destroyed outright by
  // an ordinary action. Legal erasure (the privacy anonymiser) is a different
  // path and overwrites PII rather than removing the row.
  const RECOVERABLE = ["customers", "jobs", "estimates", "invoices"];
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(new URL(`../${dir}/`, import.meta.url), {
      withFileTypes: true,
    })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith("actions.ts")) continue;
      const src = readCode(path);
      for (const table of RECOVERABLE) {
        const pattern = new RegExp(`from\("${table}"\)\s*\.delete\(\)`);
        if (pattern.test(src)) offenders.push(`${path}: hard-deletes ${table}`);
      }
    }
  };
  walk("app");
  assert.deepEqual(offenders, [], `\n  ${offenders.join("\n  ")}\n`);
});
