// Static analysis of the migration SQL, good enough to assert per-table facts.
//
// WHY: the previous feature-preservation tests asserted things like
//   sql.includes("alter table public.%i enable row level security")
// which is the FORMAT STRING inside a DO-loop. It is present whenever any loop
// exists, regardless of whether the table under test is in that loop's array —
// so the assertion passed for every table, including tables that were never
// protected. One check even fell through to a bare
//   sql.includes("enable row level security")
// which is true of essentially every migration file in the project.
//
// A guard that cannot fail is worse than no guard: it reports safety it has not
// checked. These helpers expand the DO-loop arrays so the assertions are real.

/** Strip SQL line and block comments so they cannot satisfy a check. */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/** Every `do $$ ... $$` block body in the file. */
function doBlocks(sql) {
  return [...sql.matchAll(/\bdo\s*\$\$([\s\S]*?)\$\$/gi)].map((m) => m[1]);
}

/** String literals inside every `array[...]` in a block. */
function arrayLiterals(block) {
  const names = new Set();
  for (const arr of block.matchAll(/array\s*\[([\s\S]*?)\]/gi)) {
    for (const lit of arr[1].matchAll(/'([a-z0-9_]+)'/gi)) names.add(lit[1].toLowerCase());
  }
  // `... as t(tbl, ...)` tuple loops: take the first literal of each tuple.
  for (const tup of block.matchAll(/\(\s*'([a-z0-9_]+)'\s*,/gi)) names.add(tup[1].toLowerCase());
  return names;
}

const clean = (name) =>
  name
    .replace(/^public\./i, "")
    .replace(/"/g, "")
    .toLowerCase();

/** Tables created in this SQL. */
export function tablesCreated(sql) {
  const s = stripSqlComments(sql);
  return new Set(
    [...s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi)].map((m) =>
      clean(m[1]),
    ),
  );
}

/**
 * Tables with RLS enabled — literal statements AND dynamic loops.
 * A loop only counts for the tables actually named in its array.
 */
export function tablesWithRls(sql) {
  const s = stripSqlComments(sql);
  const out = new Set(
    [
      ...s.matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_."]+)\s+enable\s+row\s+level\s+security/gi,
      ),
    ].map((m) => clean(m[1])),
  );
  for (const block of doBlocks(s)) {
    if (!/enable\s+row\s+level\s+security/i.test(block)) continue;
    for (const name of arrayLiterals(block)) out.add(name);
  }
  return out;
}

/** Tables with at least one policy — literal statements AND dynamic loops. */
export function tablesWithPolicy(sql) {
  const s = stripSqlComments(sql);
  const out = new Set(
    [...s.matchAll(/create\s+policy\s+[a-z0-9_."]+\s+on\s+([a-z0-9_."]+)/gi)].map((m) =>
      clean(m[1]),
    ),
  );
  for (const block of doBlocks(s)) {
    if (!/create\s+policy/i.test(block)) continue;
    for (const name of arrayLiterals(block)) out.add(name);
  }
  return out;
}

/** Tables whose privileges are revoked from anon — literal AND dynamic. */
export function tablesRevokedFromAnon(sql) {
  const s = stripSqlComments(sql);
  const out = new Set();
  // A single REVOKE may list several tables, across several lines:
  //   revoke all on public.a, public.b,
  //     public.c from anon, authenticated;
  // Capturing only the first name silently under-reports coverage.
  for (const m of s.matchAll(/revoke\s+[\s\S]*?\bon\s+([\s\S]*?)\bfrom\s+([^;]*?);/gi)) {
    if (!/\banon\b/i.test(m[2])) continue;
    if (/\bfunction\b/i.test(m[1])) continue; // function grants, not tables
    for (const name of m[1].split(",")) {
      const trimmed = name.trim();
      if (/^(public\.)?[a-z0-9_"]+$/i.test(trimmed)) out.add(clean(trimmed));
    }
  }
  for (const block of doBlocks(s)) {
    if (!/revoke[^;]*from[^;]*anon/i.test(block)) continue;
    for (const name of arrayLiterals(block)) out.add(name);
  }
  return out;
}
