/**
 * THE DATA GATEWAY — the one place a list read is bounded, and the reason a
 * repository cannot forget to bound one.
 *
 * WHY THIS EXISTS
 * ---------------
 * PostgREST caps a response at a default 1000 rows. An unpaginated `.select()`
 * therefore returns a SHORT ANSWER WITH NO ERROR: HTTP 200, a thousand rows,
 * `error === null`. Nothing in the client, the types, or the screen can tell
 * that answer apart from a complete one. It has already cost this product real
 * money — the accounting export shipped truncated ledgers to an accountant, and
 * `app/(app)/reports/export/actions.ts` was fixed with `fetchAllPages` while
 * every other read in the codebase kept the defect.
 *
 * The repair for that one file was a helper plus a rule: "remember to call
 * `fetchAllPages`". A rule that has to be remembered is not a mechanism, and
 * the 130 unbounded reads elsewhere in the tree are the evidence.
 *
 * HOW THIS MAKES IT IMPOSSIBLE RATHER THAN DISCOURAGED
 * ---------------------------------------------------
 * Three layers, of decreasing strength:
 *
 * 1. **The caller never writes the bound, so it cannot omit it.** Every read
 *    below takes a `build` callback that returns a query *shape* and applies
 *    the range/limit ITSELF. `readAll` runs the `.range()` loop; `readPage`
 *    applies one page; `readAtMost` applies the limit it was given. There is no
 *    code path through this module that awaits a builder nobody bounded,
 *    because the module is the only thing that awaits a builder at all.
 *
 * 2. **There is no unbounded entry point to type.** `readAtMost(build, n)`
 *    takes `n` as a required positional parameter — omitting it is a compile
 *    error, not a default. There is deliberately no `read(build)` overload, so
 *    "just read the rows" does not exist as an expressible operation.
 *
 * 3. **Anything that bypasses this module fails the build.**
 *    `tests/data-layer.test.mjs` scans every `.from(...).select(...)` in the
 *    tree and requires each list read to be bounded — single-row, a head count,
 *    an explicit `.limit()`/`.range()`, or built through this gateway. Reads
 *    not yet migrated are pinned in an inventory that can only shrink, so a NEW
 *    unbounded read fails immediately no matter which file it is written in.
 *
 * ERRORS
 * ------
 * Every read here THROWS a `DataError` when PostgREST reports one. It never
 * returns `[]`. This is a deliberate reversal: 161 of the 189 reads in this
 * codebase ignored the `error` field, so a failed query rendered as an empty
 * screen and the operator concluded they had no customers. `app/error.tsx` is
 * the app-wide boundary, so a throw becomes a visible "something went wrong"
 * with a digest, which is a true statement, where an empty list is a false one.
 *
 * ROW-LEVEL SECURITY
 * ------------------
 * RLS filters rows; it does not error. A read that returns nothing means
 * *either* "no such row" *or* "you may not see it", and PostgREST cannot tell
 * you which. This module refuses to guess: `readOne` returns `null` and the
 * caller decides, and `readOneOrThrow` throws `NotFoundOrForbiddenError` —
 * named for both possibilities on purpose, so nothing downstream can quietly
 * turn "denied" into "deleted".
 */

import type { PostgrestError } from "@supabase/supabase-js";
import {
  POSTGREST_ROW_CAP,
  PAGE_SIZE,
  MAX_PAGES,
  pageBounds,
  isLastPage,
  clampLimit,
  pageAll,
} from "@/lib/core/paging.mjs";

export { POSTGREST_ROW_CAP, PAGE_SIZE, MAX_PAGES };

/**
 * What a failed read tells us. `PostgrestError` structurally, but declared here
 * so this module can also raise its own (the paging ceiling) without having to
 * fabricate a `toJSON` it would never call.
 */
type ReadFailure = {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

/** A read that failed. Carries PostgREST's own code so a caller can branch on it. */
export class DataError extends Error {
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;
  readonly source: string;

  constructor(source: string, cause: ReadFailure) {
    super(`[data:${source}] ${cause.message}`);
    this.name = "DataError";
    this.code = cause.code ?? null;
    this.details = cause.details ?? null;
    this.hint = cause.hint ?? null;
    this.source = source;
  }
}

/**
 * A single row was required and none came back.
 *
 * Named for BOTH possibilities because PostgREST reports them identically: with
 * row-level security on, "this id does not exist" and "this id belongs to
 * another organisation" are the same empty response. Calling this `NotFound`
 * would be a claim the data does not support.
 */
export class NotFoundOrForbiddenError extends Error {
  readonly source: string;
  constructor(source: string) {
    super(
      `[data:${source}] no row was returned. With row-level security this means ` +
        `either that no such row exists or that the caller may not see it; the two ` +
        `are indistinguishable from here.`,
    );
    this.name = "NotFoundOrForbiddenError";
    this.source = source;
  }
}

/** The shape every PostgREST builder resolves to. */
type Resolved<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * What a `build` callback must return: a query that can still be ranged.
 *
 * Structural on purpose. Naming postgrest-js's `PostgrestTransformBuilder`
 * would tie this file to that package's internal generic order, which is
 * exactly the coupling that broke when `@supabase/ssr` and `supabase-js` fell
 * out of step (every query typed `never`, 1,139 errors). What this module
 * actually needs is "something rangeable that resolves to rows", and that is
 * what it asks for.
 */
export type Rangeable<T> = PromiseLike<Resolved<T>> & {
  range(from: number, to: number): PromiseLike<Resolved<T>>;
  limit(count: number): PromiseLike<Resolved<T>>;
};

/** A query shape. The gateway supplies the bound; this supplies everything else. */
export type Build<T> = () => Rangeable<T>;

async function resolve<T>(source: string, query: PromiseLike<Resolved<T>>): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new DataError(source, error);
  return data ?? [];
}

/**
 * Every row the query matches, paged until the source is exhausted.
 *
 * The caller supplies no range and cannot: this applies `.range()` per page
 * itself. That is the whole point — `fetchAllPages((a, b) => q.range(a, b))`
 * still let a caller pass a builder it never ranged, and this does not.
 *
 * `source` is a label used in errors, e.g. `"customers.listActive"`.
 */
export function readAll<T>(source: string, build: Build<T>): Promise<T[]> {
  return pageAll<T>((from, to) => resolve(source, build().range(from, to)), {
    onOverflow: (ceiling) => {
      throw new DataError(source, {
        message:
          `refused to page past ${ceiling} rows. A read this large is a missing ` +
          `filter, not a big business; narrow it or stream it with readPages.`,
        code: "SP_TOO_MANY_ROWS",
      });
    },
  });
}

/**
 * Every row, one page at a time, without ever holding more than a page.
 *
 * For streaming callers (the whole-business export) that must not materialise
 * a 200k-row table in server memory. Shares `pageBounds`/`isLastPage` with
 * `readAll` so the two cannot disagree about where a sequence ends.
 */
export async function* readPages<T>(source: string, build: Build<T>): AsyncGenerator<T[]> {
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      throw new DataError(source, {
        message: `refused to page past ${MAX_PAGES * PAGE_SIZE} rows`,
        code: "SP_TOO_MANY_ROWS",
      });
    }
    const { from, to } = pageBounds(page);
    const batch = await resolve(source, build().range(from, to));
    if (batch.length) yield batch;
    if (isLastPage(batch.length)) return;
  }
}

/** One page of a list, plus whether there is another. For screens that paginate visibly. */
export type Page<T> = {
  readonly rows: T[];
  readonly page: number;
  readonly size: number;
  readonly hasMore: boolean;
};

/**
 * One page. `hasMore` is derived by asking for one row more than the page and
 * discarding it, so a screen can render "next" without a second count query
 * and without lying when the total is exactly a multiple of the page size.
 */
export async function readPage<T>(
  source: string,
  build: Build<T>,
  { page, size }: { page: number; size: number },
): Promise<Page<T>> {
  const p = Math.max(0, Math.floor(page));
  const s = clampLimit(size);
  const from = p * s;
  const rows = await resolve(source, build().range(from, from + s));
  return { rows: rows.slice(0, s), page: p, size: s, hasMore: rows.length > s };
}

/**
 * At most `limit` rows. The limit is a REQUIRED parameter with no default, so a
 * caller that means "the ten most recent" says ten, and a caller that means
 * "all of them" has to say `readAll` and accept the paging.
 *
 * `limit` is clamped below PostgREST's cap: a caller asking for 5000 in one
 * request would silently receive 1000, which is the original defect wearing an
 * explicit-looking number.
 */
export async function readAtMost<T>(source: string, build: Build<T>, limit: number): Promise<T[]> {
  return resolve(source, build().limit(clampLimit(limit)));
}

/** A builder that resolves to a single row (`.single()` / `.maybeSingle()`). */
export type One<T> = PromiseLike<{ data: T | null; error: PostgrestError | null }>;

/**
 * One row, or `null`.
 *
 * PGRST116 ("no rows returned") is NOT an error here — it is the `null` case,
 * and `.single()` reports it as an error while `.maybeSingle()` does not.
 * Normalising it means a repository can use either and the caller sees the same
 * thing.
 */
export async function readOne<T>(source: string, query: One<T>): Promise<T | null> {
  const { data, error } = await query;
  if (error && error.code !== "PGRST116") throw new DataError(source, error);
  return data ?? null;
}

/**
 * One row, or throw.
 *
 * The throw is `NotFoundOrForbiddenError`, never `NotFound`: see the class.
 */
export async function readOneOrThrow<T>(source: string, query: One<T>): Promise<T> {
  const row = await readOne(source, query);
  if (row === null) throw new NotFoundOrForbiddenError(source);
  return row;
}

/** A `head: true, count: "exact"` query. Returns no rows, so it needs no bound. */
export type Counted = PromiseLike<{ count: number | null; error: PostgrestError | null }>;

/** How many rows match, without transferring any of them. */
export async function readCount(source: string, query: Counted): Promise<number> {
  const { count, error } = await query;
  if (error) throw new DataError(source, error);
  return count ?? 0;
}
