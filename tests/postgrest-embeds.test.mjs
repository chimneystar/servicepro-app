import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  foreignKeys,
  ambiguousPairs,
  embedTargets,
  selectCalls,
  ambiguousEmbeds,
} from "./helpers/embeds.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// THIRTY-SEVEN QUERIES IN THIS APP RETURNED HTTP 300 AND NOBODY KNEW.
//
// Migration 014 added composite tenant-isolation foreign keys — `jobs
// (customer_id, organization_id) -> customers (id, organization_id)` and eleven
// siblings — ALONGSIDE the plain single-column keys that were already there.
// They are the reason a job cannot reference another organization's customer,
// so they must stay.
//
// PostgREST builds one relationship per `pg_constraint` row with
// `contype = 'f'`. It has no rule preferring the key whose referenced columns
// are the primary key, and no deduplication. So `jobs?select=customers(name)`
// matches TWO relationships and PostgREST refuses the request with
// 300 Multiple Choices / PGRST201, "Could not embed because more than one
// relationship was found". The dashboard, the jobs list, the job detail page,
// the dispatch board, the schedule, the route sheet, the tech screen, search,
// the calendar feed, the reminder cron and the push notifier were all affected.
//
// Nothing caught it because every read came back as `any` and most call sites
// never looked at `error`. Typing the client caught it: postgrest-js encodes
// the same resolution rules in the type system and produced a
// `SelectQueryError<"Could not embed because more than one relationship...">`.
//
// This test is the durable guard. It is grounded in the GENERATED types, which
// are themselves built by applying every migration to a real Postgres — so a
// migration that adds a second foreign key between two tables makes it fail,
// naming every query that has just been broken.
// ---------------------------------------------------------------------------

const sourceFiles = () =>
  execSync('git ls-files "*.ts" "*.tsx"', { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f && !f.startsWith("tests/"))
    .map((f) => join(ROOT, f));

const typesSource = () => readFileSync(join(ROOT, "lib/supabase/database.types.ts"), "utf8");

test("no query embeds a relation PostgREST cannot resolve without a hint", () => {
  const ambiguous = ambiguousPairs(foreignKeys(typesSource()));
  const problems = ambiguousEmbeds(sourceFiles(), ambiguous);

  assert.deepEqual(
    problems.map((p) => `${p.file.slice(ROOT.length + 1)}:${p.line} ${p.from}->${p.target}`),
    [],
    "PostgREST returns 300/PGRST201 for these. Add the constraint hint, e.g. " +
      "`customers!jobs_customer_id_fkey(name)`. The right constraint is the plain " +
      "single-column foreign key, never the composite tenant-isolation one.",
  );
});

test("every `!hint` in a select names a foreign key that exists", () => {
  // The other half of the failure mode: a hint that names nothing is not a
  // no-op, it is PGRST200. A codemod wrote the wrong table's constraint name
  // into five queries while this branch was being built; this is what would
  // have caught it.
  const fks = foreignKeys(typesSource());
  const byName = new Map(fks.map((f) => [f.constraint, f]));
  const wrong = [];

  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    for (const call of selectCalls(source)) {
      for (const target of embedTargets(call.select)) {
        if (!target.hint || target.nested) continue;
        const fk = byName.get(target.hint);
        const rel = fk && `${fk.child}->${fk.parent}`;
        const wanted = [`${call.table}->${target.table}`, `${target.table}->${call.table}`];
        if (!fk || !wanted.includes(rel)) {
          wrong.push(
            `${file.slice(ROOT.length + 1)}:${call.line} ${call.table}->${target.table} ` +
              `hint=${target.hint} (${fk ? `is ${rel}` : "no such constraint"})`,
          );
        }
      }
    }
  }
  assert.deepEqual(wrong, [], "a hint must name a foreign key between exactly these two relations");
});

test("the ambiguity this guards against is real and detectable", () => {
  // Prove the guard fires. Without this, a parser that silently found nothing
  // would pass for ever and the whole test would be decoration.
  const fks = foreignKeys(typesSource());
  const ambiguous = ambiguousPairs(fks);
  assert.ok(
    ambiguous.has("jobs->customers"),
    "jobs->customers must still be ambiguous — migration 014's composite key is what makes it so",
  );
  assert.ok(ambiguous.has("customers->jobs"), "the inverse direction is equally ambiguous");
  assert.ok(!ambiguous.has("jobs->organizations"), "a single foreign key must NOT be ambiguous");

  // And that the source scanner sees a planted offender.
  const planted = `await supabase.from("jobs").select("id, customers(name)").eq("id", x);`;
  const [call] = selectCalls(planted);
  assert.equal(call.table, "jobs");
  const targets = embedTargets(call.select);
  assert.deepEqual(
    targets.map((t) => [t.table, t.hint]),
    [["customers", null]],
  );

  // ...and stays silent on the hinted form.
  const fixed = `await supabase.from("jobs").select("id, customers!jobs_customer_id_fkey(name)");`;
  assert.deepEqual(
    embedTargets(selectCalls(fixed)[0].select).map((t) => [t.table, t.hint]),
    [["customers", "jobs_customer_id_fkey"]],
  );
});
