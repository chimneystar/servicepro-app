// Ledger 6.6 — accessibility, the non-typographic half.
//
// What the audit found, all of it verified against the source before this file
// existed:
//   * `htmlFor` appeared ZERO times in the entire codebase, and the shared
//     `Field` pattern (seven separate copies) rendered `<label>` and `<input>`
//     as siblings with no `id`, no `for` and no wrapping — so NO form control in
//     the app was programmatically labelled. 241 of 402 controls, measured.
//   * 174 of 315 `<button>` tags carried no `type`, so inside a `<form>` they
//     default to submit and a "delete row" button posts the form.
//   * Modals were hand-rolled `<div style={overlay}>`: no `role="dialog"`, no
//     focus trap, no Escape, no focus restore. Two `role="dialog"` in the app.
//
// These are SOURCE assertions rather than browser ones on purpose: the defects
// are properties of the markup, and a source check covers every file including
// the ones no route renders today. `npm run lint` enforces the same rules
// through eslint-plugin-jsx-a11y; this file is the part that counts, so a
// regression shows up as a number rather than as one more warning.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
/** Strip comments so a comment describing a fix cannot satisfy a check for it. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The whole opening tag starting at `index`, brace-aware so `style={{...}}` does not end it early. */
function openingTag(src, index) {
  let depth = 0;
  let end = index;
  for (; end < src.length; end++) {
    const ch = src[end];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) break;
  }
  return src.slice(index, end + 1);
}

/** Offsets covered by a `<label ...> ... </label>`. Labels do not nest, so this is exact enough. */
function labelRegions(src) {
  const regions = [];
  const re = /<label\b/g;
  let m;
  while ((m = re.exec(src))) {
    const close = src.indexOf("</label>", m.index);
    if (close > -1) regions.push([m.index, close]);
  }
  return regions;
}

const lineOf = (src, index) => src.slice(0, index).split("\n").length;

function scanControls(rel) {
  const src = read(rel);
  const regions = labelRegions(src);
  const found = [];
  const re = /<(input|select|textarea)\b/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = openingTag(src, m.index);
    if (/type=\{?["']hidden/.test(tag)) continue; // not a control a person operates
    const wrapped = regions.some(([start, end]) => m.index > start && m.index < end);
    const aria = /aria-label(?:ledby)?=/.test(tag);
    const explicit = /\sid=/.test(tag) && /htmlFor=/.test(src);
    found.push({ rel, line: lineOf(src, m.index), tag, labelled: wrapped || aria || explicit });
  }
  return found;
}

function scanButtons(rel) {
  const src = read(rel);
  const found = [];
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = openingTag(src, m.index);
    found.push({ rel, line: lineOf(src, m.index), typed: /\stype=/.test(tag) });
  }
  return found;
}

const CONTROLS = FILES.flatMap(scanControls);
const BUTTONS = FILES.flatMap(scanButtons);

// QUARANTINE — stated, not hidden.
//
// These two areas were edited by a different workstream in the same session, so
// this pass did not touch them and does not claim them. They are pinned at the
// exact number of defects they still carry: the counts may go DOWN (and the
// test says so, loudly, so the number gets updated) but they can never go up,
// and nothing new may join the list. Ledger 6.6 is recorded as PARTIAL for
// precisely this, in docs/REMEDIATION-PLAN.md.
const QUARANTINE = {
  "app/(app)/settings/booking/": { controls: 22, buttons: 1 },
  "app/onboarding/": { controls: 6, buttons: 0 },
};
const quarantineOf = (rel) =>
  Object.keys(QUARANTINE).find((prefix) => rel.startsWith(prefix)) ?? null;

function assertQuarantine(kind, offenders) {
  for (const [prefix, budget] of Object.entries(QUARANTINE)) {
    const still = offenders.filter((o) => o.rel.startsWith(prefix)).length;
    assert.ok(
      still <= budget[kind],
      `${prefix} got WORSE: ${still} ${kind} now, budget ${budget[kind]}`,
    );
    assert.ok(
      still === budget[kind],
      `${prefix} now has ${still} unfixed ${kind}, not ${budget[kind]} — lower the number in tests/accessibility.test.mjs and update the ledger`,
    );
  }
}

test("every form control in the app is programmatically labelled", () => {
  const offenders = CONTROLS.filter((c) => !c.labelled);
  const unlabelled = offenders
    .filter((c) => !quarantineOf(c.rel))
    .map((c) => `${c.rel}:${c.line}  ${c.tag.slice(0, 100).replace(/\s+/g, " ")}`);
  assert.deepEqual(
    unlabelled,
    [],
    `${unlabelled.length} of ${CONTROLS.length} controls have no label, no aria-label and no htmlFor:\n${unlabelled.join("\n")}`,
  );
  assertQuarantine("controls", offenders);
});

test("every <button> declares its type", () => {
  // A button with no `type` submits. Inside a form that means "remove this
  // line" saves the record, and "show more" reloads the page.
  const offenders = BUTTONS.filter((b) => !b.typed);
  const untyped = offenders.filter((b) => !quarantineOf(b.rel)).map((b) => `${b.rel}:${b.line}`);
  assert.deepEqual(
    untyped,
    [],
    `${untyped.length} of ${BUTTONS.length} buttons have no type:\n${untyped.join("\n")}`,
  );
  assertQuarantine("buttons", offenders);
});

test("htmlFor is actually used — the shared Field helpers associate their labels", () => {
  // The headline symptom: zero occurrences repo-wide. It is not a target in
  // itself (a wrapping <label> is equally valid association) but the shared
  // helpers that render label and control as separate elements must use it.
  const uses = FILES.filter((rel) => /htmlFor=/.test(code(read(rel))));
  assert.ok(uses.length > 0, "htmlFor is still used nowhere in the codebase");
});

test("no keyboard trap: the app's dialogs are dialogs", () => {
  const modal = code(read("components/Modal.tsx"));
  for (const [what, pattern] of [
    ["role=dialog", /role="dialog"/],
    ["aria-modal", /aria-modal="true"/],
    ["an accessible name", /aria-labelledby|aria-label/],
    ["an Escape handler", /"Escape"/],
    ["a focus trap on Tab", /"Tab"/],
    ["focus restore to the opener", /restoreTo/],
    ["a scroll lock on the page behind", /document\.body\.style\.overflow/],
  ]) {
    assert.match(modal, pattern, `components/Modal.tsx lost ${what}`);
  }

  // Nothing may hand-roll an overlay again. The thirteen copies were identical
  // `position: "fixed", inset: 0` style objects; a fourteenth would be a
  // fourteenth dialog with no role, no trap and no way out.
  const rolled = FILES.filter((rel) => rel !== "components/Modal.tsx")
    .filter((rel) => /position:\s*["']fixed["'][^}]*inset:\s*0/.test(code(read(rel))))
    .filter((rel) => !/role="dialog"/.test(read(rel)));
  assert.deepEqual(
    rolled,
    [],
    `hand-rolled overlays with no dialog semantics:\n${rolled.join("\n")}`,
  );
});

test("every element that renders role=dialog has an accessible name and an Escape route", () => {
  for (const rel of FILES.filter((rel) => /role="dialog"/.test(code(read(rel))))) {
    const src = code(read(rel));
    assert.match(
      src,
      /aria-modal/,
      `${rel}: a modal dialog without aria-modal leaves the page behind readable`,
    );
    assert.match(
      src,
      /aria-label(?:ledby)?=/,
      `${rel}: a dialog with no accessible name is announced as "dialog"`,
    );
    assert.match(src, /"Escape"/, `${rel}: no way out of the dialog from the keyboard`);
  }
});

test("keyboard focus is visible, and inline outline:none cannot silence it", () => {
  const css = read("app/globals.css");
  const focusVisible = css.match(/:focus-visible\s*\{[^}]*\}/g) ?? [];
  assert.ok(focusVisible.length >= 2, "globals.css has almost no :focus-visible styling");
  // ~60 inline style objects set `outline: "none"` on inputs. An inline style
  // beats a stylesheet, so the ring has to be !important or it is decoration.
  const ring = focusVisible.find((rule) => /outline:/.test(rule));
  assert.ok(ring, "no :focus-visible rule draws an outline");
  assert.match(
    ring,
    /!important/,
    "the focus ring is not !important and inline `outline: none` will win over it",
  );
  // A visible ring means an opaque colour: the previous one was 28% alpha.
  assert.match(css, /--focus-ring:\s*#[0-9a-fA-F]{6}/, "the focus ring colour is not opaque");
  assert.match(
    css,
    /@media \(forced-colors: active\)/,
    "no forced-colours fallback: box-shadow and colours are dropped in high contrast mode",
  );
});

test("the sidebar and mobile tabs say which page you are on", () => {
  for (const rel of [
    "components/NavLink.tsx",
    "components/SidebarTools.tsx",
    "components/MobileTabs.tsx",
  ]) {
    assert.match(
      code(read(rel)),
      /aria-current=/,
      `${rel}: the active destination is styled but not announced`,
    );
  }
});

test("the a11y lint rules are on, and are not disabled anywhere", () => {
  const config = code(read("eslint.config.mjs"));
  for (const rule of [
    "jsx-a11y/label-has-associated-control",
    "jsx-a11y/click-events-have-key-events",
    "jsx-a11y/no-static-element-interactions",
    "jsx-a11y/aria-role",
    "jsx-a11y/role-supports-aria-props",
  ]) {
    assert.match(config, new RegExp(rule.replace("/", "\\/")), `${rule} is not configured`);
    // Severity must be the FIRST thing the rule is set to, whether it is set
    // bare (`"rule": "error"`) or with options (`"rule": ["error", {...}]`).
    // This replaces an earlier `rule[^\n]*error` that only held while the whole
    // entry sat on one line; it is strictly tighter, because "error" appearing
    // later in the options object no longer satisfies it.
    assert.match(
      config,
      new RegExp(`"${rule.replace("/", "\\/")}":\\s*\\[?\\s*"error"`),
      `${rule} is configured but not as an error`,
    );
  }
  // A rule turned off at the call site is the same as a rule that is off.
  const suppressed = FILES.filter((rel) => /eslint-disable[^\n]*jsx-a11y/.test(read(rel)));
  assert.deepEqual(
    suppressed,
    [],
    `files that switch the a11y rules off:\n${suppressed.join("\n")}`,
  );
});
