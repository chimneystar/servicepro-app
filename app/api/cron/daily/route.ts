import { NextResponse, type NextRequest } from "next/server";
// @ts-ignore - shared pure JavaScript, proven both ways in tests/security.test.mjs
import { isAuthorizedBearer } from "@/lib/core/security.mjs";
import {
  runAutomationRules,
  runDunning,
  runGrowthOutreach,
  runRecurringGeneration,
  runReminders,
  runScheduledReports,
} from "@/lib/cron-tasks";
import { reconcilePendingHelcimPayments } from "@/lib/payments/server";
import { retryFailedPaymentReceipts } from "@/lib/payments/receipts";
import { runAutomaticDataRetention } from "@/lib/data-retention";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily automation. Vercel Cron hits this once a day (see vercel.json).
 * - Generates jobs for any due maintenance plans (works with no extra keys).
 * - Sends day-before appointment reminders + weekly overdue nudges (needs
 *   Twilio + SUPABASE_SERVICE_ROLE_KEY; silently no-ops otherwise).
 * - Reconciles ACH payments that Helcim still reports as processing.
 * - Executes automation rules (ledger 5.8) and sends scheduled campaigns and
 *   estimate follow-ups (ledger 5.9). Both honour customer opt-out and both
 *   record every attempt, including refusals, so nothing fails in silence.
 *
 * REQUIRES CRON_SECRET. Without it this endpoint returns 401 and does nothing —
 * it must never be reachable anonymously, because runAutomaticDataRetention()
 * permanently deletes customer records across every organisation.
 */
export async function GET(request: NextRequest) {
  // FAIL CLOSED. This endpoint deletes customer data across every organisation
  // (runAutomaticDataRetention) and spends money on SMS. The previous guard
  // skipped authentication entirely when CRON_SECRET was unset — and
  // .env.example ships it blank, making that the default.
  //
  // isAuthorizedBearer refuses an empty secret by construction and is proven in
  // both directions in tests/security.test.mjs.
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Each subsystem is isolated so one failure does not suppress the rest — but
  // the route must NOT report success when any of them failed. A green cron
  // dashboard over a broken system is the failure this guards against.
  const result: Record<string, unknown> = {};
  const failures: string[] = [];

  const run = async (name: string, task: () => Promise<unknown>) => {
    try {
      result[name] = await task();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push(name);
      result[`${name}Error`] = message;
      console.error(`[cron/daily] ${name} failed:`, message);
    }
  };

  await run("recurringJobsCreated", runRecurringGeneration);
  await run("reminders", runReminders);
  await run("automations", runAutomationRules);
  await run("outreach", runGrowthOutreach);
  // Ledger 6c.6 — the escalation ladder, alongside (not replacing) the weekly
  // nudge above. Ledger 6c.9 — the emailed digest, on this existing cron
  // rather than a second endpoint with a second secret to leak.
  await run("dunning", runDunning);
  await run("scheduledReports", runScheduledReports);
  await run("pendingPayments", reconcilePendingHelcimPayments);
  await run("paymentReceipts", retryFailedPaymentReceipts);
  await run("dataRetention", runAutomaticDataRetention);

  const ok = failures.length === 0;
  return NextResponse.json(
    { ok, ...(ok ? {} : { failed: failures }), ...result },
    { status: ok ? 200 : 500 },
  );
}
