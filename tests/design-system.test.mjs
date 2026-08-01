// Ledger 6.5 — the design system.
//
// Three things are asserted here, and each of them exists because it is the way
// this particular change goes wrong quietly.
//
//   1. THE TOKENS ARE USED, NOT DUPLICATED. A design system whose primitives
//      spell #2563eb out again has bought nothing. Every colour, radius and
//      spacing value in the primitives block must arrive through `var(--sp-*)`.
//
//   2. THE PRIMITIVES STILL PAINT WHAT THEY REPLACED. Every class here took the
//      place of a specific style object that had been copy-pasted across the
//      app. Those objects are recorded VERBATIM below, and the rule is expanded
//      through the token table and compared against them property by property.
//      This is the check that matters most, because there is no browser on this
//      machine: it is the only thing standing between "the button is now a
//      Button" and "the button is now a slightly different colour in 31 places".
//      It has already caught one real repaint — 0.75rem muted text was mapped to
//      a class painting #94a3b8 instead of #5c6675.
//
//   3. A PRIMITIVE CANNOT SILENTLY DROP ITS ACCESSIBLE NAME. Migrating an
//      `<input>` to `<Input>` makes it invisible to the scanner in
//      tests/accessibility.test.mjs, which matches lowercase tag names. Left
//      alone, ledger 6.6's guarantee would decay one migration at a time while
//      its numbers went DOWN and looked like progress. So the denominator is
//      asserted: every control in the product is either a raw tag that file
//      counts, or a primitive this file counts, and every primitive call site
//      carries a name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CSS = readFileSync(join(root, "app/globals.css"), "utf8");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}
const FILES = ["app", "components"]
  .flatMap((d) => walk(join(root, d)))
  .map((p) => relative(root, p).split(sep).join("/"))
  .sort();
const read = (rel) => readFileSync(join(root, rel), "utf8");

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, " ");

/** `--name` -> value, from every custom property declared in the sheet. */
function tokenTable(css) {
  const map = new Map();
  for (const d of stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    if (!map.has(d[1])) map.set(d[1], d[2].trim());
  }
  return map;
}
const TOKENS = tokenTable(CSS);

/** Substitute var() until nothing is left to substitute. */
function expandVars(value, seen = 0) {
  if (seen > 5) return value;
  const next = value.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*))?\)/g, (whole, name, fallback) =>
    TOKENS.has(name) ? TOKENS.get(name) : (fallback ?? whole),
  );
  return next === value ? value : expandVars(next, seen + 1);
}

/**
 * Every rule in the sheet that styles exactly this class and nothing else —
 * the base rule, not its variants. Grouped selectors count: the text controls
 * share one rule across `.sp-input`, `.sp-select` and `.sp-textarea`.
 */
function ruleFor(className) {
  const out = [];
  for (const rule of stripComments(CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const matches = rule[1]
      .split(",")
      .map((s) => s.trim().replace(/\s+/g, ""))
      .some((sel) => new RegExp(`^(\\.${className})+$`).test(sel));
    if (matches) out.push(rule[2]);
  }
  return out.join(";");
}

const SIDES = ["top", "right", "bottom", "left"];

/**
 * Properties React does NOT append `px` to when given a number. Without this
 * list `fontWeight: 700` compares as `700px` and every primitive looks broken —
 * a false RED, which costs exactly as much trust as a false GREEN.
 */
const UNITLESS = new Set([
  "font-weight",
  "line-height",
  "opacity",
  "z-index",
  "flex",
  "flex-grow",
  "flex-shrink",
  "order",
  "zoom",
]);

/** `#fff` and `#ffffff` are the same colour; so are `#FFF` and `#fff`. */
function normaliseValue(value) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/#([0-9a-fA-F]{3})\b/g, (_, h) => `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`)
    .toLowerCase();
}

/** Expand a `10px 12px`-style shorthand into its four sides. */
function fourSides(value) {
  const parts = value.trim().split(/\s+/);
  const [t, r = t, b = t, l = r] = parts;
  return { top: t, right: r, bottom: b, left: l };
}

/**
 * Reduce a declaration block to canonical physical longhands, resolved in LTR.
 * Both sides of the comparison go through this, so a rule written with logical
 * properties and an object written with a shorthand meet in the same shape.
 */
function canonical(decls) {
  const out = new Map();
  const set = (k, v) => out.set(k, normaliseValue(String(v)));
  for (const [prop, raw] of decls) {
    const value = expandVars(raw.trim());
    const box = /^(padding|margin)/.test(prop) ? prop.split("-")[0] : null;
    if (box) {
      const rest = prop.slice(box.length);
      if (rest === "") {
        const s = fourSides(value);
        for (const side of SIDES) set(`${box}-${side}`, s[side]);
      } else if (rest === "-block" || rest === "-inline") {
        const parts = value.split(/\s+/);
        const [a, b = a] = parts;
        const sides = rest === "-block" ? ["top", "bottom"] : ["left", "right"];
        set(`${box}-${sides[0]}`, a);
        set(`${box}-${sides[1]}`, b);
      } else if (/-block-start$/.test(rest)) set(`${box}-top`, value);
      else if (/-block-end$/.test(rest)) set(`${box}-bottom`, value);
      else if (/-inline-start$/.test(rest)) set(`${box}-left`, value);
      else if (/-inline-end$/.test(rest)) set(`${box}-right`, value);
      else set(prop, value);
      continue;
    }
    if (prop === "border-block-end") set("border-bottom", value);
    else set(prop, value);
  }
  return out;
}

/** A CSS declaration block -> canonical longhands. */
function fromCss(block) {
  const decls = [];
  for (const d of block.split(";")) {
    const i = d.indexOf(":");
    if (i < 0) continue;
    decls.push([d.slice(0, i).trim(), d.slice(i + 1).trim()]);
  }
  return canonical(decls);
}

/** A React style object (as a JS object) -> canonical longhands. */
function fromStyleObject(obj) {
  const decls = [];
  for (const [k, v] of Object.entries(obj)) {
    const prop = k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    // React renders a bare number as px, EXCEPT for the unitless properties.
    const rendered = typeof v === "number" && !UNITLESS.has(prop) ? `${v}px` : String(v);
    decls.push([prop, rendered]);
  }
  return canonical(decls);
}

// ---------------------------------------------------------------------------
// 1. The tokens are used, not duplicated.
// ---------------------------------------------------------------------------

/** The PRIMITIVES section, which is the part of the sheet this ledger row owns. */
const PRIMITIVES_BLOCK = (() => {
  const marker = "PRIMITIVES — ledger 6.5";
  const at = CSS.indexOf(marker);
  assert.ok(at > -1, "the primitives block is gone from app/globals.css");
  return CSS.slice(at);
})();

test("the primitives are built from tokens, not from literal values", () => {
  const body = stripComments(PRIMITIVES_BLOCK);
  const literals = [];
  for (const rule of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const decl of rule[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      // A raw hex or rgb() anywhere in the primitives is a duplicated colour.
      if (/#[0-9a-fA-F]{3,8}|rgba?\(/.test(value)) {
        literals.push(`${rule[1].trim()} { ${prop}: ${value} }`);
      }
    }
  }
  assert.deepEqual(literals, [], "these primitive declarations hardcode a colour");

  // Cry-wolf: the scan can see one.
  const planted = ".sp-x.sp-x.sp-x { color: #2563eb; }";
  const found = [...stripComments(planted).matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((r) =>
    /#[0-9a-fA-F]{3,8}/.test(r[2]),
  );
  assert.ok(found, "the literal-colour scan cannot see a literal colour");
});

/**
 * Not tokens: these three are PARAMETERS. A primitive reads them with a
 * fallback (`var(--sp-gap, var(--sp-space-4))`) and the component writes them
 * from a prop, which is how `<Row gap={3}>` and `<Grid cols={2}>` reach CSS
 * without an inline style per call site.
 */
const PARAMETERS = new Set(["--sp-gap", "--sp-cols", "--sp-mt"]);

test("every --sp-* token the primitives reference is actually declared", () => {
  const missing = [];
  for (const use of stripComments(PRIMITIVES_BLOCK).matchAll(/var\(\s*(--sp-[\w-]+)/g)) {
    if (!TOKENS.has(use[1]) && !PARAMETERS.has(use[1])) missing.push(use[1]);
  }
  assert.deepEqual([...new Set(missing)], [], "primitives reference tokens that do not exist");

  // A parameter is only safe because it always has a fallback; without one, a
  // component that forgets to set it renders with the property unset.
  for (const name of PARAMETERS) {
    for (const use of stripComments(PRIMITIVES_BLOCK).matchAll(
      new RegExp(`var\\(\\s*${name}\\s*([,)])`, "g"),
    )) {
      assert.equal(use[1], ",", `${name} is read with no fallback`);
    }
  }
});

test("no --sp-* colour or elevation token is declared and then read by nothing", () => {
  // A token nobody reads is a value that has quietly stopped being the source
  // of truth for anything, and the whole claim of this ledger row is that there
  // is now exactly one place to change a colour.
  //
  // The LADDERS are exempt, and deliberately so: --sp-font-*, --sp-space-*,
  // --sp-radius-* and --sp-weight-* are scales, and a scale is declared whole.
  // A ladder with the unused rungs sawn out is worse than one with spare rungs,
  // because the next person needing 20px invents 20px instead of finding it.
  const LADDER = /^--sp-(font|space|radius|weight)-/;
  const declared = [...TOKENS.keys()].filter((k) => k.startsWith("--sp-"));
  assert.ok(declared.length >= 40, `expected the measured token set, found ${declared.length}`);
  const fromTs = readFileSync(join(root, "components/ui/cx.ts"), "utf8");
  const unused = declared.filter((name) => {
    if (LADDER.test(name)) return false;
    if (new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(CSS)) return false;
    return !fromTs.includes(name);
  });
  assert.deepEqual(unused, [], "these tokens are declared but read by nothing");
});

// ---------------------------------------------------------------------------
// 2. The primitives still paint what they replaced.
// ---------------------------------------------------------------------------

/**
 * The style objects these classes replaced, copied VERBATIM out of the source
 * at b37c024. Left column: the class. Right column: what the app used to write
 * inline at every one of the call sites the codemod rewrote to it.
 *
 * A mismatch here is a repaint in a screen no test renders.
 */
const REPLACED = [
  [
    "sp-btn",
    {
      background: "#2563eb",
      color: "#fff",
      border: "none",
      padding: "10px 16px",
      borderRadius: 10,
      fontWeight: 700,
      cursor: "pointer",
    },
  ],
  [
    "sp-notice",
    {
      background: "#fdeaea",
      color: "#dc2626",
      padding: "9px 12px",
      borderRadius: 10,
      fontSize: "0.8125rem",
      marginTop: 10,
    },
  ],
  [
    "sp-input",
    {
      width: "100%",
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      padding: "10px 12px",
      fontSize: "0.875rem",
    },
  ],
  [
    "sp-label",
    {
      fontSize: "0.8125rem",
      fontWeight: 700,
      color: "#334155",
      display: "block",
      margin: "10px 0 6px",
    },
  ],
  ["sp-link", { color: "#2563eb", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }],
  ["sp-text-muted", { fontSize: "0.8125rem", color: "#5c6675" }],
  ["sp-text-muted-xs", { fontSize: "0.75rem", color: "#5c6675" }],
  ["sp-empty", { padding: 40, textAlign: "center", color: "#5c6675" }],
  ["sp-heading", { fontSize: "0.9375rem", fontWeight: 800 }],
  ["sp-field", { display: "block" }],
];

test("every primitive still paints exactly what the style object it replaced painted", () => {
  const drift = [];
  for (const [cls, object] of REPLACED) {
    const block = ruleFor(cls);
    assert.ok(block, `no rule found for .${cls} — the design system has drifted from this test`);
    const actual = fromCss(block);
    const expected = fromStyleObject(object);
    for (const [prop, want] of expected) {
      const got = actual.get(prop);
      if (got !== want) drift.push(`.${cls} { ${prop}: ${got ?? "(missing)"} } — was ${want}`);
    }
  }
  assert.deepEqual(drift, [], "these primitives no longer render what they replaced");
});

test("the repaint check can see a repaint (both ways)", () => {
  // Same comparison, against a planted rule one shade off. If this stops
  // failing, the check above has stopped being a check.
  const planted = fromCss("color: #94a3b8; font-size: 0.75rem");
  const truth = fromStyleObject({ fontSize: "0.75rem", color: "#5c6675" });
  assert.notEqual(planted.get("color"), truth.get("color"));
  // And it does NOT cry wolf on a logical/shorthand difference, which is the
  // whole reason both sides are canonicalised first.
  assert.deepEqual(
    [...fromCss("padding-block: 10px; padding-inline: 12px")].sort(),
    [...fromStyleObject({ padding: "10px 12px" })].sort(),
  );
  assert.deepEqual(
    [...fromCss("margin-block: 10px 6px")].sort(),
    [...fromStyleObject({ margin: "10px 0 6px" })].filter(([k]) => !/left|right/.test(k)).sort(),
  );
});

// ---------------------------------------------------------------------------
// 3. Specificity: a primitive must still beat the sheet it now lives in.
// ---------------------------------------------------------------------------

function specificity(sel) {
  const s = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, " ");
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]+\]/g) || []).length;
  const els = (s.replace(/[.#][\w-]+/g, "").match(/\b[a-z][a-z0-9]*\b/g) || []).length;
  return ids * 10000 + classes * 100 + els;
}

test("primitive rules out-specify every element-targeting selector in the sheet", () => {
  // These classes replaced INLINE styles, which sat above the whole cascade.
  // This sheet has ~200 selectors that target a bare button/input/select/a,
  // and an element that used to carry its own style ignored all of them. If a
  // primitive rule does not out-specify them it silently loses, which is a
  // repaint in whichever screen wraps that element.
  const TARGETS = ["button", "input", "select", "textarea", "table", "th", "td", "a", "label"];
  let worst = 0;
  let worstSel = "";
  for (const rule of stripComments(CSS).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of rule[1].split(",")) {
      const trimmed = sel.trim();
      if (!trimmed || trimmed.startsWith("@") || /\.sp-/.test(trimmed)) continue;
      const last = trimmed.split(/[\s>+~]+/).pop() ?? "";
      const base = last.replace(/::?[a-z-]+(\([^)]*\))?/g, "").replace(/[.#[].*$/, "");
      if (!TARGETS.includes(base)) continue;
      const score = specificity(trimmed);
      if (score > worst) {
        worst = score;
        worstSel = trimmed;
      }
    }
  }
  assert.ok(worst > 0, "found no element-targeting selectors at all — the scan is broken");

  const weak = [];
  for (const rule of stripComments(PRIMITIVES_BLOCK).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    for (const sel of rule[1].split(",")) {
      const trimmed = sel.trim();
      if (!/^\.sp-/.test(trimmed)) continue;
      if (specificity(trimmed) <= worst) {
        weak.push(`${trimmed} (${specificity(trimmed)}) loses to ${worstSel} (${worst})`);
      }
    }
  }
  assert.deepEqual(weak, [], "these primitive rules lose to a selector already in the sheet");

  // Both ways: a single-class selector WOULD lose, which is why they triple.
  assert.ok(specificity(".sp-btn") <= worst, "the guard is vacuous — a bare class already wins");
});

// ---------------------------------------------------------------------------
// 4. A primitive cannot silently drop its accessible name.
// ---------------------------------------------------------------------------

const NAMED_PRIMITIVES = ["Input", "Select", "Textarea"];

/** Every `<Input ...>` / `<Select ...>` / `<Textarea ...>` call site in the app. */
function primitiveControls() {
  const found = [];
  for (const rel of FILES) {
    if (rel.startsWith("components/ui/")) continue;
    const src = read(rel);
    for (const name of NAMED_PRIMITIVES) {
      const re = new RegExp(`<${name}\\b`, "g");
      let m;
      while ((m = re.exec(src))) {
        // The whole opening tag, brace-aware so an object prop cannot end it early.
        let depth = 0;
        let end = m.index;
        for (; end < src.length; end++) {
          const ch = src[end];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          else if (ch === ">" && depth === 0) break;
        }
        const tag = src.slice(m.index, end + 1);
        found.push({
          rel,
          line: src.slice(0, m.index).split("\n").length,
          named: /\blabel=|aria-label=|aria-labelledby=/.test(tag),
        });
      }
    }
  }
  return found;
}

test("every design-system control call site carries an accessible name", () => {
  const nameless = primitiveControls()
    .filter((c) => !c.named)
    .map((c) => `${c.rel}:${c.line}`);
  assert.deepEqual(
    nameless,
    [],
    `these primitives render a form control with no label, no aria-label and no aria-labelledby:\n${nameless.join("\n")}`,
  );
});

test("the name requirement is enforced by the TYPE, not only by this test", () => {
  // The test above is a net. `Named` is the thing that stops it being needed:
  // three mutually exclusive arms, so `<Input />` with no name does not compile.
  const named = read("components/ui/Named.ts");
  assert.match(named, /label:\s*ReactNode/, "the label arm is gone from Named");
  assert.match(named, /"aria-label":\s*string/, "the aria-label arm is gone from Named");
  assert.match(named, /"aria-labelledby":\s*string/, "the aria-labelledby arm is gone");
  // Mutual exclusion is what stops a Hebrew visible label under an English
  // announced one; without the `never`s all three could be supplied at once.
  assert.ok(
    (named.match(/\?:\s*never/g) ?? []).length >= 6,
    "the arms of Named are no longer mutually exclusive",
  );
  for (const primitive of NAMED_PRIMITIVES) {
    const src = read(`components/ui/${primitive}.tsx`);
    assert.match(src, /Named/, `${primitive} no longer requires a name`);
    // The nameless branch must forward the aria props VISIBLY, so that a static
    // scan can confirm the name is really being passed through.
    assert.match(
      src,
      /aria-label=\{ariaLabel\}/,
      `${primitive} hides its accessible name inside a spread`,
    );
  }
});

test("the denominator is honest: controls did not vanish, they moved", () => {
  // tests/accessibility.test.mjs matches lowercase `<input|select|textarea`, so
  // every control this pass migrated to a primitive left its scan. That is fine
  // ONLY while something else counts them. This is that something.
  const raw = FILES.filter((rel) => !rel.startsWith("components/ui/")).flatMap((rel) =>
    [...read(rel).matchAll(/<(input|select|textarea)\b/g)].map(() => rel),
  );
  const migrated = primitiveControls();
  assert.ok(
    raw.length + migrated.length >= 400,
    `only ${raw.length + migrated.length} controls are accounted for; ` +
      "402 were measured at 6.6, and they cannot have disappeared",
  );
});
