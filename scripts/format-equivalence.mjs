#!/usr/bin/env node
/**
 * Semantic-equivalence proof for a formatting-only change (ledger 6.4).
 *
 * WHY THIS EXISTS
 * ---------------
 * Reformatting hundreds of files is the kind of change nobody can review by
 * eye. "The tests still pass" is not a proof: the suite does not execute every
 * branch of every component, so a formatter — or a stray keystroke during the
 * pass — could alter behaviour in a file no test reaches. This script closes
 * that gap by comparing the code itself, before and after, in a way that is
 * blind to whitespace and quote style but sensitive to everything else.
 *
 * WHAT IT PROVES, per file
 * ------------------------
 *   AST      The TypeScript parser's tree for the OLD text and the NEW text
 *            produce an identical structural signature. The signature carries
 *            node kinds, identifier names, literal VALUES, unary operators,
 *            `let`/`const` discriminants and type-only import markers; it
 *            carries no source positions, no whitespace, no quote style. A
 *            changed operator, a dropped statement, a flipped precedence, a
 *            mistyped identifier, a semicolon-insertion hazard or an altered
 *            string all change it.
 *   COMMENTS The ordered list of comment bodies is unchanged (each line
 *            trimmed, so re-indentation is allowed). Comments are not
 *            semantics, but `// eslint-disable-next-line` and
 *            `@ts-expect-error` are, and a formatter that eats one must not
 *            pass silently.
 *   CSS      For stylesheets, the ordered list of at-rules, selectors and
 *            `prop: value` declarations with whitespace normalised. Order is
 *            load-bearing in CSS (the cascade), so order is compared.
 *
 * DELIBERATE INSENSITIVITIES (each value-preserving, each narrow)
 * --------------------------------------------------------------
 *   - Parentheses. `ParenthesizedExpression` wrappers are unwrapped, because
 *     Prettier re-derives them from precedence. Safe precisely because the
 *     TREE encodes precedence: `(a+b)*c` and `a+b*c` are different trees, so a
 *     real precedence change still fails.
 *   - Quote style. String literals compare by cooked VALUE, so `'x'` == `"x"`
 *     but `"x"` != `"y"`.
 *   - Numeric spelling. `0xFF` == `0xff` == `255`, compared as a number.
 *   - JSX text. Compared after applying JSX's own whitespace rules (lines
 *     trimmed, blank edge lines dropped, runs collapsed to one space) — the
 *     same transformation React applies, so two texts equal here render
 *     identically.
 *
 * KNOWN LIMIT, stated rather than hidden: comments are collected from the
 * leading trivia of parsed nodes plus empty JSX expression containers. A
 * comment in a position that is neither (for example between the last token of
 * a node and a closing token that starts no node) is invisible to the comment
 * check on BOTH sides, so it can neither cause nor mask a false result — it is
 * simply not covered by that check. The AST check has no such gap.
 *
 * USAGE
 *   node scripts/format-equivalence.mjs --base <git-ref> [--all]
 *
 *   --base   the ref holding the PRE-format state (required)
 *   --all    compare every source file tracked at <base>, not only the ones
 *            whose bytes differ
 *
 * Exit code 0 only if every compared file is equivalent.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import postcss from "postcss";
import * as prettier from "prettier";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Parsed inside main(); this module is also imported by
// tests/format-equivalence.test.mjs, which must not trip the CLI usage guard.
let BASE = null;
let ALL = false;

/**
 * The ONLY files ledger 6.4 changed by hand. Everything else in the branch is
 * the formatter's output and nothing else, which is what the two checks below
 * prove. Each entry is a claim a reviewer can check in one diff; a file that
 * reports a mismatch and is NOT on this list is a real finding.
 *
 * Two of these are here because `max-len` had nowhere else to go: a directive
 * comment and a JSDoc typedef, neither of which Prettier will wrap.
 */
const DELIBERATE = new Map([
  [
    "eslint.config.mjs",
    "adds eslint-config-prettier and the max-len rule — the enforcement half of 6.4",
  ],
  [
    "components/Calendar.tsx",
    "an eslint-disable directive's description was 128 chars on one line; re-wrapped onto two (the suppression is still live — removing it makes react-hooks/set-state-in-effect fire)",
  ],
  [
    "lib/core/feature-flags.mjs",
    "a 172-char JSDoc @typedef re-written in the multi-line object form; same type",
  ],
  [
    "tests/accessibility.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/availability.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/booking-locale.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/deposits.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/dispatch-integrity.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/invitations.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/job-assignment-integrity.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/job-status-and-photos.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/nav-reachability.test.mjs",
    "regex TypeScript stripper replaced with a real compile — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/outreach.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/push.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/schedules.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
  [
    "tests/staff-notifications.test.mjs",
    "probe rewritten for the new formatting — see scripts/prove-probes-red.mjs",
  ],
]);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CSS_EXT = new Set([".css"]);
const SKIP_DIR = /^(node_modules|\.next|\.git|\.claude|public|test-results|playwright-report)\//;

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
}

function listFiles() {
  const raw = ALL
    ? git("ls-tree", "-r", "--name-only", BASE)
    : git("diff", "--name-only", BASE, "--");
  const names = new Set(
    raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return [...names]
    .filter((f) => !SKIP_DIR.test(f))
    .filter((f) => CODE_EXT.has(path.extname(f)) || CSS_EXT.has(path.extname(f)))
    .sort();
}

function readBase(file) {
  try {
    // stderr is swallowed on purpose: a file added on this branch makes
    // `git show` print `fatal: path ... exists on disk, but not in <ref>`, which
    // is the expected answer here, not a problem. It is counted as "skipped".
    return execFileSync("git", ["show", `${BASE}:${file}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 28,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // added on this branch — nothing to compare against
  }
}

function readNow(file) {
  const p = path.join(ROOT, file);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

/* ------------------------------------------------------------------ *
 * JSX text carries meaning only after JSX's own whitespace rules. This is
 * Babel's `cleanJSXElementLiteralChild` verbatim in behaviour, which is the
 * rule the compiler actually applies — NOT a blanket trim. The difference
 * matters: a whitespace-only run WITHOUT a newline (`<b>a</b> <i>b</i>`) is a
 * rendered space and must be preserved, while a whitespace-only run WITH a
 * newline is dropped. A blanket trim would silently erase the first, which is
 * the exact class of bug a mass reformat can introduce.
 * ------------------------------------------------------------------ */
export function normaliseJsxText(text) {
  const lines = text.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/[^ \t]/.test(lines[i])) lastNonEmptyLine = i;
  }
  let str = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, " ");
    if (i !== 0) line = line.replace(/^ +/, "");
    if (i !== lines.length - 1) line = line.replace(/ +$/, "");
    if (line) {
      if (i !== lastNonEmptyLine) line += " ";
      str += line;
    }
  }
  return str;
}

// Prettier preserves a significant space across a line break by emitting
// `{" "}`. That is the same rendered output as the bare space it replaced, so
// the two must compare equal — otherwise the checker would raise a false alarm
// on every JSX element it reflowed. Restricted to whitespace-only string
// literals so that no other expression can be laundered into text.
function isWhitespaceStringExpression(node) {
  if (!node) return false;
  const k = node.kind;
  if (k !== K.StringLiteral && k !== K.NoSubstitutionTemplateLiteral) return false;
  return node.text.length > 0 && !/[^ \t\n\r]/.test(node.text);
}

/* ------------------------------------------------------------------ *
 * AST signature
 * ------------------------------------------------------------------ */
const K = ts.SyntaxKind;

function scriptKindFor(file) {
  switch (path.extname(file)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.JSX;
  }
}

// Only parser-set declaration flags matter; everything else in `flags` is
// positional or set by the binder, which we never run.
const DECL_FLAG_MASK =
  ts.NodeFlags.Let |
  0 |
  (ts.NodeFlags.Const | 0) |
  (ts.NodeFlags.Using ?? 0) |
  (ts.NodeFlags.AwaitUsing ?? 0);

export function parseFile(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
}

export function astSignature(file, text, sourceFile) {
  const sf = sourceFile ?? parseFile(file, text);
  const out = [];

  function walk(node) {
    // Prettier re-derives parentheses from precedence, and precedence lives in
    // the tree shape, so an unnecessary-paren difference is not a difference.
    // The same argument holds for TYPE parentheses: this pass found Prettier
    // rewriting `(any[])[]` to `any[][]` and `A & B | null` to `(A & B) | null`
    // (which is TS's own binding, `&` tighter than `|`) — both identical types,
    // both a different node count. Unwrapping is safe because the tree still
    // encodes the grouping: `A & (B | null)` remains a different tree.
    if (node.kind === K.ParenthesizedExpression) return walk(node.expression);
    if (node.kind === K.ParenthesizedType) return walk(node.type);

    const kindName = ts.SyntaxKind[node.kind];

    switch (node.kind) {
      case K.Identifier:
      case K.PrivateIdentifier:
        out.push(`${kindName}(${node.escapedText ?? node.text})`);
        return;
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
        out.push(`${kindName}(${JSON.stringify(node.text)})`);
        return;
      case K.NumericLiteral: {
        const n = Number(node.text.replace(/_/g, ""));
        out.push(`${kindName}(${Object.is(n, -0) ? "-0" : String(n)})`);
        return;
      }
      case K.BigIntLiteral:
        out.push(`${kindName}(${node.text.replace(/_/g, "").toLowerCase()})`);
        return;
      case K.RegularExpressionLiteral:
        out.push(`${kindName}(${node.text})`);
        return;
      case K.TemplateHead:
      case K.TemplateMiddle:
      case K.TemplateTail:
        out.push(`${kindName}(${JSON.stringify(node.text)})`);
        return;
      case K.JsxText: {
        // Only reached for a stray JsxText outside an element/fragment; the
        // normal path goes through emitJsxChildren below.
        const v = normaliseJsxText(node.text);
        if (v !== "") out.push(`JsxTextRun(${JSON.stringify(v)})`);
        return;
      }
      case K.JsxElement:
        out.push("<JsxElement");
        walk(node.openingElement);
        emitJsxChildren(node.children);
        walk(node.closingElement);
        out.push(">");
        return;
      case K.JsxFragment:
        out.push("<JsxFragment");
        emitJsxChildren(node.children);
        out.push(">");
        return;
      default:
        break;
    }

    let tag = kindName;
    // Fields forEachChild does not visit but that change meaning.
    if (typeof node.operator === "number") tag += `#op=${ts.SyntaxKind[node.operator]}`;
    if (node.isTypeOnly === true) tag += "#typeonly";
    if (node.isExportEquals === true) tag += "#exporteq";
    const declFlags = (node.flags | 0) & DECL_FLAG_MASK;
    if (declFlags) tag += `#flags=${declFlags}`;

    out.push(`<${tag}`);
    ts.forEachChild(node, walk);
    out.push(">");
  }

  // React concatenates adjacent text children, so the semantic unit is the
  // text RUN, not the individual JsxText node. Collapsing runs is what makes
  // `Total{" "}due` and `Total due` compare equal while `a b` and `ab` do not.
  function emitJsxChildren(children) {
    let buf = "";
    const flush = () => {
      if (buf !== "") out.push(`JsxTextRun(${JSON.stringify(buf)})`);
      buf = "";
    };
    for (const child of children) {
      if (child.kind === K.JsxText) {
        buf += normaliseJsxText(child.text);
      } else if (child.kind === K.JsxExpression && isWhitespaceStringExpression(child.expression)) {
        buf += child.expression.text;
      } else {
        flush();
        walk(child);
      }
    }
    flush();
  }

  ts.forEachChild(sf, walk);
  return { sig: out, parseErrors: (sf.parseDiagnostics ?? []).length };
}

/* ------------------------------------------------------------------ *
 * Comment stream
 * ------------------------------------------------------------------ */
function normaliseComment(body) {
  return body
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

export function commentStream(file, text, sourceFile) {
  const sf = sourceFile ?? parseFile(file, text);
  const seen = new Map(); // pos -> body

  function collectAt(pos) {
    for (const r of ts.getLeadingCommentRanges(text, pos) ?? []) {
      if (!seen.has(r.pos)) seen.set(r.pos, normaliseComment(text.slice(r.pos, r.end)));
    }
  }

  function walk(node) {
    if (node.pos !== node.end || node.kind === K.EndOfFileToken) collectAt(node.pos);
    // `{/* ... */}` parses to a JsxExpression with no expression; the comment
    // is trivia of the closing brace, which starts no node.
    if (node.kind === K.JsxExpression && !node.expression) {
      const raw = text.slice(node.pos, node.end);
      const body = raw.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
      if (/\S/.test(body)) seen.set(node.pos, normaliseComment(body));
    }
    ts.forEachChild(node, walk);
  }

  collectAt(0);
  ts.forEachChild(sf, walk);
  collectAt(sf.endOfFileToken.pos);

  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

/* ------------------------------------------------------------------ *
 * CSS signature — order matters in CSS, so order is preserved.
 * ------------------------------------------------------------------ */

// Prettier writes CSS numbers canonically: `.07` becomes `0.07`, `1.50`
// becomes `1.5`, `0.0` becomes `0`. Those are the same number, so the
// signature compares numbers as numbers. Anything that is not a numeric token
// — a hex colour, an identifier, a unit — is left exactly as written, so a
// changed VALUE still fails.
// Prettier also inserts spaces after commas inside functional notation
// (`rgba(0,0,0,.2)` -> `rgba(0, 0, 0, 0.2)`) and around selector combinators.
// Whitespace adjacent to punctuation is not meaningful in CSS; whitespace
// BETWEEN tokens is (it is the descendant combinator, and the separator in
// `0 8px 28px`), so only the former is collapsed. Quoted strings are left
// untouched, so `content: "a, b"` never compares equal to `content: "a,b"`.
const CSS_STRING = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/;

function collapseOutsideStrings(text, re, replacement) {
  return text
    .split(CSS_STRING)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(re, replacement)))
    .join("");
}

// CSS string quoting is a spelling, not a value. Prettier reflowed
// `[style*="background: \"#fff\""]` into `[style*='background: "#fff"']` in
// this codebase: same matched substring, different quotes and escapes. Every
// quoted run is therefore rewritten to one canonical spelling of its CONTENT,
// so a changed content still fails.
function canonicaliseCssStrings(text) {
  return text
    .split(CSS_STRING)
    .map((part, i) => {
      if (i % 2 === 0) return part;
      const cooked = part.slice(1, -1).replace(/\\(.)/gs, "$1");
      return JSON.stringify(cooked);
    })
    .join("");
}

function normaliseCssValue(value) {
  const collapsed = collapseOutsideStrings(
    value.replace(/\s+/g, " ").trim(),
    /\s*([,()/])\s*/g,
    "$1",
  );
  // Normalise the numeric token only; whatever unit follows is left exactly as
  // written, so `8px` and `8em` stay different while `.001ms` and `0.001ms`
  // become the same. The leading separator must be consumed so that digits
  // inside an identifier or a hex colour (`#f8c928`) are never touched.
  const numbers = collapseOutsideStrings(
    collapsed,
    /(^|[\s,(:/])(-?)(\d*\.\d+|\d+\.?\d*)/g,
    (m, pre, sign, num) => {
      const n = Number(num);
      return Number.isFinite(n) ? `${pre}${sign}${n}` : m;
    },
  );
  return canonicaliseCssStrings(numbers);
}

// At-rule preludes get one extra collapse that must NOT be applied to
// selectors: whitespace around `:`. In `@media (max-width:980px)` the colon is
// punctuation; in `a :hover` it is a descendant combinator followed by a
// pseudo-class, which is a different selector from `a:hover`.
function normaliseCssParams(params) {
  return collapseOutsideStrings(normaliseCssValue(params), /\s*:\s*/g, ":");
}

function normaliseCssSelector(selector) {
  return canonicaliseCssStrings(
    collapseOutsideStrings(selector.replace(/\s+/g, " ").trim(), /\s*([>+~,])\s*/g, "$1"),
  );
}

export function cssSignature(text) {
  const root = postcss.parse(text);
  const out = [];
  root.walk((node) => {
    if (node.type === "rule") {
      out.push(`RULE ${normaliseCssSelector(node.selector)}`);
    } else if (node.type === "atrule") {
      out.push(`AT @${node.name} ${normaliseCssParams(String(node.params ?? ""))}`.trim());
    } else if (node.type === "decl") {
      const value = normaliseCssValue(node.value);
      out.push(`DECL ${node.prop.trim()}: ${value}${node.important ? " !important" : ""}`);
    } else if (node.type === "comment") {
      out.push(`COMMENT ${node.text.replace(/\s+/g, " ").trim()}`);
    }
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Compare
 * ------------------------------------------------------------------ */
export function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        index: i,
        before: a.slice(Math.max(0, i - 6), i + 6),
        after: b.slice(Math.max(0, i - 6), i + 6),
      };
    }
  }
  return null;
}

export function compareSources(file, before, after) {
  if (CSS_EXT.has(path.extname(file))) {
    const d = firstDiff(cssSignature(before), cssSignature(after));
    return d ? [{ file, kind: "CSS", ...d }] : [];
  }
  const sfA = parseFile(file, before);
  const sfB = parseFile(file, after);
  const a = astSignature(file, before, sfA);
  const b = astSignature(file, after, sfB);
  const found = [];
  if (a.parseErrors !== b.parseErrors) {
    found.push({
      file,
      kind: "PARSE",
      index: -1,
      before: [`parse errors: ${a.parseErrors}`],
      after: [`parse errors: ${b.parseErrors}`],
    });
  }
  const d = firstDiff(a.sig, b.sig);
  if (d) {
    found.push({ file, kind: "AST", ...d });
    return found; // an AST mismatch makes the comment stream noise
  }
  const cd = firstDiff(commentStream(file, before, sfA), commentStream(file, after, sfB));
  if (cd) found.push({ file, kind: "COMMENTS", ...cd });
  return found;
}

/**
 * The second leg of the proof. The AST check says the after-state MEANS the
 * same thing; this says the after-state IS, byte for byte, what Prettier
 * produces from the before-state — i.e. a machine wrote it and no hand edit
 * rode along in the same commit. Line endings are normalised because the
 * working tree is CRLF (core.autocrlf=true) while git stores LF.
 */
async function mechanicalCheck(file, before, after) {
  const info = await prettier.getFileInfo(path.join(ROOT, file), {
    ignorePath: path.join(ROOT, ".prettierignore"),
  });
  if (info.ignored || !info.inferredParser) return null;
  const options = await prettier.resolveConfig(path.join(ROOT, file));
  // Prettier is not idempotent in a single pass for some member chains: it will
  // break `await supabase.from("x").insert({...})` onto four lines and then, on
  // the next pass, pull it back onto one. The committed tree is the FIXED POINT
  // (`format:check` would fail otherwise), so the comparison has to iterate too.
  // Five passes is far beyond what was observed here — the tree settled on the
  // third — and running out of them is reported rather than ignored.
  const lf = (s) => s.replace(/\r\n/g, "\n");
  let text = before;
  for (let pass = 0; pass < 5; pass++) {
    const next = await prettier.format(text, { ...options, filepath: path.join(ROOT, file) });
    if (lf(next) === lf(text)) break;
    text = next;
  }
  return lf(text) === lf(after) ? null : { file, kind: "NOT-PRETTIER-OUTPUT" };
}

async function main() {
  const argv = process.argv.slice(2);
  const baseIdx = argv.indexOf("--base");
  BASE = baseIdx >= 0 ? argv[baseIdx + 1] : null;
  ALL = argv.includes("--all");
  const MECHANICAL = argv.includes("--mechanical");
  if (!BASE) {
    console.error(
      "usage: node scripts/format-equivalence.mjs --base <git-ref> [--all] [--mechanical]",
    );
    process.exit(2);
  }

  const files = listFiles();
  let checked = 0;
  let skipped = 0;
  let mechanicallyChecked = 0;
  const failures = [];
  const notMechanical = [];

  for (const file of files) {
    const before = readBase(file);
    const after = readNow(file);
    if (before === null || after === null) {
      skipped++;
      continue;
    }
    checked++;
    if (before !== after) {
      try {
        failures.push(...compareSources(file, before, after));
      } catch (err) {
        failures.push({
          file,
          kind: "ERROR",
          index: -1,
          before: [String(err && err.message)],
          after: [],
        });
      }
    }
    if (MECHANICAL) {
      const m = await mechanicalCheck(file, before, after);
      if (m) notMechanical.push(m);
      else mechanicallyChecked++;
    }
  }

  const unexpected = failures.filter((f) => !DELIBERATE.has(f.file));
  const expected = failures.filter((f) => DELIBERATE.has(f.file));
  const unexpectedMech = notMechanical.filter((f) => !DELIBERATE.has(f.file));

  console.log(`base ref                      : ${BASE}`);
  console.log(`files considered              : ${files.length}`);
  console.log(`files compared                : ${checked}`);
  console.log(`skipped (added/gone)          : ${skipped}`);
  console.log(`semantically identical        : ${checked - failures.length}`);
  console.log(`changed on purpose, listed    : ${expected.length}`);
  console.log(`UNEXPECTED semantic changes   : ${unexpected.length}`);
  if (MECHANICAL) {
    console.log(`byte-identical to prettier(base): ${mechanicallyChecked}`);
    console.log(`UNEXPECTED non-formatter edits: ${unexpectedMech.length}`);
  }

  if (expected.length) {
    console.log(`\nDeliberate, each reviewed by hand:`);
    for (const f of expected) console.log(`  ${f.file}\n    ${DELIBERATE.get(f.file)}`);
  }
  for (const f of unexpected) {
    console.log(`\n--- ${f.kind} MISMATCH: ${f.file} (signature index ${f.index})`);
    console.log(`  before: ${f.before.join(" ")}`);
    console.log(`  after : ${f.after.join(" ")}`);
  }
  for (const f of unexpectedMech) {
    console.log(`\n--- ${f.kind}: ${f.file} differs from prettier(base text)`);
  }

  process.exit(unexpected.length === 0 && unexpectedMech.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
