// Before/after counts for ledger 6.5, measured the same way both times.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const REF = process.argv[2] ?? null; // null = working tree

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

function readAt(rel) {
  if (!REF) return fs.readFileSync(rel, "utf8");
  try {
    return execFileSync("git", ["show", `${REF}:${rel}`], { encoding: "utf8", maxBuffer: 1e8 });
  } catch {
    return null;
  }
}

let files;
if (REF) {
  files = execFileSync("git", ["ls-tree", "-r", "--name-only", REF, "app", "components"], {
    encoding: "utf8",
    maxBuffer: 1e8,
  })
    .split("\n")
    .filter((f) => f.endsWith(".tsx"));
} else {
  files = ["app", "components"].flatMap((d) => listFiles(d));
}

let jsx = 0;
let consts = 0;
let spClasses = 0;
let primitiveTags = 0;
const PRIMS =
  /<(Button|Input|Select|Textarea|Notice|Card|Pill|Table|EmptyState|Field|Label|IconButton|TextLink|Stack|Row|Grid|Muted|Subtle|Heading|TableScroll)\b/g;

for (const rel of files) {
  const src = readAt(rel);
  if (src === null) continue;
  if (rel.startsWith("components/ui/")) continue;
  spClasses += (src.match(/\bsp-[a-z-]+/g) ?? []).length;
  primitiveTags += (src.match(PRIMS) ?? []).length;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  (function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText() === "style" && n.initializer) {
      if (ts.isJsxExpression(n.initializer) && n.initializer.expression) {
        if (ts.isObjectLiteralExpression(n.initializer.expression)) jsx += 1;
      }
    }
    if (
      ts.isVariableDeclaration(n) &&
      n.type &&
      /CSSProperties/.test(n.type.getText()) &&
      n.initializer &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      consts += 1;
    }
    ts.forEachChild(n, visit);
  })(sf);
}

console.log(
  JSON.stringify(
    {
      ref: REF ?? "working tree",
      files: files.length,
      inlineStyleObjects: jsx,
      cssPropertiesConsts: consts,
      total: jsx + consts,
      designSystemClassUses: spClasses,
      primitiveElements: primitiveTags,
    },
    null,
    2,
  ),
);
