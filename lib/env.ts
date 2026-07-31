import "server-only";
// @ts-ignore — pure validation logic, proven both ways in tests/env-check.test.mjs
import { checkEnv as check } from "@/lib/core/env-check.mjs";

/**
 * Environment validation at boot.
 *
 * THE FAILURE THIS PREVENTS: every secret in this app was read lazily at the
 * point of use, so a deploy with a missing variable succeeded and then failed
 * later, in front of a customer, with no alert. PAYMENT_SECRETS_KEY was the
 * worst case — the app started perfectly and the FIRST REAL CARD PAYMENT threw.
 *
 * The rules live in lib/core/env-check.mjs so they are unit-tested; this file
 * only supplies process.env and decides how loudly to complain. Nothing here
 * ever logs a secret's value — only names and presence.
 */
export type EnvReport = {
  ok: boolean;
  fatal: string[];
  warnings: string[];
  enabled: string[];
  disabled: string[];
};

export function checkEnv(): EnvReport {
  return check(process.env) as EnvReport;
}

/** Report at boot. Throws when a required capability is missing. */
export function assertEnv(): EnvReport {
  const report = checkEnv();

  for (const line of report.disabled) console.warn(`[env] disabled: ${line}`);
  for (const line of report.warnings) console.error(`[env] WARNING: ${line}`);

  if (!report.ok) {
    const detail = report.fatal.map((line) => `  - ${line}`).join("\n");
    throw new Error(`Environment is not usable:\n${detail}\n\nSee .env.example.`);
  }

  console.info(`[env] ready — enabled: ${report.enabled.join("; ") || "core only"}`);
  return report;
}
