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

/**
 * The gateway functions in lib/data/db.ts that apply a bound themselves.
 *
 * `PageWithTotal` and `Pages` are listed BEFORE `Page` because a regex
 * alternation is first-match: with `Page` first, `readPageWithTotal(` matched
 * `readPage` and then failed on `\s*\(`, so the newest primitive was invisible
 * to the guard and every query using it reported as unbounded.
 */
const GATEWAY = /\bread(All|AtMost|PageWithTotal|Pages|Page)\s*\(/;

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

/**
 * A query assigned to a variable and bounded LATER, in another statement.
 *
 * `lib/payments/server.ts` builds a conditional query this way:
 *
 *     let query = admin.from("payment_requests").select(...).in(...);
 *     query = document.invoiceId ? query.eq(...) : query.eq(...);
 *     const { data } = await query.order(...).limit(1).maybeSingle();
 *
 * The chain extractor stops at the first `;`, so it sees a `.select()` with no
 * bound and reports a read that is in fact bounded — a FALSE RED, which costs
 * this guard its credibility just as surely as a miss costs it its purpose.
 *
 * So: if the chain is assigned to a name, and that name is later given a bound
 * within the same function, the read is bounded. The window ends at the next
 * top-level `function`/`export`, so a bound applied to a same-named variable in
 * a DIFFERENT function cannot vouch for this one.
 */
function boundedLaterViaVariable(source, chain) {
  // A window, not just the current line: the client is routinely on its own
  // line, so `let query = admin\n    .from(...)` puts the assignment one line
  // above the chain.
  const before = source.slice(Math.max(0, chain.index - 120), chain.index);
  const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*\s*$/.exec(before);
  if (!assigned) return false;
  const name = assigned[1];

  const after = source.slice(chain.index);
  const stop = after.search(/\n(?:export\s|async\s+function\s|function\s)/);
  const scope = stop === -1 ? after : after.slice(0, stop);

  const bound = new RegExp(
    `\\b${name}\\b[\\s\\S]{0,400}?\\.(limit|range|single|maybeSingle)\\s*\\(`,
  );
  return bound.test(scope.slice(chain.text.length));
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
 * Numeric constants a file declares exactly once, so `.limit(ROW_CEILING)` can
 * be judged the same way `.limit(2000)` is.
 *
 * A named ceiling hides the defect better than a literal does: the dashboard
 * reads five tables at `ROW_CEILING = 2000` and the schedule at
 * `JOB_CEILING = 2000`, all of which PostgREST answers with 1000 rows. The name
 * makes it look considered.
 *
 * ONLY names declared once, and only in the same file. A name assigned twice is
 * skipped rather than guessed at, because picking the wrong one would produce a
 * false red — and this guard's credibility is worth more than the extra catch.
 * A constant imported from another module (`CALENDAR_MAX_EVENTS` lives in
 * lib/core/calendar.mjs) is therefore NOT resolved; that limitation is real and
 * is recorded in the ledger rather than papered over.
 */
export function numericConstants(source) {
  const seen = new Map();
  const dup = new Set();
  const re = /\b([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*[,;\n]/g;
  let m;
  while ((m = re.exec(source))) {
    if (seen.has(m[1]) && seen.get(m[1]) !== Number(m[2])) dup.add(m[1]);
    seen.set(m[1], Number(m[2]));
  }
  for (const name of dup) seen.delete(name);
  return seen;
}

/**
 * What kind of database access a chain is.
 *
 *   write           an insert/upsert/update/delete (its `.select()` returns the
 *                   row just written, which is one row and needs no bound)
 *   read-one        `.single()` / `.maybeSingle()`
 *   read-count      `head: true, count: "exact"` — transfers no rows
 *   read-bounded    carries a bound BELOW the server cap
 *   read-paged      handed to the lib/data gateway, which ranges it
 *   read-unbounded  THE DEFECT: a list read with no bound — or one at or above
 *                   the cap, which the server silently reduces to 1000 rows
 *   not-a-read      `.from()` with no `.select()` at all
 */
export function classify(chain, source, constants) {
  const t = chain.text;
  if (/\.(insert|upsert|update|delete)\s*\(/.test(t)) return "write";
  if (!/\.select\s*\(/.test(t)) return "not-a-read";
  if (/count:\s*"exact"/.test(t) && /head:\s*true/.test(t)) return "read-count";
  if (/\.(single|maybeSingle)\s*\(/.test(t)) return "read-one";
  // An explicit `.limit(N)` at or above the server's cap is NOT a bound — it is
  // the same silent truncation wearing a number. `/reports` capped the aging
  // report's unpaid invoices at `.limit(2000)`, which PostgREST honours as
  // min(2000, 1000): the business was told what it was owed on its first
  // thousand unpaid invoices, and the deliberate-looking 2000 is exactly why
  // nobody questioned it.
  const limitArg = /\.limit\(\s*([A-Za-z_$][\w$]*|\d+)\s*\)/.exec(t);
  if (limitArg) {
    const n = /^\d+$/.test(limitArg[1])
      ? Number(limitArg[1])
      : (constants ?? new Map()).get(limitArg[1]);
    if (n !== undefined && n >= 1000) return "read-unbounded";
  }
  if (/\.(limit|range)\s*\(/.test(t)) return "read-bounded";
  if (source !== undefined && insideGatewayCall(source, chain.index)) return "read-paged";
  if (source !== undefined && boundedLaterViaVariable(source, chain)) return "read-bounded";
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
    const constants = numericConstants(source);
    for (const chain of chains(source)) {
      if (classify(chain, source, constants) === "read-unbounded")
        found.push(`${rel} ${chain.table}`);
    }
  }
  return found.sort();
}

/** The same tally, by kind, for reporting progress honestly. */
export function tally(files) {
  const counts = {};
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const constants = numericConstants(source);
    for (const chain of chains(source)) {
      const kind = classify(chain, source, constants);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  return counts;
}
