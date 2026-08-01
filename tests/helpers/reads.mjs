// Finding every read in the source, and deciding which of them PostgREST will
// silently truncate.
//
// WHY THIS EXISTS
// ---------------
// `tests/export-and-currency.test.mjs` already asserts that every read in ONE
// file is paged. That guard is the reason the accounting export is correct, and
// its scope is the reason nothing else is: the same defect existed in 130 other
// reads across 70 files, and no test could see them.
//
// This is that guard generalised to the whole tree. It is a text scan, which is
// a real limitation and stated here rather than in a footnote: it cannot follow
// a query built across several statements, and it trusts that `.from("x")` is
// followed by the chain that belongs to it. What it CAN do is fail the build the
// moment somebody writes a new unbounded `.select()` anywhere, which is exactly
// the event that has to be caught.

import { readFileSync } from "node:fs";

/**
 * The `.from("table") … ;` chains in one source file.
 *
 * The chain ends at the first `;` or unbalanced `)` at depth zero, which is
 * where a statement ends in every call site in this codebase. A chain that runs
 * into the next statement would only ever make this scanner MORE permissive
 * about the current one and less about the next, so the failure mode is a false
 * positive that a human reads — not a silent miss.
 */
export function chains(source) {
  const out = [];
  const re = /\.from\(\s*"([a-z_0-9]+)"\s*\)/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "(") depth++;
      else if (c === ")") {
        if (depth === 0) break;
        depth--;
      } else if (c === ";" && depth === 0) break;
    }
    out.push({
      table: m[1],
      text: source.slice(m.index, Math.min(i + 1, source.length)),
      line: source.slice(0, m.index).split("\n").length,
      index: m.index,
    });
  }
  return out;
}

/** The gateway functions in lib/data/db.ts that apply a bound themselves. */
const GATEWAY = /\bread(All|AtMost|Page|Pages)\s*\(/;

/**
 * Whether this chain was handed to the gateway, which ranges it.
 *
 * A repository writes the query SHAPE and never the bound:
 *
 *     readAll("customers.listActive", () =>
 *       supabase.from("customers").select(...).order("name"))
 *
 * so the chain itself carries no `.range()` and a naive scan would call it
 * unbounded. The bound is real, it is just applied one level up — which is the
 * entire design, since a bound the caller cannot write is a bound the caller
 * cannot forget.
 *
 * WHY THIS IS STRUCTURAL AND NOT A REGEX OVER THE PRECEDING TEXT. The first
 * version looked back to the nearest `;`, `{` or `}` and asked whether a
 * gateway call appeared after it. That reported two correctly-paged
 * repositories as unbounded, because
 *
 *     readAll<{ customer_id: string | null }>( ... )
 *
 * contains a `{` INSIDE ITS TYPE ARGUMENT, so the search began after the
 * generic and never saw the `readAll`. A false red is exactly as damaging as a
 * false green — it teaches people the guard is noise — so this now finds the
 * enclosing call properly: walk back to the first unmatched `(`, step over a
 * balanced `<...>` type argument if one is there, and read the callee's name.
 */
function enclosingCallee(source, index) {
  let depth = 0;
  let i = index - 1;
  for (; i >= 0; i--) {
    const c = source[i];
    if (c === ")") depth++;
    else if (c === "(") {
      if (depth === 0) break; // the call this chain sits inside
      depth--;
    }
  }
  if (i < 0) return null;

  let j = i - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  // Step over a generic: readAll<T>( ... )
  if (source[j] === ">") {
    let angle = 0;
    for (; j >= 0; j--) {
      if (source[j] === ">") angle++;
      else if (source[j] === "<") {
        angle--;
        if (angle === 0) {
          j--;
          break;
        }
      }
    }
    while (j >= 0 && /\s/.test(source[j])) j--;
  }
  let end = j + 1;
  while (j >= 0 && /[A-Za-z0-9_$.]/.test(source[j])) j--;
  return source.slice(j + 1, end) || null;
}

function insideGatewayCall(source, index) {
  // The chain sits inside the `build` callback, which sits inside the gateway
  // call: `readAll(source, () => supabase.from(...))`. An arrow function's own
  // parens are balanced, so the first UNMATCHED `(` walking back is the
  // gateway's — and because a completed earlier statement has balanced parens
  // too, a `readAll` from a previous line cannot be reached this way. That is
  // what keeps the exemption narrow, and tests/data-layer.test.mjs plants
  // exactly that case to prove it.
  const callee = enclosingCallee(source, index);
  return Boolean(callee) && GATEWAY.test(`${callee}(`);
}

/**
 * What kind of database access a chain is.
 *
 *   write           an insert/upsert/update/delete (its `.select()` returns the
 *                   row just written, which is one row and needs no bound)
 *   read-one        `.single()` / `.maybeSingle()`
 *   read-count      `head: true, count: "exact"` — transfers no rows
 *   read-bounded    carries an explicit `.limit()` or `.range()`
 *   read-paged      handed to the lib/data gateway, which ranges it
 *   read-unbounded  THE DEFECT: a list read with no bound, silently capped at
 *                   1000 rows by PostgREST with no error
 *   not-a-read      `.from()` with no `.select()` at all
 */
export function classify(chain, source) {
  const t = chain.text;
  if (/\.(insert|upsert|update|delete)\s*\(/.test(t)) return "write";
  if (!/\.select\s*\(/.test(t)) return "not-a-read";
  if (/count:\s*"exact"/.test(t) && /head:\s*true/.test(t)) return "read-count";
  if (/\.(single|maybeSingle)\s*\(/.test(t)) return "read-one";
  if (/\.(limit|range)\s*\(/.test(t)) return "read-bounded";
  if (source !== undefined && insideGatewayCall(source, chain.index)) return "read-paged";
  return "read-unbounded";
}

/**
 * Every unbounded list read across the given files, as stable `"path table"`
 * keys.
 *
 * Keyed by file and table rather than by line number ON PURPOSE. A line-numbered
 * inventory has to be rewritten whenever anything above it moves, which trains
 * everybody to regenerate it without reading it — and an inventory that is
 * regenerated rather than reviewed cannot ratchet anything.
 */
export function unboundedReads(files, root) {
  const found = [];
  for (const file of files) {
    const rel = file.slice(root.length + 1).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    for (const chain of chains(source)) {
      if (classify(chain, source) === "read-unbounded") found.push(`${rel} ${chain.table}`);
    }
  }
  return found.sort();
}

/** The same tally, by kind, for reporting progress honestly. */
export function tally(files) {
  const counts = {};
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const chain of chains(source)) {
      const kind = classify(chain, source);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}
