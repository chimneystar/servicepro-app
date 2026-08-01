/**
 * Ledger 6.5 codemod — retire the copy-pasted style objects.
 *
 * Text-range edits driven by the TypeScript AST, applied back to front, so
 * nothing but the ranges named here moves. Printing the AST would reformat
 * every file and destroy the diff, which is exactly what 6.4 spent a day
 * proving it had not done.
 *
 * Only EXACT signature matches are rewritten. The long tail of one-off shapes
 * (a button with 11px padding, an input with a 9px radius) is left alone: a
 * codemod that "nearly" matches is a repaint in a file no test renders.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { applyEdits } from "./lib/text-edits.mjs";

const DRY = process.argv.includes("--dry");

// --- the canonical shapes, verbatim ----------------------------------------
// Each key is the sorted `prop:text` signature of a style object as it appears
// in the source. Each value says what to render instead.
const BUTTON = (pad) =>
  `background:"#2563eb"; border:"none"; borderRadius:10; color:"#fff"; cursor:"pointer"; fontWeight:700; padding:"${pad}"`;

const SHAPES = new Map([
  // Button — the two dominant paddings. `lg` is 10px/16px, `md` is 9px/15px.
  [BUTTON("10px 16px"), { kind: "button", props: "" }],
  [BUTTON("9px 15px"), { kind: "button", props: ' size="md"' }],
  // Secondary "mini" button.
  [
    'background:"#eef2f8"; border:"none"; borderRadius:8; cursor:"pointer"; fontSize:"0.8125rem"; padding:"5px 8px"',
    { kind: "button", props: ' variant="secondary" size="sm"' },
  ],
  // The "back to ..." link.
  [
    'color:"#2563eb"; fontSize:"0.875rem"; fontWeight:700; textDecoration:"none"',
    { kind: "textlink", props: "" },
  ],
  // Error box. Only the top margin varies, and it is passed as a spacing step.
  ...[
    ["8", 3],
    ["10", 4],
    ["12", 5],
  ].map(([px, step]) => [
    `background:"#fdeaea"; borderRadius:10; color:"#dc2626"; fontSize:"0.8125rem"; marginTop:${px}; padding:"9px 12px"`,
    { kind: "notice", props: step === 4 ? "" : ` mt={${step}}` },
  ]),
  [
    'background:"#fdeaea"; borderRadius:10; color:"#dc2626"; fontSize:"0.8125rem"; marginTop:8; padding:"8px 12px"',
    { kind: "notice", props: " mt={3}" },
  ],
  // Two equal columns.
  ['display:"grid"; gap:10; gridTemplateColumns:"1fr 1fr"', { kind: "grid", props: " cols={2}" }],
  // Text controls.
  [
    'border:"1px solid #e2e8f0"; borderRadius:10; fontSize:"0.875rem"; outline:"none"; padding:"10px 12px"; width:"100%"',
    { kind: "control", props: "" },
  ],
  [
    'border:"1px solid #e2e8f0"; borderRadius:10; fontSize:"1rem"; outline:"none"; padding:"10px 12px"; width:"100%"',
    { kind: "control", props: " large" },
  ],
  // Field label, dominant shape.
  [
    'color:"#334155"; display:"block"; fontSize:"0.8125rem"; fontWeight:700; margin:"10px 0 6px"',
    { kind: "label", props: "" },
  ],
]);

const IMPORTS = {
  button: "Button",
  textlink: "TextLink",
  notice: "Notice",
  grid: "Grid",
  label: "Label",
  Input: "Input",
  Select: "Select",
  Textarea: "Textarea",
};

function signatureOf(obj) {
  return obj.properties
    .map((p) =>
      ts.isPropertyAssignment(p) ? `${p.name.getText()}:${p.initializer.getText()}` : "<spread>",
    )
    .sort()
    .join("; ");
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "ui" || e.name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

const stats = {
  files: 0,
  button: 0,
  textlink: 0,
  notice: 0,
  grid: 0,
  label: 0,
  control: 0,
  consts: 0,
};

for (const file of ["app", "components"].flatMap((d) => walk(d))) {
  const original = fs.readFileSync(file, "utf8");
  let src = original;
  let sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // 1. Which local consts hold a shape we know?
  const known = new Map(); // name -> {kind, props, decl}
  sf.forEachChild(function scan(n) {
    if (ts.isVariableStatement(n) && n.declarationList.declarations.length === 1) {
      const d = n.declarationList.declarations[0];
      if (
        d.type &&
        /CSSProperties/.test(d.type.getText()) &&
        d.initializer &&
        ts.isObjectLiteralExpression(d.initializer)
      ) {
        const target = SHAPES.get(signatureOf(d.initializer));
        if (target) known.set(d.name.getText(), { ...target, statement: n });
      }
    }
  });
  if (known.size === 0) continue;

  // 2. Find every JSX element styled by one of them.
  const edits = [];
  const used = new Set();
  const needed = new Set();

  const jsxElements = [];
  (function collect(n) {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) jsxElements.push(n);
    ts.forEachChild(n, collect);
  })(sf);

  for (const el of jsxElements) {
    const opening = ts.isJsxElement(el) ? el.openingElement : el;
    const tag = opening.tagName.getText();
    const styleAttr = opening.attributes.properties.find(
      (a) => ts.isJsxAttribute(a) && a.name.getText() === "style",
    );
    if (!styleAttr || !styleAttr.initializer || !ts.isJsxExpression(styleAttr.initializer))
      continue;
    const expr = styleAttr.initializer.expression;
    if (!expr || !ts.isIdentifier(expr)) continue;
    const target = known.get(expr.getText());
    if (!target) continue;

    // Text controls become a CLASS on the tag the author already wrote, not a
    // React primitive. Two reasons, and the second is the important one:
    // converting `<input>` to `<Input label=...>` means restructuring the
    // surrounding label markup, which is not a safe mechanical edit; and the
    // scanner in tests/accessibility.test.mjs matches lowercase tags, so a raw
    // `<input>` that keeps its tag stays inside ledger 6.6's count instead of
    // quietly leaving it.
    const CONTROL_CLASS = { input: "sp-input", select: "sp-select", textarea: "sp-textarea" };
    if (target.kind === "control" && CONTROL_CLASS[tag]) {
      const classAttr = opening.attributes.properties.find(
        (a) => ts.isJsxAttribute(a) && a.name.getText() === "className",
      );
      // Only when there is no className, or a plain string one: merging into an
      // expression is a guess about a runtime value.
      if (classAttr && !(classAttr.initializer && ts.isStringLiteral(classAttr.initializer))) {
        continue;
      }
      const cls = CONTROL_CLASS[tag] + (target.props === " large" ? " sp-control--lg" : "");
      if (classAttr) {
        edits.push({
          start: classAttr.initializer.getStart(),
          end: classAttr.initializer.getEnd(),
          text: JSON.stringify(`${classAttr.initializer.text} ${cls}`),
        });
      } else {
        const at = opening.attributes.getEnd();
        edits.push({ start: at, end: at, text: ` className="${cls}"` });
      }
      let s = styleAttr.getStart();
      while (s > 0 && /\s/.test(src[s - 1])) s -= 1;
      edits.push({ start: s, end: styleAttr.getEnd(), text: "" });
      used.add(expr.getText());
      stats.control += 1;
      continue;
    }

    // Which primitive, given the tag the author actually wrote?
    let component = null;
    if (target.kind === "button" && tag === "button") component = "Button";
    else if (target.kind === "textlink" && tag === "a") component = "TextLink";
    else if (target.kind === "notice" && tag === "div") component = "Notice";
    else if (target.kind === "grid" && tag === "div") component = "Grid";
    else if (target.kind === "label" && tag === "span") component = "Label";
    if (!component) continue;

    // A Button already carries type="button"; the primitive defaults to it, so
    // the attribute is dropped rather than passed through.
    const dropped = [styleAttr];
    if (component === "Button") {
      const typeAttr = opening.attributes.properties.find(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.name.getText() === "type" &&
          a.initializer &&
          ts.isStringLiteral(a.initializer) &&
          a.initializer.text === "button",
      );
      if (typeAttr) dropped.push(typeAttr);
    }

    // Rewrite the tag names.
    edits.push({
      start: opening.tagName.getStart(),
      end: opening.tagName.getEnd(),
      text: component,
    });
    if (ts.isJsxElement(el)) {
      edits.push({
        start: el.closingElement.tagName.getStart(),
        end: el.closingElement.tagName.getEnd(),
        text: component,
      });
    }
    // Drop the attributes we are replacing, and add the variant props.
    for (const attr of dropped) {
      let s = attr.getStart();
      let e = attr.getEnd();
      while (s > 0 && /\s/.test(src[s - 1])) s -= 1; // eat the leading space
      edits.push({ start: s, end: e, text: "" });
    }
    if (target.props) {
      // After the attribute list — see _edits.mjs for why never at the tag name.
      const at = opening.attributes.getEnd();
      edits.push({ start: at, end: at, text: target.props });
    }
    used.add(expr.getText());
    needed.add(component);
    stats[target.kind] += 1;
  }

  if (edits.length === 0) continue;

  // 3. Remove any const that is now referenced nowhere.
  for (const [name, target] of known) {
    if (!used.has(name)) continue;
    // Only delete the declaration when EVERY reference to it was one of the
    // style attributes just rewritten. A `btn` that is also spread into a
    // second object stays.
    const remaining = referencesOutsideRewrites(sf, name, jsxElements, known);
    if (remaining === 0) {
      let s = target.statement.getFullStart();
      const e = target.statement.getEnd();
      edits.push({ start: s, end: e, text: "" });
      stats.consts += 1;
    }
  }

  // 4. Apply, back to front, through the proven applier.
  src = applyEdits(src, edits);

  // 5. Import what we now use.
  // A file whose only change was a className needs no import at all — without
  // this guard it would get `import {  } from "@/components/ui";`.
  const names = [...needed].sort();
  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const importLine = `import { ${names.join(", ")} } from "@/components/ui";`;
  const lastImport = names.length === 0 ? null : [...src.matchAll(/^import .*?;$/gm)].pop();
  if (lastImport) {
    const at = lastImport.index + lastImport[0].length;
    src = src.slice(0, at) + eol + importLine + src.slice(at);
  }

  if (!DRY) fs.writeFileSync(file, src);
  stats.files += 1;
}

/** How many references to `name` are NOT one of the style attributes we rewrote. */
function referencesOutsideRewrites(sf, name, jsxElements, known) {
  let total = 0;
  let inStyle = 0;
  (function count(n) {
    if (ts.isIdentifier(n) && n.text === name) {
      const p = n.parent;
      const isDecl = ts.isVariableDeclaration(p) && p.name === n;
      if (!isDecl) total += 1;
    }
    ts.forEachChild(n, count);
  })(sf);
  for (const el of jsxElements) {
    const opening = ts.isJsxElement(el) ? el.openingElement : el;
    const tag = opening.tagName.getText();
    const styleAttr = opening.attributes.properties.find(
      (a) => ts.isJsxAttribute(a) && a.name.getText() === "style",
    );
    if (!styleAttr?.initializer || !ts.isJsxExpression(styleAttr.initializer)) continue;
    const expr = styleAttr.initializer.expression;
    if (!expr || !ts.isIdentifier(expr) || expr.text !== name) continue;
    const target = known.get(name);
    const ok =
      (target.kind === "button" && tag === "button") ||
      (target.kind === "textlink" && tag === "a") ||
      (target.kind === "notice" && tag === "div") ||
      (target.kind === "grid" && tag === "div") ||
      (target.kind === "label" && tag === "span") ||
      (target.kind === "control" && ["input", "select", "textarea"].includes(tag));
    if (ok) inStyle += 1;
  }
  return total - inStyle;
}

console.log(JSON.stringify(stats, null, 2));
