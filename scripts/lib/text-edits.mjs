/**
 * Apply text-range edits to a source string.
 *
 * THE BUG THIS EXISTS TO PREVENT. An insertion (start === end) and a deletion
 * can share a start offset — removing `style={...}` from `<label style={...}>`
 * while inserting ` className="..."` right after `label` is exactly that case.
 * Sorting only by `start` leaves their relative order to the sort's whim. If
 * the insertion lands first, the deletion's END offset is now stale by the
 * length of the inserted text and it eats live source: the first run of this
 * codemod turned `<label style={{ display: "block" }}>` into
 * `<label{ display: "block" }}>` in 54 files.
 *
 * Two rules fix it: apply strictly right-to-left, and at an equal start apply
 * the WIDER range first, so every insertion lands only after the range it sits
 * inside has already gone. `assertDisjoint` refuses anything this cannot order.
 */
export function applyEdits(src, edits) {
  assertDisjoint(edits);
  const ordered = [...edits].sort(
    (a, b) => b.start - a.start || b.end - b.start - (a.end - a.start),
  );
  let out = src;
  for (const e of ordered) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Overlapping non-identical ranges cannot be applied by offset at all. */
export function assertDisjoint(edits) {
  const ranges = edits.filter((e) => e.end > e.start).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) {
      throw new Error(
        `overlapping edits: [${ranges[i - 1].start},${ranges[i - 1].end}) and ` +
          `[${ranges[i].start},${ranges[i].end})`,
      );
    }
  }
  for (const ins of edits.filter((e) => e.end === e.start)) {
    for (const r of ranges) {
      if (ins.start > r.start && ins.start < r.end) {
        throw new Error(`insertion at ${ins.start} is inside a deleted range`);
      }
    }
  }
}
