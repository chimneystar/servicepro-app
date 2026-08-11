// `tests/helpers/source-shape.mjs` is load-bearing: after ledger 6.4 a dozen
// structural probes match their regexes against its output rather than against
// raw source. If it over-normalised, every one of those probes would go green
// against code that no longer has the property it guards — the exact
// "decorative safety net" failure this branch exists to remove. So it is proven
// both ways here:
//
//   SILENT  the reformatting Prettier actually performed must not change the
//           shape, or the probes would have had to be relaxed instead.
//   FIRES   a real change to the call, its arguments or its strings must
//           change the shape, or the probes would be worthless.

import test from "node:test";
import assert from "node:assert/strict";
import { codeShape } from "./helpers/source-shape.mjs";

const TS = "probe.ts";
const TSX = "probe.tsx";

/* ------------------------------------------------------------------ *
 * Reformatting must not change the shape.
 * ------------------------------------------------------------------ */
const SAME = [
  [
    "a call broken across lines",
    TS,
    `q.eq("status", "approved");`,
    `q.eq(\n  "status",\n  "approved",\n);`,
  ],
  [
    "a chained builder split onto one call per line",
    TS,
    `await supabase.from("price_book").insert(items);`,
    `await supabase\n  .from("price_book")\n  .insert(items);\n`,
  ],
  [
    "an object argument expanded with a trailing comma",
    TS,
    `rpc("accept_invitation", { invite_token: inviteToken });`,
    `rpc("accept_invitation", {\n  invite_token: inviteToken,\n});\n`,
  ],
  [
    "an import list expanded",
    TS,
    `import { a, b, c } from "m";`,
    `import {\n  a,\n  b,\n  c,\n} from "m";\n`,
  ],
  ["indentation and blank lines", TS, `if (a) {\n  f();\n}`, `\n\nif (a) {\n\n      f();\n\n}\n\n`],
  ["a comment removed by the formatter's reflow", TS, `// note\nf();`, `f();`],
  [
    "a long condition wrapped",
    TS,
    `if (profile.role === "owner" || profile.role === "office") return;`,
    `if (\n  profile.role === "owner" ||\n  profile.role === "office"\n)\n  return;\n`,
  ],
  [
    "JSX attributes reflowed onto separate lines",
    TSX,
    `const e = <Panel title="Jobs" count={n} />;`,
    `const e = <Panel\n    title="Jobs"\n    count={n}\n  />;\n`,
  ],
  [
    "JSX children reflowed",
    TSX,
    `const e = <div className="row"><span>{total}</span></div>;`,
    `const e = <div className="row">\n  <span>{total}</span>\n</div>;\n`,
  ],
];

for (const [name, file, a, b] of SAME) {
  test(`source shape is BLIND to formatting: ${name}`, () => {
    assert.equal(codeShape(a, file), codeShape(b, file), `shape changed:\n  ${a}\n  ${b}`);
  });
}

/* ------------------------------------------------------------------ *
 * Real changes must change the shape.
 * ------------------------------------------------------------------ */
const DIFFERENT = [
  ["the filter value changed", TS, `q.eq("status", "approved");`, `q.eq("status", "pending");`],
  ["the filter column changed", TS, `q.eq("status", "approved");`, `q.eq("state", "approved");`],
  [
    "the table changed",
    TS,
    `supabase.from("price_book").insert(x);`,
    `supabase.from("catalog").insert(x);`,
  ],
  [
    "the call was removed",
    TS,
    `supabase.from("price_book").insert(x);`,
    `supabase.from("price_book");`,
  ],
  ["insert became upsert", TS, `t.insert(x);`, `t.upsert(x);`],
  ["a named argument was dropped", TS, `rpc("a", { x: 1, y: 2 });`, `rpc("a", { x: 1 });`],
  [
    "an argument was renamed",
    TS,
    `rpc("accept_invitation", { invite_token: t });`,
    `rpc("accept_invitation", { email: t });`,
  ],
  [
    // The one that matters most: whitespace INSIDE a string is content.
    "whitespace inside a string literal",
    TS,
    `const m = "Total  due";`,
    `const m = "Total due";`,
  ],
  ["a template literal's text", TS, "const m = `a ${x} b`;", "const m = `a ${x} c`;"],
  ["a regex literal", TS, `const r = /a+/;`, `const r = /a*/;`],
  ["two identifiers must not merge", TS, `const x = 1;`, `constx = 1;`],
  ["an operator", TS, `if (a === b) f();`, `if (a !== b) f();`],
  [
    "a JSX prop value",
    TSX,
    `const e = <Panel title="Jobs" />;`,
    `const e = <Panel title="Leads" />;`,
  ],
];

for (const [name, file, a, b] of DIFFERENT) {
  test(`source shape still CATCHES: ${name}`, () => {
    assert.notEqual(
      codeShape(a, file),
      codeShape(b, file),
      `shape did not change:\n  ${a}\n  ${b}`,
    );
  });
}

test("comments cannot satisfy a code assertion", () => {
  // A probe looking for a call must not be fooled by the call appearing in a
  // comment. Removing comments outright is what guarantees that.
  const shaped = codeShape(`// supabase.from("price_book").insert(items)\nnoop();`, TS);
  assert.equal(shaped.includes("price_book"), false);
  assert.equal(shaped, "noop();");
});

test("KNOWN LIMIT: parentheses are part of the shape, not stripped from it", () => {
  // Prettier wraps a multi-line JSX return in parentheses, and that DOES change
  // the shape. Stripping parens generally is not safe on a text comparison —
  // `a * (b + c)` and `a * b + c` would collapse together — so the limit is
  // accepted and recorded here instead of being hidden. In practice no probe
  // in this suite matches across a paren Prettier introduced; if one ever does,
  // it must be rewritten, not have the shaper widened.
  assert.notEqual(
    codeShape(`const e = <p>x</p>;`, TSX),
    codeShape(`const e = (\n  <p>x</p>\n);\n`, TSX),
  );
});

test("a string literal is never re-quoted or unescaped by the shaper", () => {
  // Prettier normalises quote style, so the shaper must NOT — otherwise the
  // shape would silently equate two different literals. Instead the probes are
  // written against the double quotes the config now enforces everywhere.
  assert.notEqual(codeShape(`const s = 'a';`, TS), codeShape(`const s = "a";`, TS));
});
