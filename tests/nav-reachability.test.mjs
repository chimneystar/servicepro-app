// AUDIT A3 — "expanding the sidebar Tools group renders all 11 destinations
// off-screen with no scroll affordance", measured live at 1491x812:
// `.side-nav` scrollHeight 1162px in a 738px well.
//
// This file is the probe for that, and for the contract in
// docs/FEATURE-INVENTORY.md that says every destination stays reachable — in
// the sidebar AND on a phone.
//
// It does two different kinds of check and they are deliberately separate:
//
//  1. PURE. `splitNavigation` in `lib/nav.ts` is loaded and executed — the real
//     function, not a copy of its rules — and asserted to lose nothing. It is
//     loaded by stripping the TypeScript annotations from the source; if that
//     strip ever becomes incomplete the test fails loudly rather than quietly
//     testing something else.
//
//  2. LAYOUT, in a real browser. Reading CSS cannot tell you whether eleven
//     links are on the screen. The sidebar's markup and the app's real
//     `globals.css` are rendered in headless Chromium at laptop viewport sizes
//     and every destination is measured. A structural assertion keeps the
//     harness honest about the markup it models.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const navSource = readFileSync(join(root, "lib/nav.ts"), "utf8");
const navComponent = readFileSync(join(root, "components/Nav.tsx"), "utf8");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

/* ------------------------------------------------------------------ pure */

function loadNavModule() {
  const stripped = navSource
    .replace(/^import type .*$/gm, "")
    .replace(/^export type .*$/gm, "")
    .replace(/export const NAV_ITEMS\s*:\s*NavItem\[\]/, "export const NAV_ITEMS")
    .replace(/\(items\s*:\s*NavItem\[\]\)\s*:\s*\{[^}]*\}/, "(items)");
  // If a type annotation survived, the module would not parse — but a *new*
  // annotation elsewhere could parse and change meaning. Refuse to run rather
  // than pass against something that is no longer the real source.
  assert.equal(/\bNavItem\b/.test(stripped), false, "lib/nav.ts gained a type annotation this loader does not strip — update the loader, do not weaken the test");
  return import(`data:text/javascript;base64,${Buffer.from(stripped, "utf8").toString("base64")}`);
}

const nav = await loadNavModule();
const { NAV_ITEMS, MOBILE_TAB_SLOTS, splitNavigation } = nav;

function itemsFor(role, { capabilities = null, platformAdmin = false } = {}) {
  return NAV_ITEMS.filter((item) =>
    item.roles.includes(role)
    && (!item.capability || capabilities === null || capabilities.has(item.capability))
    && (!item.platformOnly || platformAdmin));
}

test("splitNavigation drops nothing and duplicates nothing, for every role", () => {
  for (const role of ["owner", "office", "tech"]) {
    for (const platformAdmin of [false, true]) {
      const mine = itemsFor(role, { platformAdmin });
      const { tabs, more } = splitNavigation(mine);
      const reachable = [...tabs, ...more].map((i) => i.href);
      assert.deepEqual(
        [...reachable].sort(),
        mine.map((i) => i.href).sort(),
        `${role} (platformAdmin=${platformAdmin}): the mobile split lost or invented a destination`,
      );
      assert.equal(new Set(reachable).size, reachable.length, `${role}: a destination appears in both the tab bar and More`);
      assert.ok(tabs.length <= MOBILE_TAB_SLOTS, `${role}: more tabs than the bar has slots`);
    }
  }
});

/** Strip comments, so a comment ABOUT a defect cannot satisfy a check for its absence. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the tab bar and /more both defer to splitNavigation", () => {
  const more = readFileSync(join(root, "app/(app)/more/page.tsx"), "utf8");
  for (const [name, source] of [["components/Nav.tsx", navComponent], ["app/(app)/more/page.tsx", more]]) {
    const src = code(source);
    assert.match(src, /splitNavigation\(/, `${name} must use the shared split`);
    // The original defect: each file decided the split for itself, and Invoices
    // fell through the gap. Neither may slice or re-filter on `bottom` again.
    assert.equal(/\.slice\(0,\s*\d/.test(src), false, `${name} re-implements the tab-bar cut instead of using splitNavigation`);
    assert.equal(/!\s*\w+\.bottom/.test(src), false, `${name} re-filters on \`bottom\` instead of using splitNavigation`);
  }
});

/* -------------------------------------------------------------- structural */

test("the layout harness below still models the sidebar Nav.tsx renders", () => {
  for (const cls of ["desk-side", "side-brand", "side-utilities", "side-footer"]) {
    assert.match(navComponent, new RegExp(`"${cls}"`), `Nav.tsx no longer renders .${cls} — the layout harness is out of date`);
  }
  assert.match(navComponent, /<SideNavScroller/, "Nav.tsx no longer uses SideNavScroller — the layout harness is out of date");
  const scroller = code(readFileSync(join(root, "components/SideNavScroller.tsx"), "utf8"));
  for (const cls of ["side-nav-wrap", "side-nav", "side-nav-inner", "side-nav-fade-bottom"]) {
    assert.match(scroller, new RegExp(cls), `SideNavScroller no longer renders .${cls}`);
  }
  // The harness reproduces the component's scroll-edge rule in plain JS (there
  // is no React in a `setContent` page). These two assertions are what stop it
  // becoming a test of itself: the component must still compute the same thing.
  assert.match(scroller, /scrollTop > 2/, "SideNavScroller changed how it decides there is content above");
  assert.match(scroller, /scrollTop \+ nav\.clientHeight < nav\.scrollHeight - 2/, "SideNavScroller changed how it decides there is content below");
  assert.match(scroller, /can-scroll-up/, "SideNavScroller no longer sets .can-scroll-up");
  assert.match(scroller, /can-scroll-down/, "SideNavScroller no longer sets .can-scroll-down");
  // `/appearance` is rendered by .side-utilities; it must not also be listed in
  // the Tools group, or the sidebar prints the same destination twice.
  assert.match(code(navComponent), /item\.href !== "\/appearance"/, "the duplicate /appearance row is back in Tools");
});

/* ------------------------------------------------------------------ layout */

function sidebarHtml(role) {
  const mine = itemsFor(role, { platformAdmin: true });
  const primary = mine.filter((i) => i.group !== "tools");
  const tools = mine.filter((i) => i.group === "tools" && i.href !== "/appearance");
  const row = (i, cls) => `<a class="${cls}" href="${i.href}" data-dest="${i.href}"><svg class="nav-icon"></svg><span>${i.key}</span></a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="shell">
  <aside class="desk-side">
    <div class="side-brand"><span class="brand-mark"></span><span class="brand-copy"><strong>A Very Long Business Name Ltd</strong><small>Owner</small></span></div>
    <div class="side-nav-wrap">
      <nav class="side-nav" aria-label="Main navigation"><div class="side-nav-inner">
        ${primary.map((i) => row(i, "side-link")).join("")}
        <div class="tools-wrap">
          <button type="button" class="tools-trigger" aria-expanded="true"><svg class="nav-icon"></svg><span>Tools</span><svg class="nav-icon tools-chevron open"></svg></button>
          <div class="tool-list">${tools.map((i) => row(i, "tool-link")).join("")}</div>
        </div>
      </div></nav>
      <span class="side-nav-fade side-nav-fade-top" aria-hidden="true"></span>
      <span class="side-nav-fade side-nav-fade-bottom" aria-hidden="true"></span>
    </div>
    <div class="side-utilities">
      <a href="/appearance" class="side-appearance" data-dest="/appearance"><svg></svg><span>Appearance</span></a>
      <div class="side-locale"><button type="button">EN</button></div>
    </div>
    <form class="side-footer"><button type="submit" class="sign-out-btn">Sign out</button></form>
  </aside>
  <main class="app-content">content</main>
</div>
<script>
  // The DOM half of components/SideNavScroller.tsx. The test below asserts the
  // component still carries the identical rule, so this cannot drift into
  // testing something the app does not do.
  (function () {
    var wrap = document.querySelector(".side-nav-wrap");
    var nav = document.querySelector(".side-nav");
    function measure() {
      wrap.classList.toggle("can-scroll-up", nav.scrollTop > 2);
      wrap.classList.toggle("can-scroll-down", nav.scrollTop + nav.clientHeight < nav.scrollHeight - 2);
    }
    nav.addEventListener("scroll", measure);
    window.__measureSideNav = measure;
    measure();
  })();
</script>
</body></html>`;
}

const VIEWPORTS = [
  { width: 1491, height: 812, name: "the viewport the audit measured" },
  { width: 1280, height: 700, name: "a small laptop" },
  { width: 1366, height: 768, name: "the most common laptop" },
];

async function measure(viewport, dir) {
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    throw new Error(`@playwright/test is not installed, so the A3 layout probe cannot run: ${error.message}`);
  }
  let browser;
  try {
    // Overlay scrollbars are what made A3 look like deletion rather than
    // scrolling: on macOS and iOS nothing is painted until something moves.
    // Emulating them here is the point — a fix that only works because Windows
    // draws a permanent scrollbar is not a fix.
    browser = await chromium.launch({ args: ["--enable-features=OverlayScrollbar"] });
  } catch (error) {
    throw new Error(
      "Chromium is not available, so the A3 layout probe cannot run. Install it with `npx playwright install chromium`. "
      + "This check is not optional: A3 is a layout defect and no amount of reading CSS proves it fixed.\n"
      + String(error),
    );
  }
  const page = await browser.newPage({ viewport });
  await page.setContent(sidebarHtml("owner").replace('<html lang="en">', `<html lang="en" dir="${dir}">`));
  const result = await page.evaluate(async () => {
    // The cue fades over .18s. Wait past that after each change so the value
    // read is the settled one and not a frame of the transition.
    const settle = () => new Promise((resolve) => setTimeout(() => requestAnimationFrame(resolve), 260));
    const vh = window.innerHeight;
    const rect = (sel) => { const el = document.querySelector(sel); const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
    const nav = document.querySelector(".side-nav");
    const wrap = document.querySelector(".side-nav-wrap");
    const fadeDown = document.querySelector(".side-nav-fade-bottom");
    const fadeUp = document.querySelector(".side-nav-fade-top");
    // FIRST, while nothing has been scrolled: what the owner saw on arrival.
    nav.scrollTop = 0;
    window.__measureSideNav();
    await settle();
    const atRest = { down: getComputedStyle(fadeDown).opacity, up: getComputedStyle(fadeUp).opacity, cls: wrap.className };
    // ...and at the bottom of the list.
    nav.scrollTop = nav.scrollHeight;
    window.__measureSideNav();
    await settle();
    const atEnd = { down: getComputedStyle(fadeDown).opacity, up: getComputedStyle(fadeUp).opacity };
    nav.scrollTop = 0;
    window.__measureSideNav();
    await settle();

    const dests = [...document.querySelectorAll("[data-dest]")];
    const unreachable = [];
    for (const el of dests) {
      el.scrollIntoView({ block: "nearest" });
      const b = el.getBoundingClientRect();
      if (b.height === 0 || b.width === 0) { unreachable.push(`${el.dataset.dest} has no box`); continue; }
      if (b.top < -0.5 || b.bottom > vh + 0.5) { unreachable.push(`${el.dataset.dest} still outside the viewport after scrolling: ${Math.round(b.top)}..${Math.round(b.bottom)}`); continue; }
      // Centre of the row itself — in RTL the sidebar is on the other edge.
      const hit = document.elementFromPoint(Math.round((b.left + b.right) / 2), Math.round((b.top + b.bottom) / 2));
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) unreachable.push(`${el.dataset.dest} is covered by ${hit ? hit.className || hit.tagName : "nothing"}`);
    }

    return {
      vh,
      aside: rect(".desk-side"),
      utilities: rect(".side-utilities"),
      footer: rect(".side-footer"),
      nav: { clientHeight: nav.clientHeight, scrollHeight: nav.scrollHeight },
      wrapClass: atRest.cls,
      fadeInset: getComputedStyle(fadeUp).insetInlineEnd,
      atRest,
      atEnd,
      destinations: dests.map((el) => el.dataset.dest),
      unreachable,
    };
  });
  await browser.close();
  return result;
}

for (const viewport of VIEWPORTS) {
  test(`A3: every sidebar destination is reachable at ${viewport.width}x${viewport.height} (${viewport.name})`, async () => {
    const m = await measure(viewport, "ltr");

    assert.deepEqual(m.unreachable, [], "destinations that cannot be brought on screen");

    // Nothing may be pushed past the bottom of the window. This is what
    // `.desk-side { overflow: hidden }` plus a flex-none footer guarantees.
    assert.ok(m.aside.bottom <= m.vh + 0.5, `the sidebar itself overflows the viewport by ${Math.round(m.aside.bottom - m.vh)}px`);
    assert.ok(m.footer.bottom <= m.vh + 0.5 && m.footer.top >= -0.5, `sign out is off screen (${Math.round(m.footer.top)}..${Math.round(m.footer.bottom)} of ${m.vh})`);
    assert.ok(m.utilities.bottom <= m.vh + 0.5 && m.utilities.top >= -0.5, `the utilities row is off screen (${Math.round(m.utilities.top)}..${Math.round(m.utilities.bottom)} of ${m.vh})`);

    // No destination twice: the same href in two rows is a duplicate link for a
    // screen reader and wasted height in a column that has none to spare.
    assert.equal(new Set(m.destinations).size, m.destinations.length, `the sidebar renders a destination twice: ${m.destinations.join(", ")}`);

    // Every destination the role can see is in the sidebar somewhere.
    const expected = itemsFor("owner", { platformAdmin: true }).map((i) => i.href).sort();
    assert.deepEqual([...m.destinations].sort(), expected, "the sidebar and lib/nav.ts disagree about what an owner can reach");
  });

  test(`A3: the sidebar says it scrolls at ${viewport.width}x${viewport.height}`, async () => {
    const m = await measure(viewport, "ltr");
    const overflows = m.nav.scrollHeight > m.nav.clientHeight + 1;
    if (!overflows) return; // nothing to signal

    // THE DEFECT. With overlay scrollbars — macOS, iOS — nothing at all is
    // painted at rest, so a well holding half its content looked like a list
    // that simply ended. There must be a cue, and it must be showing before
    // the user touches anything.
    assert.match(m.wrapClass, /can-scroll-down/, "the scroll port does not know it has content below");
    assert.equal(m.atRest.down, "1", "there is no visible cue that the navigation continues below the fold");
    assert.equal(m.atRest.up, "0", "the top cue is showing when nothing is scrolled past");
    // ...and it must go away at the end, or it is decoration rather than a cue.
    assert.equal(m.atEnd.down, "0", "the cue still claims there is more below at the end of the list");
    assert.equal(m.atEnd.up, "1", "no cue that there is content above once scrolled");

    // At least half the navigation is on screen without scrolling. The audit
    // measured 738 of 1162 (63%) with the Tools group closed and far worse open;
    // this is the height budget that keeps the sidebar a navigation rather than
    // a peephole.
    const visible = m.nav.clientHeight / m.nav.scrollHeight;
    assert.ok(visible >= 0.5, `only ${Math.round(visible * 100)}% of the navigation fits on screen at ${viewport.height}px tall`);
  });
}

test("A3: the scroll cue is mirrored under RTL", async () => {
  const m = await measure({ width: 1366, height: 768 }, "rtl");
  assert.deepEqual(m.unreachable, []);
  // The gap that keeps the cue clear of the scrollbar must follow the writing
  // direction, not the left edge.
  assert.equal(m.fadeInset, "10px", "the fade uses a physical inset and will sit over the scrollbar in RTL");
});
