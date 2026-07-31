/**
 * Paging primitives shared by every export in the product.
 *
 * PostgREST caps a response at a default 1000 rows. An unpaginated `select()`
 * therefore returns a SHORT ANSWER WITH NO ERROR — the accounting export shipped
 * truncated ledgers to accountants for exactly this reason. There is now one
 * implementation of "read all of it", used by both the accounting CSVs and the
 * whole-business export, so the two cannot drift apart.
 */

// @ts-ignore — pure, unit-tested manifest and paging arithmetic (tests/business-export.test.mjs)
import {
  EXPORT_PAGE_SIZE,
  EXPORT_MAX_PAGES,
  pageRange,
  isLastPage,
} from "@/lib/core/export-manifest.mjs";

export type PageBuilder<T> = (
  fromRow: number,
  toRow: number,
) => PromiseLike<{ data: T[] | null; error: unknown }>;

/**
 * Yield every page of a query in order, without ever holding more than one page.
 * Used by the streaming export so a business with 200k audit rows does not have
 * to fit its whole history in server memory at once.
 */
export async function* pageThrough<T>(build: PageBuilder<T>): AsyncGenerator<T[], void, void> {
  for (let page = 0; ; page++) {
    const { from, to } = pageRange(page, EXPORT_PAGE_SIZE);
    const { data, error } = await build(from, to);
    if (error) throw error;
    const batch = data ?? [];
    if (batch.length) yield batch;
    if (isLastPage(batch.length, EXPORT_PAGE_SIZE)) return;
    if (page >= EXPORT_MAX_PAGES) throw new Error("export_too_large");
  }
}

/**
 * Read every row into memory. Correct for the accounting CSVs, which must be
 * built as one string anyway; the whole-business export uses pageThrough instead.
 */
export async function fetchAllPages<T>(build: PageBuilder<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const batch of pageThrough<T>(build)) all.push(...batch);
  return all;
}
