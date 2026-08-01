/**
 * THE TYPE-LEVEL HALF OF THE PAGINATION GUARANTEE, asserted by `tsc` itself.
 *
 * `lib/data/db.ts` claims that an unbounded list read is not expressible. This
 * file is where that claim is CHECKED, on every `npm run typecheck`, rather
 * than merely asserted in a comment.
 *
 * Each `@ts-expect-error` below is an assertion that the line after it does NOT
 * compile. TypeScript reports an UNUSED `@ts-expect-error` as error TS2578, so
 * if any of these calls ever became legal — someone adds a default limit, or an
 * unbounded overload — this file stops compiling and `npm run typecheck` fails
 * naming the exact contract that was broken. That is the both-ways property:
 * the directive fires only while the thing it describes is genuinely illegal.
 *
 * The positive cases at the bottom are the other half. Without them, deleting
 * the entire data layer would also make this file "pass".
 *
 * Nothing here is called at runtime; it exists to be compiled.
 */

import type { ServerClient } from "@/lib/supabase/server";
import { readAll, readAtMost, readPage, readOne, readCount } from "./db";

/* eslint-disable @typescript-eslint/no-unused-vars */

// --- what must NOT compile ------------------------------------------------

/** `readAtMost` has no default limit. "Just read the rows" is not expressible. */
export function limitIsNotOptional(supabase: ServerClient) {
  // @ts-expect-error — a bound is required: readAtMost(source, build, limit)
  return readAtMost("contract", () => supabase.from("customers").select("id"));
}

/** `readPage` requires BOTH the page and its size; neither has a default. */
export function pageSizeIsNotOptional(supabase: ServerClient) {
  // @ts-expect-error — { page, size } is required and `size` is not optional
  return readPage("contract", () => supabase.from("customers").select("id"), { page: 0 });
}

/**
 * A `build` callback must return something rangeable.
 *
 * This is what stops a repository from "helpfully" awaiting the query itself
 * and handing the gateway a finished array — which would restore exactly the
 * unbounded read the gateway exists to prevent.
 */
export function buildMustReturnAnUnresolvedQuery(supabase: ServerClient) {
  // @ts-expect-error — an awaited result is not rangeable; the gateway must own the range
  return readAll("contract", async () => await supabase.from("customers").select("id"));
}

/** A single-row read is not a list read, and cannot be passed off as one. */
export function readAllRejectsASingleRowQuery(supabase: ServerClient) {
  // @ts-expect-error — `.maybeSingle()` is not rangeable
  return readAll("contract", () => supabase.from("customers").select("id").maybeSingle());
}

// --- what MUST compile ----------------------------------------------------
//
// Without these, an empty or broken `db.ts` would satisfy the block above by
// making every call illegal for the wrong reason.

export function everyBoundedFormIsLegal(supabase: ServerClient) {
  const all = readAll("contract", () => supabase.from("customers").select("id"));
  const some = readAtMost("contract", () => supabase.from("customers").select("id"), 25);
  const page = readPage("contract", () => supabase.from("customers").select("id"), {
    page: 0,
    size: 50,
  });
  const one = readOne("contract", supabase.from("customers").select("id").limit(1).maybeSingle());
  const count = readCount(
    "contract",
    supabase.from("customers").select("id", { count: "exact", head: true }),
  );
  return { all, some, page, one, count };
}
