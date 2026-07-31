// The equivalence checker used to prove ledger 6.4 was formatting-only is
// itself a safety net, so it gets the same treatment every other guard on this
// branch gets: it is proven BOTH WAYS. A checker that never fires is worth
// nothing, and a checker that fires on legitimate reformatting would have
// forced the reformat to be abandoned or the checker to be loosened — which is
// the failure mode this codebase is full of.
//
// Below: 20 planted semantic mutations that MUST be caught, and 12 legitimate
// formatting rewrites that MUST NOT be. Every mutation is a real hazard of a
// mass reformat, not a strawman: precedence collapse, ASI, a swapped operator,
// a dropped `await`, an eaten eslint-disable comment, a reordered CSS
// declaration.

import test from "node:test";
import assert from "node:assert/strict";
import { compareSources } from "../scripts/format-equivalence.mjs";

const TSX = "sample.tsx";
const TS = "sample.ts";
const CSS = "sample.css";

function mismatches(file, before, after) {
  return compareSources(file, before, after);
}

/* ------------------------------------------------------------------ *
 * MUST FIRE — each of these is a behaviour change.
 * ------------------------------------------------------------------ */
const MUST_FIRE = [
  ["binary operator swapped", TS, `const t = a + b;`, `const t = a - b;`],
  ["loose equality substituted", TS, `if (a === b) f();`, `if (a == b) f();`],
  ["const relaxed to let", TS, `const x = 1;`, `let x = 1;`],
  ["negation dropped", TS, `if (!ok) fail();`, `if (ok) fail();`],
  ["string literal value changed", TS, `const currency = "USD";`, `const currency = "EUR";`],
  [
    "argument order swapped",
    TS,
    `charge(amountMinor, feeMinor);`,
    `charge(feeMinor, amountMinor);`,
  ],
  ["a statement disappeared", TS, `a(); b(); c();`, `a(); c();`],
  [
    "type-only import became a value import",
    TS,
    `import type { A } from "m";`,
    `import { A } from "m";`,
  ],
  ["postfix became prefix increment", TS, `n = i++;`, `n = ++i;`],
  [
    "precedence collapsed when parens were removed",
    TS,
    `const t = (a + b) * c;`,
    `const t = a + b * c;`,
  ],
  ["numeric literal value changed", TS, `const rate = 0.075;`, `const rate = 0.75;`],
  ["optional chain flattened", TS, `const v = o?.p;`, `const v = o.p;`],
  ["await dropped", TS, `async function f() { await save(); }`, `async function f() { save(); }`],
  ["nullish coalescing became logical or", TS, `const v = a ?? b;`, `const v = a || b;`],
  [
    "property renamed",
    TS,
    `const o = { organizationId: id };`,
    `const o = { organisationId: id };`,
  ],
  ["JSX text changed", TSX, `const e = <p>Paid in full</p>;`, `const e = <p>Paid in part</p>;`],
  [
    "JSX attribute value changed",
    TSX,
    `const e = <input type="password" />;`,
    `const e = <input type="text" />;`,
  ],
  [
    "an eslint-disable comment was eaten",
    TS,
    `// eslint-disable-next-line no-console\nconsole.log(1);`,
    `console.log(1);`,
  ],
  ["css declaration value changed", CSS, `.a { color: red; }`, `.a { color: blue; }`],
  [
    "css declarations reordered (the cascade cares)",
    CSS,
    `.a { color: red; color: blue; }`,
    `.a { color: blue; color: red; }`,
  ],
  // The two insensitivities added AFTER the real run reported them (type
  // parens, CSS number spelling) each get a mutation proving they did not open
  // a hole. Widening a checker without this pair is how a net goes decorative.
  [
    "type grouping actually changed, not just re-parenthesised",
    TS,
    `type T = A & B | null;`,
    `type T = A & (B | null);`,
  ],
  [
    "array-of-array depth changed",
    TS,
    `function f(rows: any[][]) {}`,
    `function f(rows: any[]) {}`,
  ],
  [
    "css number value changed, not just respelled",
    CSS,
    `.a { opacity: .07; }`,
    `.a { opacity: .08; }`,
  ],
  ["css unit changed while the number stayed", CSS, `.a { margin: 8px; }`, `.a { margin: 8em; }`],
  [
    "css attribute-selector content changed",
    CSS,
    `[style*="background: #fff"] { color: red; }`,
    `[style*="background: #eee"] { color: red; }`,
  ],
  [
    // The whitespace collapse must not reach inside a quoted string, or a
    // changed `content` string would pass silently.
    "css string content changed only in its whitespace",
    CSS,
    `.a::after { content: "a, b"; }`,
    `.a::after { content: "a,b"; }`,
  ],
  [
    // Collapsing whitespace around combinators must not collapse the
    // descendant combinator, which is itself whitespace.
    "css descendant combinator removed before a pseudo-class",
    CSS,
    `.a :hover { color: red; }`,
    `.a:hover { color: red; }`,
  ],
  [
    "css media feature value changed",
    CSS,
    `@media (max-width: 980px) { .a { color: red; } }`,
    `@media (max-width: 981px) { .a { color: red; } }`,
  ],
];

for (const [name, file, before, after] of MUST_FIRE) {
  test(`equivalence check FIRES: ${name}`, () => {
    const found = mismatches(file, before, after);
    assert.ok(
      found.length > 0,
      `checker did not fire on a real semantic change:\n  before: ${before}\n  after:  ${after}`,
    );
  });
}

/* ------------------------------------------------------------------ *
 * MUST STAY SILENT — each of these is something Prettier actually does.
 * A false RED here is the same bug as a false GREEN above: it would have
 * forced the 6.4 reformat to be abandoned or the checker weakened.
 * ------------------------------------------------------------------ */
const MUST_BE_SILENT = [
  [
    "a minified one-liner expanded onto many lines",
    TS,
    `export function f(a){const b=a*2;if(b>3){return b}return 0}`,
    `export function f(a) {\n  const b = a * 2;\n  if (b > 3) {\n    return b;\n  }\n  return 0;\n}\n`,
  ],
  ["quote style normalised", TS, `const s = 'hello';`, `const s = "hello";`],
  ["escape spelling changed with the quotes", TS, `const s = 'it\\'s';`, `const s = "it's";`],
  ["missing semicolons inserted", TS, `const a = 1\nconst b = 2`, `const a = 1;\nconst b = 2;\n`],
  ["trailing comma added", TS, `f(\n  a,\n  b\n);`, `f(\n  a,\n  b,\n);`],
  ["arrow parens added", TS, `const f = x => x + 1;`, `const f = (x) => x + 1;`],
  ["redundant parens removed", TS, `const t = (a) + ((b));`, `const t = a + b;`],
  ["hex literal case normalised", TS, `const m = 0xFF;`, `const m = 0xff;`],
  [
    "indentation changed wholesale",
    TS,
    `function f(){\n\t\treturn 1;\n}`,
    `function f() {\n  return 1;\n}\n`,
  ],
  [
    "JSX reflowed across lines",
    TSX,
    `const e = <div className="a"><span>Total due</span></div>;`,
    `const e = (\n  <div className="a">\n    <span>Total due</span>\n  </div>\n);\n`,
  ],
  [
    "a block comment was re-indented",
    TS,
    `/**\n     * note\n     */\nconst a = 1;`,
    `/**\n * note\n */\nconst a = 1;\n`,
  ],
  [
    "css whitespace expanded",
    CSS,
    `.a{color:red;background:blue}`,
    `.a {\n  color: red;\n  background: blue;\n}\n`,
  ],
  [
    // Prettier's own device for keeping a significant space across a line
    // break. It renders identically, so it must not register as a change.
    'significant space rewritten as the {" "} Prettier emits',
    TSX,
    `const e = <p><b>a</b> <i>b</i></p>;`,
    `const e = (\n  <p>\n    <b>a</b> <i>b</i>\n  </p>\n);\n`,
  ],
  [
    "adjacent text children merged into one run",
    TSX,
    `const e = <p>Total due</p>;`,
    `const e = (\n  <p>\n    Total{" "}\n    due\n  </p>\n);\n`,
  ],
  // Both of these were reported by the real 6.4 run against 4d16aac and were
  // read by hand before the checker was widened to accept them.
  // app/(app)/reports/export/actions.ts:19
  [
    "redundant type parens removed",
    TS,
    `function f(rows: (any[])[]) {}`,
    `function f(rows: any[][]) {}`,
  ],
  // lib/payments/helcim.ts:58 — `&` already binds tighter than `|` in TS, so
  // the parens Prettier added are the grouping the type already had.
  [
    "explicit type parens added around the existing binding",
    TS,
    `type T = Partial<X> & { e?: unknown } | null;`,
    `type T = (Partial<X> & { e?: unknown }) | null;`,
  ],
  // app/globals.css — `rgba(17,32,64,.07)` became `rgba(17, 32, 64, 0.07)`.
  [
    "css leading zero added to a decimal",
    CSS,
    `.a { box-shadow: 0 8px 28px rgba(17, 32, 64, .07); }`,
    `.a {\n  box-shadow: 0 8px 28px rgba(17, 32, 64, 0.07);\n}\n`,
  ],
  ["css trailing zero removed", CSS, `.a { opacity: 0.50; }`, `.a { opacity: 0.5; }`],
  [
    "css leading zero added before a unit",
    CSS,
    `.a { transition: .001ms; }`,
    `.a { transition: 0.001ms; }`,
  ],
  [
    "css spaces inserted after commas in a function",
    CSS,
    `.a { color: rgba(0,0,0,.2); }`,
    `.a { color: rgba(0, 0, 0, 0.2); }`,
  ],
  ["css combinator spacing changed", CSS, `.a>.b{color:red}`, `.a > .b {\n  color: red;\n}\n`],
  [
    "css media feature colon spacing changed",
    CSS,
    `@media (max-width:980px){.a{color:red}}`,
    `@media (max-width: 980px) {\n  .a {\n    color: red;\n  }\n}\n`,
  ],
  [
    // app/globals.css:1501 — same matched substring, different quoting.
    "css attribute selector requoted without changing what it matches",
    CSS,
    `[style*="background: \\"#fff\\""] { color: red; }`,
    `[style*='background: "#fff"'] {\n  color: red;\n}\n`,
  ],
];

for (const [name, file, before, after] of MUST_BE_SILENT) {
  test(`equivalence check STAYS SILENT: ${name}`, () => {
    const found = mismatches(file, before, after);
    assert.equal(
      found.length,
      0,
      `checker raised a false alarm on a pure formatting change: ${JSON.stringify(found, null, 2)}`,
    );
  });
}

/* ------------------------------------------------------------------ *
 * The insensitivity to parentheses is the one place a lazy comparator
 * could hide a real bug, so it gets its own explicit pair.
 * ------------------------------------------------------------------ */
test("paren-insensitivity does not hide a precedence change", () => {
  assert.equal(mismatches(TS, `const t = (a + b) * c;`, `const t = ((a + b)) * c;`).length, 0);
  assert.ok(mismatches(TS, `const t = (a + b) * c;`, `const t = a + (b * c);`).length > 0);
});

test("JSX whitespace normalisation follows JSX's own rules, not a blanket trim", () => {
  // Leading/trailing newlines around JSX text are dropped by JSX itself.
  assert.equal(
    mismatches(TSX, `const e = <p>Hi</p>;`, `const e = (\n  <p>\n    Hi\n  </p>\n);\n`).length,
    0,
  );
  // A significant space between two inline elements is NOT dropped by JSX and
  // must not be dropped here either.
  assert.ok(
    mismatches(TSX, `const e = <p><b>a</b> <i>b</i></p>;`, `const e = <p><b>a</b><i>b</i></p>;`)
      .length > 0,
  );
});
