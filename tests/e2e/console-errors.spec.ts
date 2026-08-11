// Browser test: fails if any core page emits a console error or a page/network
// error (this is what catches React hydration errors #418/#423 in the real DOM).
//
// Run locally / in CI:
//   npm i -D @playwright/test && npx playwright install chromium
//   BASE_URL=http://localhost:3000 STORAGE_STATE=auth.json npx playwright test
//
// Provide STORAGE_STATE (a signed-in session) so the authed pages load; public
// pages are checked without it.
import { test, expect } from "@playwright/test";

const AUTHED = [
  "/",
  "/jobs",
  "/schedule",
  "/customers",
  "/estimates",
  "/invoices",
  "/reports",
  "/reports/commission",
  "/recurring",
  "/messages",
  "/inventory",
  "/settings",
];
const PUBLIC = ["/login", "/signup", "/forgot-password"];

const IGNORE = [/Failed to load resource/i, /favicon/i, /ResizeObserver loop/i];

function watch(page: import("@playwright/test").Page, errors: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORE.some((r) => r.test(m.text())))
      errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
}

async function unreadableVisibleText(page: import("@playwright/test").Page) {
  return page.locator("body *").evaluateAll((elements) =>
    elements.flatMap((element) => {
      if (!(element instanceof HTMLElement)) return [];
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .trim();
      if (!ownText || !element.checkVisibility()) return [];

      const style = getComputedStyle(element);
      const size = Number.parseFloat(style.fontSize);
      const transparent =
        Number.parseFloat(style.opacity) < 0.2 ||
        style.color === "transparent" ||
        /rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(style.color);
      if (size >= 14 && !transparent) return [];

      return [
        `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}: ${size}px, ${style.color}, opacity ${style.opacity} — ${ownText.slice(0, 80)}`,
      ];
    }),
  );
}

for (const locale of ["en", "he"] as const) {
  for (const path of PUBLIC) {
    test(`no console or unreadable text errors on ${path} (${locale})`, async ({
      page,
      context,
      baseURL,
    }) => {
      await context.addCookies([
        { name: "locale", value: locale, url: baseURL ?? "http://localhost:3000" },
      ]);
      const errors: string[] = [];
      watch(page, errors);
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "he" ? "rtl" : "ltr");
      expect(errors, errors.join("\n")).toHaveLength(0);
      const unreadable = await unreadableVisibleText(page);
      expect(unreadable, unreadable.join("\n")).toHaveLength(0);
    });
  }
}

test.describe("authenticated pages", () => {
  test.skip(
    !process.env.STORAGE_STATE,
    "set STORAGE_STATE to a signed-in session to run authed checks",
  );
  test.use({ storageState: process.env.STORAGE_STATE });
  for (const path of AUTHED) {
    test(`no console errors on ${path}`, async ({ page }) => {
      const errors: string[] = [];
      watch(page, errors);
      await page.goto(path, { waitUntil: "networkidle" });
      await page.waitForTimeout(800); // let hydration settle
      expect(errors, errors.join("\n")).toHaveLength(0);
    });
  }
});
