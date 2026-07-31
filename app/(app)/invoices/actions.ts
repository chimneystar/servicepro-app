"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { createDocument, updateDocument, duplicateDocument, softDeleteDocument, type ActionResult } from "@/lib/documents";
import { providers, sendEmail, sendSms, appUrl } from "@/lib/providers";
import { notifyPaymentReceived } from "@/lib/notify";
// @ts-ignore -- shared JS module, proven both ways in tests/bulk-operations.test.mjs
import { bulkReport, parseSelection, selectionError } from "@/lib/core/bulk.mjs";
// @ts-ignore -- the SINGLE shared opt-out rule (tests/outreach.test.mjs)
import { contactEligibility, truncateForSms } from "@/lib/core/outreach.mjs";
// @ts-ignore -- shared JS module
import { escapeHtml } from "@/lib/core/security.mjs";
// @ts-ignore -- shared JS module
import { formatMoney } from "@/lib/core/money.mjs";

export async function createInvoice(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await createDocument("invoice", formData, profile, (await getLocale()));
  if (res.ok) revalidatePath("/invoices");
  return res;
}

export async function updateInvoice(id: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const res = await updateDocument("invoice", id, formData, profile, (await getLocale()));
  if (res.ok) { revalidatePath("/invoices"); revalidatePath(`/invoices/${id}`); }
  return res;
}

export async function duplicateInvoice(id: string): Promise<{ ok: boolean; error?: string; newId?: string }> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await duplicateDocument("invoice", id, profile);
  if (res.ok) revalidatePath("/invoices");
  return res;
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  try { const p = await requireProfile(); assertRole(p, ["owner", "office"]); }
  catch { return { ok: false, error: t((await getLocale()), "err.forbidden") }; }
  const res = await softDeleteDocument("invoice", id);
  if (res.ok) revalidatePath("/invoices");
  return res;
}

/** Flip an invoice between paid and unpaid, and log/clear a payment row. */
export async function setInvoicePaid(invoiceId: string, paid: boolean): Promise<ActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return { ok: false, error: "forbidden" }; }
  const supabase = await createClient();

  const { data: inv } = await supabase.from("invoices").select("id, total_minor").eq("id", invoiceId).single();
  if (!inv) return { ok: false, error: "not found" };

  const { error } = await supabase.from("invoices")
    .update({ status: paid ? "paid" : "unpaid", paid_at: paid ? new Date().toISOString() : null })
    .eq("id", invoiceId);
  if (error) return { ok: false, error: error.message };

  if (paid) {
    // Record a manual payment for the full balance (if none logged yet).
    const { data: existing } = await supabase.from("payments").select("id").eq("invoice_id", invoiceId).limit(1);
    if (!existing || existing.length === 0) {
      const { data: created } = await supabase.from("payments").insert({
        organization_id: profile.organization_id, invoice_id: invoiceId,
        amount_minor: inv.total_minor, status: "paid", method: "manual",
        paid_at: new Date().toISOString(), created_by: profile.id,
      }).select("id").maybeSingle();
      // Ledger 6c.5 — an owner is finally told that money arrived. Never allowed
      // to fail the payment itself.
      if (created?.id) await notifyOwnerOfPayment(invoiceId, created.id, profile.organization_id!);
    }
  }
  revalidatePath("/invoices");
  return { ok: true };
}

/**
 * Tell the owner (and finance-capable office members) that a payment landed.
 *
 * NOTE — this covers the MANUAL "mark paid" path only. The provider paths live
 * in `lib/payments/**`, which another workstream owns on this branch, so a card
 * or ACH settlement does NOT yet raise this notification. That gap is stated in
 * the ledger rather than papered over.
 */
async function notifyOwnerOfPayment(invoiceId: string, paymentId: string, organizationId: string): Promise<void> {
  try {
    const supabase = await createClient();
    const [{ data: invoice }, { data: org }] = await Promise.all([
      supabase.from("invoices").select("id, number, total_minor, customers(name)").eq("id", invoiceId).maybeSingle(),
      supabase.from("organizations").select("currency").single(),
    ]);
    const customer = (invoice?.customers ?? null) as { name?: string } | null;
    await notifyPaymentReceived({
      organizationId, paymentId,
      amountLabel: formatMoney(Number(invoice?.total_minor ?? 0), { currency: org?.currency ?? "USD" }) as string,
      customerName: customer?.name ?? "",
      invoiceNumber: invoice?.number ?? null,
      invoiceId,
    });
  } catch (cause: unknown) {
    console.error("[invoices] the payment notification could not be sent:", cause instanceof Error ? cause.message : String(cause));
  }
}

// =====================================================================
//  BULK OPERATIONS on the invoice list (ledger 6c.10).
//
//  Sending 40 invoices was 40 clicks. These actions are LIST-LEVEL only —
//  editing an invoice is owned elsewhere on this branch and is untouched here.
//
//  Every one of them holds the same contract: validate the whole selection
//  first, then attempt each row independently, then return a report that names
//  every row that did not succeed and WHY. `ok` is true only when nothing
//  failed; there is no "mostly worked".
// =====================================================================

export type BulkFailure = { id: string; label: string; reason: string };
export type BulkActionResult = {
  ok: boolean; attempted: number; succeeded: number;
  failed: BulkFailure[]; skipped: BulkFailure[];
  failedCount: number; skippedCount: number; error?: string;
};

const refuse = (error: string): BulkActionResult => ({
  ok: false, attempted: 0, succeeded: 0, failed: [], skipped: [], failedCount: 0, skippedCount: 0, error,
});

const rowError = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Persist the report so "which six of the forty failed" is answerable tomorrow. */
async function recordBulk(action: string, organizationId: string, actorId: string, report: BulkActionResult): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("bulk_operations").insert({
      organization_id: organizationId, actor_id: actorId, action,
      attempted: report.attempted, succeeded: report.succeeded,
      failed: report.failedCount, skipped: report.skippedCount,
      failures: [...report.failed, ...report.skipped],
    });
    if (error) console.error(`[bulk] could not record ${action}: ${error.message}`);
  } catch (cause: unknown) {
    console.error(`[bulk] could not record ${action}:`, rowError(cause));
  }
}

/**
 * Email (or text) a payment link for each selected invoice.
 *
 * Consent is decided by `contactEligibility` — the single shared rule, which
 * refuses a NON-BOOLEAN flag as well as an explicit false, so a query that
 * forgot the column cannot read as universal consent. A refusal is reported as
 * a SKIP with its reason, never as a success and never as a failure.
 */
export async function bulkSendInvoices(rawIds: string[]): Promise<BulkActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return refuse(t((await getLocale()), "err.forbidden")); }

  const selection = parseSelection(rawIds) as { ok: boolean; ids?: string[]; reason?: string };
  if (!selection.ok) return refuse(selectionError(selection) as string);

  const supabase = await createClient();
  const [{ data: invoices }, { data: org }] = await Promise.all([
    supabase.from("invoices")
      .select("id, number, total_minor, public_token, customer_id, customers(id, name, phone, email, sms_opt_in, email_opt_in, deleted_at)")
      .in("id", selection.ids!).is("deleted_at", null),
    supabase.from("organizations").select("name, currency").single(),
  ]);

  const origin = appUrl().replace(/\/$/, "");
  const byId = new Map((invoices ?? []).map((row: { id: string }) => [row.id, row]));
  const results: { id: string; label: string; ok: boolean; skipped?: boolean; reason?: string }[] = [];

  for (const id of selection.ids!) {
    const invoice = byId.get(id) as any;
    if (!invoice) { results.push({ id, label: id.slice(0, 8), ok: false, reason: "invoice not found" }); continue; }
    const label = `#${invoice.number ?? id.slice(0, 8)}`;
    const customer = invoice.customers;

    // Prefer email (an invoice needs a body); fall back to SMS.
    const channel: "email" | "sms" = providers.email() ? "email" : "sms";
    if (channel === "sms" ? !providers.sms() : !providers.email()) {
      results.push({ id, label, ok: false, skipped: true, reason: "no email or SMS provider is connected" });
      continue;
    }
    const eligibility = contactEligibility(customer, channel) as { ok: boolean; to?: string; reason?: string };
    if (!eligibility.ok) { results.push({ id, label, ok: false, skipped: true, reason: eligibility.reason! }); continue; }

    const amount = formatMoney(Number(invoice.total_minor ?? 0), { currency: org?.currency ?? "USD" }) as string;
    const link = origin && invoice.public_token ? `${origin}/p/${invoice.public_token}` : "";
    const first = String(customer?.name ?? "").split(" ")[0] ?? "";
    const text = `Hi ${first}, invoice ${label} from ${org?.name ?? ""} for ${amount} is ready.`
      + (link ? ` View and pay it here: ${link}` : "");

    try {
      if (channel === "email") {
        const html = `<p>${escapeHtml(text)}</p>`
          + (link ? `<p><a href="${escapeHtml(link)}">View invoice ${escapeHtml(label)}</a></p>` : "");
        const messageId = await sendEmail(eligibility.to!, `Invoice ${label} — ${org?.name ?? ""}`.trim(), html);
        await supabase.from("email_messages").insert({
          organization_id: profile.organization_id, related_type: "invoice", related_id: id,
          to_email: eligibility.to, subject: `Invoice ${label}`, provider: "resend",
          provider_message_id: messageId, status: "sent", sent_at: new Date().toISOString(),
        });
      } else {
        const sid = await sendSms(eligibility.to!, truncateForSms(text) as string);
        await supabase.from("sms_messages").insert({
          organization_id: profile.organization_id, customer_id: invoice.customer_id ?? null,
          to_phone: eligibility.to, body: text, provider: "twilio",
          provider_message_id: sid, status: "sent", sent_at: new Date().toISOString(),
        });
      }
      results.push({ id, label, ok: true });
    } catch (cause: unknown) {
      // Logged as a real failure on the message table too, so the send attempt
      // is not invisible outside this one report.
      const reason = rowError(cause);
      if (channel === "email") {
        await supabase.from("email_messages").insert({
          organization_id: profile.organization_id, related_type: "invoice", related_id: id,
          to_email: eligibility.to, subject: `Invoice ${label}`, provider: "resend", status: "failed", error: reason,
        });
      } else {
        await supabase.from("sms_messages").insert({
          organization_id: profile.organization_id, customer_id: invoice.customer_id ?? null,
          to_phone: eligibility.to, body: text, provider: "twilio", status: "failed", error: reason,
        });
      }
      results.push({ id, label, ok: false, reason });
    }
  }

  const report = bulkReport("invoices.send", results) as BulkActionResult;
  await recordBulk("invoices.send", profile.organization_id!, profile.id, report);
  revalidatePath("/invoices");
  return report;
}

/** Mark every selected invoice paid (or unpaid), one at a time, reporting each. */
export async function bulkSetInvoicePaid(rawIds: string[], paid: boolean): Promise<BulkActionResult> {
  let profile;
  try { profile = await requireProfile(); assertRole(profile, ["owner", "office"]); }
  catch { return refuse(t((await getLocale()), "err.forbidden")); }

  const selection = parseSelection(rawIds) as { ok: boolean; ids?: string[]; reason?: string };
  if (!selection.ok) return refuse(selectionError(selection) as string);

  const supabase = await createClient();
  const { data: invoices } = await supabase.from("invoices")
    .select("id, number, status").in("id", selection.ids!).is("deleted_at", null);
  const byId = new Map((invoices ?? []).map((row: { id: string }) => [row.id, row]));

  const results: { id: string; label: string; ok: boolean; skipped?: boolean; reason?: string }[] = [];
  for (const id of selection.ids!) {
    const invoice = byId.get(id) as { id: string; number?: number; status?: string } | undefined;
    const label = `#${invoice?.number ?? id.slice(0, 8)}`;
    if (!invoice) { results.push({ id, label, ok: false, reason: "invoice not found" }); continue; }
    if ((invoice.status === "paid") === paid) {
      results.push({ id, label, ok: false, skipped: true, reason: `already ${paid ? "paid" : "unpaid"}` });
      continue;
    }
    const result = await setInvoicePaid(id, paid);
    if (result.ok) results.push({ id, label, ok: true });
    else results.push({ id, label, ok: false, reason: result.error ?? "the update was refused" });
  }

  const action = paid ? "invoices.mark_paid" : "invoices.mark_unpaid";
  const report = bulkReport(action, results) as BulkActionResult;
  await recordBulk(action, profile.organization_id!, profile.id, report);
  revalidatePath("/invoices");
  return report;
}
