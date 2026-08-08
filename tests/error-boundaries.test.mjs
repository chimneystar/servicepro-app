import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// Every part of the product must fail into something a person can read.
//
// Before this, `app/error.tsx` was the ONLY boundary in the product and there
// was no `global-error.tsx` and no `loading.tsx` anywhere. Three consequences,
// none of them theoretical:
//
//  1. A boundary replaces everything below the layout it sits in, so an error on
//     any signed-in screen replaced the whole app shell — sidebar and tab bar
//     included. On a phone, where the tab bar IS the navigation, that is a dead
//     end with no way back.
//  2. An error in the ROOT layout could not be caught at all, so it fell through
//     to Next.js's own page: blank, unstyled, English-only, no error reference.
//  3. Every screen under `(app)` is force-dynamic and reads Supabase before
//     rendering, so navigation showed nothing at all until the data arrived.
//
// This codebase's defining failure is silence — 161 of 189 reads once ignored
// the error field, and 37 queries returned HTTP 300 into an empty array. A
// boundary is where that silence is supposed to end, so its absence matters more
// here than it would elsewhere.
// ---------------------------------------------------------------------------

/** Route segments that render pages for a human, and who that human is. */
const SEGMENTS = [
  { dir: "(app)", boundary: "app/(app)/error.tsx", audience: "the business" },
  { dir: "book", boundary: "app/book/error.tsx", audience: "a customer" },
  { dir: "p", boundary: "app/p/error.tsx", audience: "a customer" },
  { dir: "portal", boundary: "app/portal/error.tsx", audience: "a customer" },
];

test("every page-rendering route segment has an error boundary", () => {
  const missing = SEGMENTS.filter((s) => !existsSync(path.join(ROOT, s.boundary)));
  assert.deepEqual(
    missing.map((s) => s.boundary),
    [],
    "without its own boundary a segment falls back to the root one, which replaces the layout — " +
      "for the signed-in app that means losing the navigation",
  );
});

test("the root layout itself has a boundary", () => {
  // app/error.tsx renders INSIDE the root layout and so cannot catch that
  // layout failing. Only global-error.tsx can.
  assert.ok(existsSync(path.join(APP, "global-error.tsx")), "app/global-error.tsx must exist");
  const src = read("app/global-error.tsx");
  assert.match(src, /<html/, "global-error replaces the root layout, so it must supply <html>");
  assert.match(src, /<body/, "and <body>");
});

test("every boundary is bilingual", () => {
  // The product is bilingual and an error page is exactly where a person is
  // least able to cope with a language they do not read.
  const hebrew = /[֐-׿]/;
  const files = [
    "app/error.tsx",
    "app/global-error.tsx",
    "components/CustomerErrorState.tsx",
    ...SEGMENTS.map((s) => s.boundary),
  ];
  for (const file of files) {
    const src = read(file);
    // A thin boundary that delegates is bilingual through what it renders.
    if (/CustomerErrorState/.test(src) && !/error-state/.test(src)) continue;
    assert.ok(hebrew.test(src), `${file} has no Hebrew text`);
    assert.match(src, /[A-Za-z]{4,}/, `${file} has no English text`);
  }
});

test("every boundary surfaces the error reference", () => {
  // `digest` is the only thing connecting what the user saw to what the server
  // logged. A boundary that swallows it leaves a support conversation with
  // nothing to go on — which is this codebase's original sin in miniature.
  const files = [
    "app/error.tsx",
    "app/global-error.tsx",
    "components/CustomerErrorState.tsx",
    "app/(app)/error.tsx",
  ];
  for (const file of files) {
    assert.match(read(file), /error\.digest/, `${file} must show the error reference`);
  }
});

test("every boundary offers a way forward, not just an apology", () => {
  const files = [
    "app/error.tsx",
    "app/global-error.tsx",
    "components/CustomerErrorState.tsx",
    "app/(app)/error.tsx",
  ];
  for (const file of files) {
    assert.match(read(file), /onClick=\{reset\}/, `${file} must offer reset()`);
  }
});

test("the signed-in app has a loading state, and it respects reduced motion", () => {
  assert.ok(
    existsSync(path.join(APP, "(app)", "loading.tsx")),
    "every (app) screen is force-dynamic and reads Supabase before rendering; without loading.tsx " +
      "a navigation shows nothing at all until the data arrives",
  );
  const css = read("app/globals.css");
  assert.match(css, /\.loading-skeleton-row/, "the skeleton must actually be styled");
  assert.match(
    css,
    /\.sr-only\s*\{/,
    "the skeleton's status text must be reachable by a screen reader",
  );

  // A moving gradient is precisely what a vestibular disorder reacts to.
  const reduced = css.slice(css.indexOf(".loading-skeleton-row"));
  assert.match(
    reduced,
    /prefers-reduced-motion[\s\S]*loading-skeleton-row[\s\S]*animation:\s*none/,
    "the skeleton animation must be disabled under prefers-reduced-motion",
  );
});

test("the customer wording does not send customers to us", () => {
  // A customer's relationship is with the business they hired, not with the
  // vendor. Directing them to "support" is worse than telling them plainly to
  // ring the people they are already dealing with.
  const src = read("components/CustomerErrorState.tsx");
  assert.match(src, /contact the business directly/i);
  assert.ok(
    !/contact (us|support)/i.test(src.replace(/^\s*\*.*$/gm, "")),
    "customer-facing copy must not route a customer to the vendor",
  );
});

test("no route segment that renders pages was missed", () => {
  // The list above is hand-maintained, which is how a list goes stale. This
  // rebuilds it from the filesystem: any top-level segment holding a page.tsx
  // must either be covered by SEGMENTS or be deliberately exempt.
  const EXEMPT = new Set([
    "api", // no UI to render
    "login",
    "signup",
    "join",
    "forgot-password",
    "reset-password",
    "onboarding",
    "offline",
  ]);
  const holdsPage = (dir) => {
    const full = path.join(APP, dir);
    const stack = [full];
    while (stack.length) {
      const here = stack.pop();
      for (const entry of readdirSync(here, { withFileTypes: true })) {
        if (entry.isFile() && entry.name === "page.tsx") return true;
        if (entry.isDirectory()) stack.push(path.join(here, entry.name));
      }
    }
    return false;
  };

  const covered = new Set(SEGMENTS.map((s) => s.dir));
  const uncovered = readdirSync(APP, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !covered.has(name) && !EXEMPT.has(name))
    .filter(holdsPage);

  assert.deepEqual(
    uncovered,
    [],
    "these route segments render pages but have no error boundary and are not listed as exempt",
  );
});
