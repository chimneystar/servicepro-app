import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Findings A1 (the type scale was inverted) and A2 (the "Larger text" toggle
// did nothing).
//
// A2 is the reason none of these tests look for the presence of a rule. The
// defect WAS a present rule: `html[data-text-scale="large"]{font-size:112.5%}`
// existed, was correct CSS, and moved the root from 16px to 18px — and not one
// element on any screen changed size, because every one of the 384 stylesheet
// declarations and ~705 inline `fontSize` props was an absolute `px`. A probe
// that asserted the rule exists would have passed against the broken product.
// So these probes COMPUTE: they resolve every font size in the product at a
// 16px root and again at the root the toggle produces, and require the number
// to actually move.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS_PATH = path.join(ROOT, "app/globals.css");

/** The floor below which no text may be sized, in px at the default root. */
const MIN_TEXT_PX = 12;
const DEFAULT_ROOT_PX = 16;

/** Comments cannot satisfy a structural check. Strip them first. */
const stripCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, " ");

// --- parsing ---------------------------------------------------------------

/**
 * Every font-size-bearing declaration in a stylesheet, as
 * `{ selector, value }`. Covers the `font:` shorthand as well, which also sets
 * a size and was a hole the first pass missed.
 */
function cssFontSizes(rawCss) {
  const css = stripCssComments(rawCss);
  const out = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim().replace(/\s+/g, " ");
    const body = rule[2];
    // The root rule is the toggle's DEFINITION — the one declaration that is
    // allowed (and required) to be a percentage of the reader's own default.
    // Everything else is a consumer of it and must be rem.
    if (/^html\[data-text-scale/.test(selector)) continue;
    for (const decl of body.matchAll(/(?:^|;)\s*font-size\s*:\s*([^;}]+)/g)) {
      out.push({ selector, value: decl[1].trim() });
    }
    for (const decl of body.matchAll(/(?:^|;)\s*font\s*:\s*([^;}]+)/g)) {
      const value = decl[1].trim();
      if (value === "inherit" || value === "initial" || value === "unset") continue;
      out.push({ selector, value });
    }
  }
  return out;
}

/** Length tokens in a value, as `{ number, unit }`. */
const lengths = (value) =>
  [...value.matchAll(/(-?\d*\.?\d+)\s*(rem|em|px|pt|vw|vh|vmin|vmax|ch|ex|%)/g)]
    .map((m) => ({ number: Number(m[1]), unit: m[2] }));

/**
 * Resolve a font-size value against a root font-size. Returns `null` when the
 * value contains no length at all (`inherit`). Only `rem` follows the root —
 * that is the whole point.
 */
function resolvePx(value, rootPx) {
  const found = lengths(value);
  if (found.length === 0) return null;
  const sizes = found.map((l) => (l.unit === "rem" ? l.number * rootPx : l.number));
  // `clamp(a, b, c)` / `min()` / `max()` can hold several; the largest is the
  // one that decides whether the text is legible at the top of its range, and
  // the smallest decides the floor. Both are returned so callers can pick.
  return { min: Math.min(...sizes), max: Math.max(...sizes), units: found.map((l) => l.unit) };
}

// --- inline `fontSize` props ------------------------------------------------

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "e2e"]);
// Owned by other workstreams on this branch; not rewritten by this pass.
const SKIP_FILES = [/components[\\/]Nav\.tsx$/, /[\\/]actions\.ts$/, /app[\\/]api[\\/]/];

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Every inline `fontSize:` prop expression under app/ and components/. */
function inlineFontSizes() {
  const out = [];
  for (const dir of ["app", "components"]) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      if (SKIP_FILES.some((re) => re.test(file))) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/fontSize\s*:\s*([^,}]+)/g)) {
        out.push({ file: path.relative(ROOT, file), expression: m[1].trim() });
      }
    }
  }
  return out;
}

const quoted = (expression) =>
  [...expression.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);

/** Unquoted numbers in a React style prop. React renders these verbatim as `px`. */
const bareNumbers = (expression) =>
  [...expression.replace(/"[^"]*"|'[^']*'/g, '""').matchAll(/(?:^|[^\w.$])(\d+(?:\.\d+)?)/g)]
    .map((m) => Number(m[1]));

const hasBareNumber = (expression) => bareNumbers(expression).length > 0;

/**
 * Every size an inline prop can produce, in px at the given root — quoted
 * lengths AND bare numbers. Counting only the quoted ones would make the floor
 * check vacuous against the pre-change source, where every prop was a bare
 * number: the probe would have reported the defect as absent.
 */
function inlineSizesPx(expression, rootPx) {
  const out = bareNumbers(expression).map((n) => ({ label: String(n), px: n }));
  for (const literal of quoted(expression)) {
    const resolved = resolvePx(literal, rootPx);
    if (resolved) out.push({ label: literal, px: resolved.min });
  }
  return out;
}

const CSS = readFileSync(CSS_PATH, "utf8");
const CSS_SIZES = cssFontSizes(CSS);
const INLINE_SIZES = inlineFontSizes();

// ---------------------------------------------------------------------------
// The parsers themselves must be able to fail. Each is run against a verbatim
// sample of the PRE-CHANGE source, so a probe that silently stopped finding
// anything cannot go green.
// ---------------------------------------------------------------------------

// Copied verbatim from app/globals.css @ 1cac6b8, before this fix.
const PRE_CHANGE_CSS = `
.dashboard-attention > a strong { overflow:hidden; font-size:9.5px; text-overflow:ellipsis; white-space:nowrap; }
.dashboard-attention > a small { color:var(--muted); font-size:8px; }
.job-pulse-track strong { grid-column:2; overflow:hidden; margin-top:8px; font-size:10px; }
.booking-services strong { font-size:14px; }
.booking-services small { max-width:430px; color:var(--muted); font-size:9.5px; line-height:1.45; }
.dashboard-hero h1 { position:relative; z-index:1; margin:0; color:#fff; font-size:clamp(29px,4vw,47px)!important; }
.job-pulse-track i { width:28px; height:28px; font-size:7px; }
.helcim-status-orbit span { color: #fff; font: 900 25px/1 "Rubik",sans-serif; }
`;
const PRE_CHANGE_INLINE = [
  { file: "app/(app)/page.tsx", expression: "small ? 22 : 28" },
  { file: "app/(app)/jobs/page.tsx", expression: "12.5" },
  { file: "components/DocList.tsx", expression: "9" },
];

test("the parser finds the sizes it is supposed to find (cry-wolf guard)", () => {
  const pre = cssFontSizes(PRE_CHANGE_CSS);
  assert.equal(pre.length, 8, "8 declarations in the pre-change sample, one of them a `font:` shorthand");
  assert.ok(CSS_SIZES.length > 350, `expected the real stylesheet to yield hundreds of sizes, got ${CSS_SIZES.length}`);
  assert.ok(INLINE_SIZES.length > 600, `expected hundreds of inline props, got ${INLINE_SIZES.length}`);
});

test("the stylesheet is structurally valid", () => {
  // Caught a real break during this pass: moving the responsive block left a
  // stray `}` that the rule-level regex above happily parsed around, while
  // PostCSS refused the file and the whole build failed. A probe that cannot
  // see a broken stylesheet is not a stylesheet probe.
  const css = stripCssComments(CSS);
  let depth = 0;
  let lowest = 0;
  for (const ch of css) {
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      lowest = Math.min(lowest, depth);
    }
  }
  assert.equal(depth, 0, "unbalanced braces in app/globals.css");
  assert.equal(lowest, 0, "a closing brace appears before its opening brace");
  assert.equal(stripCssComments("/* { */ a{}").trim(), "a{}");
});

test("a comment cannot satisfy a font-size check", () => {
  const disguised = "/* .x { font-size: 4px; } */ .y { font-size: 1rem; }";
  const found = cssFontSizes(disguised);
  assert.equal(found.length, 1);
  assert.equal(found[0].selector, ".y");
});

// ---------------------------------------------------------------------------
// A1 — nothing may be smaller than the floor.
// ---------------------------------------------------------------------------

test(`A1: no stylesheet font-size resolves below ${MIN_TEXT_PX}px`, () => {
  const tooSmall = CSS_SIZES
    .map((d) => ({ ...d, resolved: resolvePx(d.value, DEFAULT_ROOT_PX) }))
    .filter((d) => d.resolved && d.resolved.min < MIN_TEXT_PX);
  assert.deepEqual(
    tooSmall.map((d) => `${d.selector} -> ${d.value}`),
    [],
    "these rules put text below the legibility floor",
  );
});

test(`A1: no inline fontSize prop resolves below ${MIN_TEXT_PX}px`, () => {
  const tooSmall = [];
  for (const item of INLINE_SIZES) {
    for (const size of inlineSizesPx(item.expression, DEFAULT_ROOT_PX)) {
      if (size.px < MIN_TEXT_PX) tooSmall.push(`${item.file}: ${size.label}`);
    }
  }
  assert.deepEqual(tooSmall, []);

  // Both ways: the same check against the pre-change props, which were bare
  // numbers and would otherwise have slipped through a quoted-literal scan.
  const preTooSmall = PRE_CHANGE_INLINE.flatMap((item) =>
    inlineSizesPx(item.expression, DEFAULT_ROOT_PX).filter((s) => s.px < MIN_TEXT_PX),
  );
  assert.equal(preTooSmall.length, 1, "9px was under the floor before this fix");
});

test("A1: the floor check REJECTS the pre-change stylesheet", () => {
  // The other half of the both-ways proof. If this ever passes, the check above
  // has stopped being a check.
  const tooSmall = cssFontSizes(PRE_CHANGE_CSS)
    .map((d) => ({ ...d, resolved: resolvePx(d.value, DEFAULT_ROOT_PX) }))
    .filter((d) => d.resolved && d.resolved.min < MIN_TEXT_PX);
  assert.equal(tooSmall.length, 6, "9.5, 8, 10, 9.5, 29-in-clamp and 7 are all under the floor");
  assert.ok(tooSmall.some((d) => d.resolved.min === 7), "the 7px rule must be caught");
});

// ---------------------------------------------------------------------------
// A1 — the important text on a screen is not the smallest thing on it.
// ---------------------------------------------------------------------------

/** Smallest size the stylesheet gives a selector, in px at the default root. */
function sizeOf(selector, pick = "min") {
  const matches = CSS_SIZES.filter((d) => d.selector === selector);
  assert.ok(matches.length > 0, `no rule found for ${selector} — the test has drifted from the CSS`);
  const values = matches.map((d) => resolvePx(d.value, DEFAULT_ROOT_PX)).filter(Boolean).map((r) => r.max);
  return pick === "min" ? Math.min(...values) : Math.max(...values);
}

test("A1: the text a person is reading is at least body size", () => {
  const required = [
    [".job-pulse-track strong", 14, "the customer's name on the dashboard (was 10px)"],
    [".dashboard-attention > a strong", 14, "the alert headline (was 9.5px)"],
    [".dashboard-attention > a small", 13, "the alert copy (was 8px)"],
    [".booking-services strong", 16, "the service a customer must choose (was 14px)"],
    [".booking-services small", 13, "that service's metadata (was 9.5px)"],
    [".dashboard-hero > div p", 14, "the dashboard lead paragraph (was 12px)"],
  ];
  for (const [selector, min, why] of required) {
    assert.ok(sizeOf(selector) >= min, `${selector} (${why}) is ${sizeOf(selector)}px, needs >= ${min}px`);
  }
});

test("A1: display type is not an inversion of the content beside it", () => {
  // Measured by the owner: greeting 47px, customer's name beside it 10px — a
  // 4.7x ratio pointing the wrong way round.
  const greeting = sizeOf(".dashboard-hero h1", "max");
  const customerName = sizeOf(".job-pulse-track strong");
  assert.ok(greeting <= 32, `the greeting is ${greeting}px; display type is capped at 32px`);
  assert.ok(
    greeting / customerName <= 3,
    `greeting ${greeting}px vs customer name ${customerName}px is a ${(greeting / customerName).toFixed(1)}x inversion`,
  );
  // An eyebrow label is decoration; it must not outrank the content under it.
  assert.ok(sizeOf(".dashboard-live") < customerName);
});

// ---------------------------------------------------------------------------
// A2 — the toggle must CHANGE something. This is the whole finding.
// ---------------------------------------------------------------------------

/** The root font-size the "Larger text" toggle actually produces, in px. */
function largeRootPx() {
  const rule = /html\[data-text-scale="large"\]\s*\{([^}]*)\}/.exec(stripCssComments(CSS));
  assert.ok(rule, "the large-text rule is gone entirely");
  const pct = /font-size\s*:\s*([\d.]+)%/.exec(rule[1]);
  assert.ok(pct, "the large-text rule no longer sets a root font-size");
  return (DEFAULT_ROOT_PX * Number(pct[1])) / 100;
}

test("A2: turning the toggle on moves EVERY stylesheet font-size", () => {
  const largeRoot = largeRootPx();
  assert.ok(largeRoot > DEFAULT_ROOT_PX, "the toggle does not raise the root at all");

  const unchanged = [];
  let changed = 0;
  for (const decl of CSS_SIZES) {
    const before = resolvePx(decl.value, DEFAULT_ROOT_PX);
    const after = resolvePx(decl.value, largeRoot);
    if (!before) continue; // `inherit` scales through its parent
    if (after.min > before.min && after.max > before.max) changed += 1;
    else unchanged.push(`${decl.selector} -> ${decl.value}`);
  }
  assert.deepEqual(unchanged, [], "these are pinned to an absolute unit and ignore the toggle");
  assert.ok(changed > 350, `only ${changed} declarations respond to the toggle`);
});

test("A2: turning the toggle on moves EVERY inline fontSize prop", () => {
  const largeRoot = largeRootPx();
  const unchanged = [];
  let changed = 0;
  for (const item of INLINE_SIZES) {
    if (hasBareNumber(item.expression)) {
      unchanged.push(`${item.file}: ${item.expression} (a bare number renders as px)`);
      continue;
    }
    const literals = quoted(item.expression);
    assert.ok(literals.length > 0, `${item.file}: ${item.expression} has no readable size`);
    for (const literal of literals) {
      const before = resolvePx(literal, DEFAULT_ROOT_PX);
      const after = resolvePx(literal, largeRoot);
      if (before && after.min > before.min) changed += 1;
      else unchanged.push(`${item.file}: ${literal}`);
    }
  }
  assert.deepEqual(unchanged, []);
  assert.ok(changed > 600, `only ${changed} inline props respond to the toggle`);
});

test("A2: the same computation shows the PRE-CHANGE product did not move at all", () => {
  // This is the measurement the owner made in a live browser — root 16px to
  // 18px, zero elements changed — reproduced statically. It is the reason the
  // two tests above are computations and not presence checks: the toggle rule
  // itself was already there and already correct.
  const largeRoot = 18;
  let changed = 0;
  for (const decl of cssFontSizes(PRE_CHANGE_CSS)) {
    const before = resolvePx(decl.value, DEFAULT_ROOT_PX);
    const after = resolvePx(decl.value, largeRoot);
    if (before && after.max > before.max) changed += 1;
  }
  assert.equal(changed, 0, "the pre-change stylesheet must be provably inert under the toggle");

  for (const item of PRE_CHANGE_INLINE) {
    assert.ok(hasBareNumber(item.expression), `${item.expression} is a px number React writes verbatim`);
  }
});

test("A2: every font size in the product is expressed in rem", () => {
  // The mechanism guarantee, stated once. `rem` is the only unit that follows
  // the root, so unit purity IS the proof that nothing can opt out of the
  // toggle — including inline styles, which no stylesheet can reach.
  const wrong = [];
  for (const decl of CSS_SIZES) {
    for (const unit of resolvePx(decl.value, DEFAULT_ROOT_PX)?.units ?? []) {
      if (unit !== "rem") wrong.push(`${decl.selector} -> ${decl.value} (${unit})`);
    }
  }
  for (const item of INLINE_SIZES) {
    for (const literal of quoted(item.expression)) {
      for (const unit of resolvePx(literal, DEFAULT_ROOT_PX)?.units ?? []) {
        if (unit !== "rem") wrong.push(`${item.file}: ${literal} (${unit})`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

test("A2: the toggle is still wired from the cookie to the html element", () => {
  // Necessary but nowhere near sufficient — hence its position last.
  const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
  assert.match(layout, /data-text-scale=\{textScale\}/);
  assert.match(layout, /ui_text_scale/);
});

// ---------------------------------------------------------------------------
// Do not break the layout in the other direction.
// ---------------------------------------------------------------------------

test("no fixed-height box is now too small for the text inside it", () => {
  // Raising a floor can push text out of a pill, badge or avatar that was
  // sized around 8px type. A box with an explicit height must leave at least
  // 1.3x the font size for the line.
  const css = stripCssComments(CSS);
  const tight = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = rule[2];
    const size = /(?:^|[;\s])font-size\s*:\s*([\d.]+)rem/.exec(body);
    const height = /(?:^|[;\s])height\s*:\s*([\d.]+)px/.exec(body);
    if (!size || !height) continue;
    const textPx = Number(size[1]) * DEFAULT_ROOT_PX;
    if (Number(height[1]) < textPx * 1.3) {
      tight.push(`${rule[1].trim()}: ${height[1]}px box around ${textPx}px text`);
    }
  }
  assert.deepEqual(tight, []);
});

test("dense screens still scroll rather than overflow", () => {
  // The dispatch board, the jobs list and the reports tables are the screens
  // with the least slack. Each keeps an explicit overflow escape, so larger
  // text lengthens or scrolls them instead of clipping.
  const css = stripCssComments(CSS);
  for (const selector of [".dispatch-board", ".job-pulse-track"]) {
    const rule = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
    assert.ok(rule, `${selector} not found`);
    assert.match(rule[1], /overflow-x\s*:\s*auto/, `${selector} must stay horizontally scrollable`);
  }
});

// ---------------------------------------------------------------------------
// Hebrew / RTL must not regress.
// ---------------------------------------------------------------------------

test("RTL still relies on logical properties, not physical ones", () => {
  const css = stripCssComments(CSS);
  const logical = (css.match(/(?:padding|margin|border|inset)-inline(?:-(?:start|end))?\s*:/g) ?? []).length;
  // 53 at 1cac6b8, the commit this pass started from. Hebrew/RTL was already
  // correct; this number may only go up.
  assert.ok(logical >= 53, `logical properties dropped to ${logical}; RTL is driven by these`);
  assert.match(css, /\.shell\s*\{[^}]*padding-inline-start/);
  assert.match(css, /text-align\s*:\s*start/);

  // Nothing this pass added may introduce a physical direction.
  const added = css.slice(css.indexOf("TYPE SCALE"));
  const typeScaleBlock = added.slice(0, added.indexOf("* { box-sizing"));
  assert.doesNotMatch(typeScaleBlock, /(?:^|[;{\s])(?:margin|padding|border)-(?:left|right)\s*:/);
});
