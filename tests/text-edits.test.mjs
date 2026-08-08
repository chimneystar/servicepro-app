// The offset applier behind the ledger 6.5 codemods, proven both ways.
//
// This file exists because the bug it pins actually shipped into the working
// tree: an insertion and a deletion sharing a start offset were ordered by a
// sort that did not disambiguate them, the insertion landed first, and the
// deletion's end offset — now stale by the length of the inserted text — ate
// live source in 54 files. `<label style={{ display: "block" }}>` became
// `<label{ display: "block" }}>`. Typecheck caught it, but only because the
// wreckage happened not to parse; a corruption that still parsed would have
// gone in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits, assertDisjoint } from "../scripts/lib/text-edits.mjs";

const LABEL = `<label style={{ display: "block" }}>`;
// tagName ends at 6; the style attribute is [7, 35); the codemod eats the space
// before it, so its deletion is [6, 35).

test("a deletion and a trailing insertion compose", () => {
  assert.equal(
    applyEdits(LABEL, [
      { start: 6, end: 35, text: "" },
      { start: 35, end: 35, text: ' className="sp-field"' },
    ]),
    `<label className="sp-field">`,
  );
});

test("an insertion at the SAME start as a deletion still composes", () => {
  // The exact shape that broke. The wider range must be applied first.
  assert.equal(
    applyEdits(LABEL, [
      { start: 6, end: 35, text: "" },
      { start: 6, end: 6, text: ' className="sp-field"' },
    ]),
    `<label className="sp-field">`,
  );
});

test("the naive order really does corrupt — the guard is not guarding nothing", () => {
  // Both ways. Sorting by `start` alone and applying in that order reproduces
  // the original corruption, so the fix above is load-bearing rather than
  // decorative.
  let broken = LABEL;
  for (const e of [
    { start: 6, end: 6, text: ' className="sp-field"' },
    { start: 6, end: 35, text: "" },
  ]) {
    broken = broken.slice(0, e.start) + e.text + broken.slice(e.end);
  }
  assert.notEqual(broken, `<label className="sp-field">`);
  assert.match(broken, /display/, "the naive order leaves live source behind");
});

test("overlapping ranges are refused rather than silently mangled", () => {
  assert.throws(
    () =>
      applyEdits(LABEL, [
        { start: 0, end: 10, text: "" },
        { start: 5, end: 15, text: "" },
      ]),
    /overlapping/,
  );
  assert.throws(
    () =>
      assertDisjoint([
        { start: 0, end: 10, text: "" },
        { start: 5, end: 5, text: "x" },
      ]),
    /inside a deleted range/,
  );
});

test("edits that do not interact are applied independently", () => {
  const src = "aaaaBBBBcccc";
  assert.equal(
    applyEdits(src, [
      { start: 4, end: 8, text: "-" },
      { start: 0, end: 0, text: ">" },
      { start: 12, end: 12, text: "<" },
    ]),
    ">aaaa-cccc<",
  );
});
