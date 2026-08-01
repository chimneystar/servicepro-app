// The page loop. Pure, and deliberately in .mjs so tests run THIS code.
//
// WHY IT IS NOT IN THE TYPESCRIPT FILE
// ------------------------------------
// The one question that matters about this loop — "does it really return more
// than a thousand rows when a thousand and one exist?" — can only be answered
// against a real database with a real row cap (tests/data-paging-db.test.mjs
// inserts 1001 rows into PGlite and reads them back through a PostgREST-shaped
// adapter that truncates the way Supabase truncates). Those tests run under
// `node --test` and cannot import TypeScript. A copy of the loop transcribed
// into the test would prove the copy correct and the shipped code untested,
// which is the failure mode this branch keeps finding.
//
// So the loop lives here, `lib/data/db.ts` adds the types around it, and the
// code the test exercises is the code that ships.

/** Supabase's configured PostgREST `db-max-rows`. Exceeding it truncates silently. */
export const POSTGREST_ROW_CAP = 1000;

/**
 * Rows per request while paging.
 *
 * Deliberately BELOW the cap. If a page asked for exactly 1000 rows it could
 * not distinguish "this page was full" from "the server truncated me", and any
 * loop that stops on a short page would stop one page early on a table whose
 * size is an exact multiple of the cap. Asking for less than the cap means a
 * short page is always genuine information.
 */
export const PAGE_SIZE = 500;

/** Ceiling on the loop, so a missing filter fails loudly instead of paging for minutes. */
export const MAX_PAGES = 2000;

/** The inclusive `[from, to]` PostgREST range for a zero-based page. */
export function pageBounds(page, size = PAGE_SIZE) {
  const from = page * size;
  return { from, to: from + size - 1 };
}

/**
 * Whether a batch of this length ends the sequence.
 *
 * A short page is the last page. A full one is not evidence of anything, so it
 * costs one more request to find out — which is why this returns false on
 * equality rather than guessing.
 */
export function isLastPage(batchLength, size = PAGE_SIZE) {
  return batchLength < size;
}

/**
 * The largest number of rows ONE request can honestly deliver.
 *
 * Asking PostgREST for 5000 rows in a single request returns 1000 of them with
 * no error. So a limit above the cap is never passed to the server; it is
 * satisfied by `pageUpTo` instead. This clamp exists to keep any single request
 * inside what the server will actually honour, NOT to quietly shrink what the
 * caller asked for — see `pageUpTo`, which is the reason that distinction can
 * be made at all.
 */
export function clampLimit(limit) {
  return Math.max(1, Math.min(Math.floor(limit), POSTGREST_ROW_CAP - 1));
}

/**
 * At most `limit` rows, paging if `limit` is larger than one request can carry.
 *
 * WHY THIS EXISTS, AND IT IS A CORRECTION TO THIS MODULE'S OWN FIRST DRAFT.
 * `readAtMost` originally clamped the caller's limit to 999 and issued one
 * request. A caller asking for 5000 therefore received 999 rows, no error, and
 * no indication — which is the SAME silent-truncation defect this module was
 * built to remove, reintroduced inside it and wearing an explicit-looking
 * number. Clamping is only defensible for a request; it is not defensible for
 * an answer.
 *
 * So a limit within one request costs one request, and a larger one is paged
 * until the limit is reached or the source runs out. The caller gets what it
 * asked for or everything there is, and never a quiet fraction of either.
 */
export async function pageUpTo(fetchPage, limit, { size = PAGE_SIZE } = {}) {
  const wanted = Math.max(1, Math.floor(limit));
  const all = [];
  while (all.length < wanted) {
    // The cursor is what has been collected, not page * size: the last request
    // asks for only the remainder, so the offsets stay correct when `wanted` is
    // not a multiple of the page size.
    const from = all.length;
    const take = Math.min(size, wanted - all.length);
    const batch = await fetchPage(from, from + take - 1);
    for (const row of batch) all.push(row);
    if (batch.length < take) break; // the source is exhausted
  }
  return all;
}

/**
 * The range for ONE visible page, deliberately one row wider than the page.
 *
 * That extra row is how `hasMore` is known without a second `count` query and
 * without lying: asking for exactly `size` rows and getting `size` back cannot
 * distinguish "the page is full and there are more" from "the page is full and
 * that was the last of them", so a naive implementation shows a Next button on
 * the final page of every table whose size divides evenly.
 */
export function pageWindow(page, size) {
  const from = Math.max(0, Math.floor(page)) * size;
  return { from, to: from + size };
}

/** Split the over-read into the page and the answer to "is there another?". */
export function splitPage(rows, size) {
  return { rows: rows.slice(0, size), hasMore: rows.length > size };
}

/**
 * Read every row, one ranged request at a time.
 *
 * `fetchPage(from, to)` must resolve to an array. It is called once per page
 * and the range is supplied HERE — the caller never states it and therefore
 * cannot omit it. `onOverflow` is called (and expected to throw) if the ceiling
 * is reached.
 */
export async function pageAll(fetchPage, { size = PAGE_SIZE, maxPages = MAX_PAGES, onOverflow }) {
  const all = [];
  for (let page = 0; ; page++) {
    if (page >= maxPages) {
      onOverflow(maxPages * size);
      throw new Error(`paging ceiling of ${maxPages * size} rows reached`);
    }
    const { from, to } = pageBounds(page, size);
    const batch = await fetchPage(from, to);
    for (const row of batch) all.push(row);
    if (isLastPage(batch.length, size)) return all;
  }
}
