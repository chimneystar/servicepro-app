import { defineConfig, devices } from "@playwright/test";

// Console-error e2e config. Not part of the app build (excluded in tsconfig).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    ...devices["Desktop Chrome"],
  },
});
