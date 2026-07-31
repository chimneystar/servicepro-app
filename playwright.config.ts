import { defineConfig, devices } from "@playwright/test";

// Browser tests. Not part of the app build (excluded in tsconfig).
//
// Previously this config had no `webServer`, so `npx playwright test` failed on
// connection-refused unless someone had already started the app by hand, and it
// was wired to no npm script at all. It now starts the app itself.
//
// AUTHENTICATED PAGES: the specs gate authed routes behind STORAGE_STATE, a
// saved signed-in session. Producing one needs a real Supabase project and a
// seeded user, so those checks skip unless STORAGE_STATE is provided — see
// docs/REMEDIATION-PLAN.md item 0.4. Public pages are always checked.
const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  // Only manage the server when pointed at our own localhost. If BASE_URL names
  // a deployed environment, starting a local server would be wrong.
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder-anon-key",
        },
      },
});
