// Whitespace-blind reading of TypeScript/JavaScript source, for the structural
// probes that assert on the SHAPE of the code.
//
// WHY THIS EXISTS
// ---------------
// A large number of probes in this suite read a source file as text and assert
// a regex against it — `/eq\("status","approved"\)/`, `/from\("price_book"\)\.insert/`,
// `/rpc\("accept_invitation", \{ invite_token: inviteToken \}\)/`. What each one
// is really guarding is that a particular CALL, with particular ARGUMENTS, is
// still present in a particular file. None of them is guarding where the line
// breaks fall — that was simply the shape the code happened to have when the
// probe was written.
//
// Ledger 6.4 reformatted the tree with Prettier, which moved the line breaks.
// The tempting fix is to relax each regex until it passes again. That is how a
// safety net becomes decorative, and this codebase already has three examples
// of exactly that failure (a booking test that never ran, RLS assertions true
// for every table, i18n parity comparing two empty strings). So instead the
// SOURCE is canonicalised and the probes keep asserting the same call with the
// same arguments.
//
// WHAT `codeShape()` DOES — and why it is not a loosening
// ------------------------------------------------------
// It reduces a file to its TOKEN STREAM, spelled canonically:
//
//   1. Comments are removed (they cannot satisfy a code assertion).
//   2. Whitespace between two word characters collapses to exactly one space,
//      so `const x` can never become `constx` and two identifiers can never
//      merge into one.
//   3. Whitespace adjacent to punctuation is removed, so
//      `.eq("status", "approved")` and `.eq(\n  "status",\n  "approved",\n)`
//      reduce to the same text.
//   4. A trailing comma before `)`, `]` or `}` is dropped, because Prettier
//      adds them and they are elidable by definition.
//   5. String, template and regex literals are copied VERBATIM. Their contents
//      are never touched, so `"Total  due"` never becomes `"Total due"` and a
//      changed string still fails every probe that names it.
//
// Two files have the same shape if and only if they have the same token
// sequence. That is strictly a formatting insensitivity, not a content one:
// every probe that passes against a shaped file would have passed against the
// original had the original been formatted that way, and every code change the
// probe was written to catch still changes the shape.
//
// `tests/source-shape.test.mjs` proves this both ways on planted violations.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

function scriptKindFor(fileName) {
  switch (path.extname(fileName)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".ts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.JSX;
  }
}

// Private-use sentinels: they cannot occur in source that parsed, and being
// non-word characters they follow the same spacing rule as any other
// punctuation, so parking a literal behind one changes nothing else.
const OPEN = "\u0001";
const CLOSE = "\u0002";

/** Canonical token-stream spelling of a TypeScript/JavaScript source text. */
export function codeShape(text, fileName = "probe.tsx") {
  const sf = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(fileName),
  );

  const literals = [];
  const comments = new Map();

  function collectComments(pos) {
    for (const r of ts.getLeadingCommentRanges(text, pos) ?? []) comments.set(r.pos, r.end);
  }

  function walk(node) {
    collectComments(node.pos);
    if (LITERAL_KINDS.has(node.kind)) {
      literals.push([node.getStart(sf), node.getEnd()]);
      return;
    }
    ts.forEachChild(node, walk);
  }

  collectComments(0);
  ts.forEachChild(sf, walk);
  collectComments(sf.endOfFileToken.pos);

  // Cut the source into (comment | literal | code) regions, in order.
  const regions = [
    ...[...comments.entries()].map(([start, end]) => ({ start, end, kind: "comment" })),
    ...literals.map(([start, end]) => ({ start, end, kind: "literal" })),
  ].sort((a, b) => a.start - b.start);

  const kept = [];
  let cursor = 0;
  let out = "";
  for (const r of regions) {
    if (r.start < cursor) continue; // a literal inside a comment, or overlap
    out += text.slice(cursor, r.start);
    if (r.kind === "literal") {
      kept.push(text.slice(r.start, r.end));
      out += `${OPEN}${kept.length - 1}${CLOSE}`;
    } else {
      out += " ";
    }
    cursor = r.end;
  }
  out += text.slice(cursor);

  out = out
    .replace(/\s+/g, " ")
    // Whitespace touching punctuation carries no information; whitespace
    // between two word characters is a token boundary and is preserved.
    .replace(/ ?([^\w\s$]) ?/g, "$1")
    .replace(/,(?=[)\]}])/g, "")
    .trim();

  return out.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (_m, i) => kept[Number(i)]);
}

const ROOT = path.resolve(process.cwd());

/** Read a repo-relative source file and return its canonical token shape. */
export function readShape(relPath) {
  const full = path.join(ROOT, relPath);
  return codeShape(fs.readFileSync(full, "utf8"), full);
}
