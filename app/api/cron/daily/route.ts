import { NextResponse, type NextRequest } from "next/server";
import { runRecurringGeneration, runReminders } from "@/lib/cron-tasks";
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
 * Protected by CRON_SECRET when that env var is set.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const result: any = { ok: true };
  try { result.recurringJobsCreated = await runRecurringGeneration(); } catch (e: any) { result.recurringError = String(e?.message ?? e); }
  try { result.reminders = await runReminders(); } catch (e: any) { result.remindersError = String(e?.message ?? e); }
  try { result.pendingPayments = await reconcilePendingHelcimPayments(); } catch (e: any) { result.pendingPaymentsError = String(e?.message ?? e); }
  try { result.paymentReceipts = await retryFailedPaymentReceipts(); } catch (e: any) { result.paymentReceiptsError = String(e?.message ?? e); }
  try { result.dataRetention = await runAutomaticDataRetention(); } catch (e: any) { result.dataRetentionError = String(e?.message ?? e); }
  return NextResponse.json(result);
}
