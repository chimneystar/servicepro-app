// Finding PostgREST embedded selects in the source, and deciding which of them
// PostgREST will refuse.
//
// WHY THIS EXISTS
// ---------------
// `GET /jobs?select=id,customers(name)` looks unambiguous and is not. Migration
// 014 added a composite tenant-isolation foreign key
// `jobs (customer_id, organization_id) -> customers (id, organization_id)`
// ALONGSIDE the plain `jobs.customer_id -> customers.id`. PostgREST builds one
// relationship per `pg_constraint` row with `contype = 'f'` — it has no rule
// preferring the one whose referenced columns are the primary key — so an
// unhinted embed matches two relationships and the request fails with
// HTTP 300 / PGRST201 "Could not embed because more than one relationship was
// found". The fix is the documented `!<constraint>` hint.
//
// This module is the shared parser. `tests/postgrest-embeds.test.mjs` uses it
// as a guard over the whole tree.

import { readFileSync } from "node:fs";

/**
 * Every foreign key in the generated types, as {child, parent, constraint}.
 *
 * Read from lib/supabase/database.types.ts rather than from db/*.sql, because
 * that file is itself generated from a database built by applying the
 * migrations — so this guard is grounded in what the migrations produce and
 * not in a grep over DDL text.
 */
export function foreignKeys(typesSource) {
  const out = [];
  let table = null;
  let pending = null;
  for (const line of typesSource.split("\n")) {
    const t = /^ {6}(\w+): \{$/.exec(line);
    if (t) table = t[1];
    const fk = /foreignKeyName: "([^"]+)"/.exec(line);
    if (fk) pending = { child: table, constraint: fk[1], parent: null };
    const ref = /referencedRelation: "([^"]+)"/.exec(line);
    if (ref && pending) {
      pending.parent = ref[1];
      out.push(pending);
      pending = null;
    }
  }
  return out;
}

/**
 * Pairs of relations PostgREST cannot resolve without a hint.
 *
 * Both directions: PostgREST derives a one-to-many for every many-to-one, so
 * `customers?select=jobs(...)` is as ambiguous as `jobs?select=customers(...)`.
 */
export function ambiguousPairs(fks) {
  const counts = new Map();
  for (const fk of fks) {
    const forward = `${fk.child}->${fk.parent}`;
    const back = `${fk.parent}->${fk.child}`;
    counts.set(forward, (counts.get(forward) ?? 0) + 1);
    counts.set(back, (counts.get(back) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/**
 * The embed targets named at the TOP level of a PostgREST select string.
 *
 * Only the top level: a nested embed is resolved against its own parent, not
 * against the table in `.from()`, and this parser deliberately does not try to
 * track that. Nested targets are returned separately so a caller can decide.
 */
export function embedTargets(selectString) {
  const targets = [];
  let depth = 0;
  let token = "";
  const flush = (nested) => {
    const name = token.trim();
    token = "";
    if (!name) return;
    // `alias:table!hint(...)` — the alias and the hint are both optional.
    const m = /(?:([A-Za-z_]\w*)\s*:)?\s*([A-Za-z_]\w*)\s*(!\s*([A-Za-z_]\w*))?$/.exec(name);
    if (m) targets.push({ table: m[2], hint: m[4] ?? null, nested });
  };
  for (let i = 0; i < selectString.length; i++) {
    const ch = selectString[i];
    if (ch === "(") {
      flush(depth > 0);
      depth += 1;
      token = "";
    } else if (ch === ")") {
      depth -= 1;
      token = "";
    } else if (ch === "," && depth === 0) {
      token = "";
    } else if (depth === 0) {
      token += ch;
    }
  }
  return targets;
}

/**
 * `.from("x") … .select("…")` pairs in one source file.
 *
 * Pragmatic and deliberately conservative: it pairs each `.from("table")` with
 * the FIRST `.select(` that follows it, which is how every call site in this
 * codebase is written. A select whose argument is not a plain string literal
 * (a template with an interpolation) is reported with `dynamic: true` so the
 * caller can refuse to guess rather than silently pass it.
 */
export function selectCalls(source) {
  const calls = [];
  const fromRe = /\.from\(\s*"([a-z_]+)"\s*\)/g;
  let m;
  while ((m = fromRe.exec(source))) {
    const rest = source.slice(m.index, m.index + 4000);
    const sel = /\.select\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/.exec(rest);
    if (!sel) continue;
    // Another `.from(` before the `.select(` means these are different chains.
    const between = rest.slice(m[0].length, sel.index);
    if (/\.from\(\s*"/.test(between)) continue;
    const literal = sel[1] ?? sel[2];
    const line = source.slice(0, m.index).split("\n").length;
    calls.push({
      table: m[1],
      select: literal,
      dynamic: sel[2] !== undefined && /\$\{/.test(sel[2]),
      line,
    });
  }
  return calls;
}

/** Every unhinted embed that PostgREST would refuse, across the given files. */
export function ambiguousEmbeds(files, ambiguous) {
  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const call of selectCalls(source)) {
      if (call.dynamic) continue;
      for (const target of embedTargets(call.select)) {
        if (target.nested || target.hint) continue;
        if (ambiguous.has(`${call.table}->${target.table}`)) {
          problems.push({ file, line: call.line, from: call.table, target: target.table });
        }
      }
    }
  }
  return problems;
}
