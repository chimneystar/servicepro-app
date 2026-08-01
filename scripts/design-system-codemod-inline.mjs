/**
 * Ledger 6.5 codemod, stage 2 — the INLINE style objects.
 *
 * Stage 1 handled the `const btn: React.CSSProperties` declarations. This one
 * handles `style={{ ... }}` written at the element, which is where 1,354 of the
 * 1,587 style objects live.
 *
 * ONE transform, exact-match only: an object whose signature is one of the
 * canonical shapes becomes a class from the design system, merged into any
 * className already there. Anything whose signature differs by so much as a
 * pixel of padding is left alone — a codemod that "nearly" matches is a repaint
 * in a file no test renders, and there is no browser here to catch one.
 *
 * NOT DONE, deliberately: collapsing the `<label><span/><input/></label>`
 * sandwich into `<Input label=... />`. That is the transform that would carry
 * the most value, because it is where the compile-time accessible-name
 * guarantee lives, but it restructures markup rather than swapping an
 * attribute, and the shapes in this product vary too much for it to be safe
 * unattended. It is the first thing to pick up next; see the note on 6.5 in
 * docs/REMEDIATION-PLAN.md.
 *
 * Text-range edits, applied back to front through scripts/lib/text-edits.mjs.
 * Nothing is reprinted — printing the AST would reformat every file and destroy
 * the diff, which is exactly what ledger 6.4 spent a day proving it had not done.
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { applyEdits } from "./lib/text-edits.mjs";

const DRY = process.argv.includes("--dry");

/** signature -> class name. Signatures are sorted `prop:sourceText` pairs. */
const CLASSES = new Map([
  ['display:"block"', { cls: "sp-field", tags: ["label"] }],
  ['color:"#5c6675"; fontSize:"0.8125rem"', { cls: "sp-text-muted" }],
  ['fontSize:"0.9375rem"; fontWeight:800', { cls: "sp-heading" }],
  [
    'color:"#2563eb"; fontSize:"0.875rem"; fontWeight:700; textDecoration:"none"',
    { cls: "sp-link" },
  ],
  ['color:"#5c6675"; padding:40; textAlign:"center"', { cls: "sp-empty" }],
  // The text controls. `outline: "none"` is deliberately NOT carried into the
  // class — it is the reason the focus ring has to be !important (6.6), and it
  // changes nothing unfocused. Each tag gets its own class so the stylesheet
  // can tell them apart later.
  [
    'border:"1px solid #e2e8f0"; borderRadius:10; fontSize:"1rem"; outline:"none"; padding:"10px 12px"; width:"100%"',
    {
      byTag: {
        input: "sp-input sp-control--lg",
        select: "sp-select sp-control--lg",
        textarea: "sp-textarea sp-control--lg",
      },
    },
  ],
  [
    'border:"1px solid #e2e8f0"; borderRadius:10; fontSize:"0.875rem"; outline:"none"; padding:"10px 12px"; width:"100%"',
    { byTag: { input: "sp-input", select: "sp-select", textarea: "sp-textarea" } },
  ],
  ['fontSize:"1.5rem"; fontWeight:800', { cls: "sp-heading sp-heading--lg" }],
  ["flex:1; minWidth:0", { cls: "sp-flex-fill" }],
  [
    'background:"#2563eb"; border:"none"; borderRadius:10; color:"#fff"; cursor:"pointer"; fontWeight:700; padding:"9px 15px"',
    { cls: "sp-btn sp-btn--md", tags: ["button"] },
  ],
  [
    'background:"#2563eb"; border:"none"; borderRadius:10; color:"#fff"; cursor:"pointer"; fontWeight:700; padding:"10px 16px"',
    { cls: "sp-btn", tags: ["button"] },
  ],
  [
    'color:"#334155"; display:"block"; fontSize:"0.8125rem"; fontWeight:700; margin:"10px 0 6px"',
    { cls: "sp-label" },
  ],
  ['color:"#5c6675"; fontSize:"0.75rem"', { cls: "sp-text-muted-xs" }],
]);

const sigOf = (obj) =>
  obj.properties
    .map((p) =>
      ts.isPropertyAssignment(p) ? `${p.name.getText()}:${p.initializer.getText()}` : "<spread>",
    )
    .sort()
    .join("; ");

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

const stats = { files: 0, classed: 0, byClass: {} };

for (const file of ["app", "components"].flatMap((d) => walk(d))) {
  let src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  (function visit(n) {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const opening = ts.isJsxElement(n) ? n.openingElement : n;
      const tag = opening.tagName.getText();
      // Only intrinsic elements — a component named Foo does not necessarily
      // forward className, and guessing that it does is how a codemod loses a
      // style silently. next/link is the one exception: it is documented to
      // forward className to the anchor it renders, and it wraps most of the
      // "back to ..." links this pass is trying to reach.
      const isLink = tag === "Link" && /from "next\/link"/.test(src);
      if (/^[a-z]/.test(tag) || isLink) {
        const styleAttr = opening.attributes.properties.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText() === "style",
        );
        const classAttr = opening.attributes.properties.find(
          (a) => ts.isJsxAttribute(a) && a.name.getText() === "className",
        );
        if (
          styleAttr?.initializer &&
          ts.isJsxExpression(styleAttr.initializer) &&
          styleAttr.initializer.expression &&
          ts.isObjectLiteralExpression(styleAttr.initializer.expression)
        ) {
          const found = CLASSES.get(sigOf(styleAttr.initializer.expression));
          // `byTag` shapes render a different class per element; anything the
          // table does not name for this tag is left alone.
          const target = found?.byTag
            ? found.byTag[tag]
              ? { cls: found.byTag[tag] }
              : null
            : found;
          const tagOk =
            !target?.tags || target.tags.includes(tag) || (isLink && target.tags.includes("a"));
          // A className that is an expression is left alone: merging into a
          // template literal or a cx() call is a guess about runtime values.
          const classOk =
            !classAttr || (classAttr.initializer && ts.isStringLiteral(classAttr.initializer));
          if (target && tagOk && classOk) {
            if (classAttr) {
              const existing = classAttr.initializer.text;
              edits.push({
                start: classAttr.initializer.getStart(),
                end: classAttr.initializer.getEnd(),
                text: JSON.stringify(`${existing} ${target.cls}`),
              });
            } else {
              // AFTER the attribute list, never at the tag name: an insertion
              // at the tag name shares its offset with the style attribute's
              // deletion, and that ambiguity is what corrupted 54 files.
              const at = opening.attributes.getEnd();
              edits.push({ start: at, end: at, text: ` className="${target.cls}"` });
            }
            let s = styleAttr.getStart();
            while (s > 0 && /\s/.test(src[s - 1])) s -= 1;
            edits.push({ start: s, end: styleAttr.getEnd(), text: "" });
            stats.classed += 1;
            stats.byClass[target.cls] = (stats.byClass[target.cls] ?? 0) + 1;
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  })(sf);

  if (edits.length === 0) continue;
  src = applyEdits(src, edits);
  if (!DRY) fs.writeFileSync(file, src);
  stats.files += 1;
}

console.log(JSON.stringify(stats, null, 2));
