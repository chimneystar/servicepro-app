// Safe construction of PostgREST filter expressions.
//
// THE BUG: /search interpolated raw user input into an `.or()` expression:
//
//   .or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,city.ilike.%${q}%`)
//
// PostgREST parses that string as a comma-separated list of conditions, so a
// comma in the query TERMINATES the current condition and starts a new one. A
// search for `a,archived.eq.true` rewrote the filter and defeated the page's own
// `archived = false` and `deleted_at is null` restrictions; parentheses and dots
// produced 500s on ordinary punctuation like "Smith, John" or "O'Brien Ltd.".
//
// Row-level security still bounded results to the caller's organisation, so this
// was filter injection rather than a tenant escape — real, but not a breach.
//
// Tests: tests/postgrest-filter.test.mjs

/**
 * Escape a user value for use inside a PostgREST filter expression.
 *
 * PostgREST treats , . : ( ) and " as structural. Wrapping the value in double
 * quotes makes the whole thing a single literal; embedded double quotes and
 * backslashes are escaped so the quoting cannot be broken out of.
 */
export function quoteFilterValue(value) {
  const escaped = String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Escape LIKE/ILIKE wildcards so a user searching for "50%" or "a_b" gets a
 * literal match instead of a pattern. `*` is PostgREST's wildcard in ilike.
 */
export function escapeLikePattern(value) {
  return String(value ?? "").replace(/([%_*\\])/g, "\\$1");
}

/**
 * Build an `or=` expression matching `term` against several columns with ILIKE.
 *
 * @param {string[]} columns
 * @param {string} term
 * @returns {string} safe to pass to supabase.or()
 */
export function orIlike(columns, term) {
  const pattern = quoteFilterValue(`%${escapeLikePattern(term)}%`);
  return columns.map((column) => `${column}.ilike.${pattern}`).join(",");
}

/**
 * Whether a raw search term would have broken the old unescaped construction.
 * Used by the tests to prove the injection was real before proving it is fixed.
 */
export function containsFilterMetacharacters(term) {
  return /[,.():"\\]/.test(String(term ?? ""));
}
