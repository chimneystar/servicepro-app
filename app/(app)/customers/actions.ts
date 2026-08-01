"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { customerSchema } from "@/lib/validation";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { sendStatement } from "@/lib/statements";
// @ts-ignore -- shared JS module, proven both ways in tests/bulk-operations.test.mjs
import { bulkReport, parseSelection, selectionError } from "@/lib/core/bulk.mjs";

export type ActionResult = { ok: boolean; error?: string };

function parse(formData: FormData) {
  return customerSchema.safeParse({
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
    city: formData.get("city") ?? "",
    billing_address: formData.get("billing_address") ?? "",
    billing_city: formData.get("billing_city") ?? "",
    source: formData.get("source") ?? "",
    notes: formData.get("notes") ?? "",
  });
}

/** Create a customer. Server-validated; org comes from the session, never the client. */
export async function createCustomer(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = await getLocale();
  const parsed = parse(formData);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "err.invalid";
    return { ok: false, error: t(locale, key) };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("customers").insert({
    organization_id: profile.organization_id,
    created_by: profile.id,
    ...parsed.data,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  return { ok: true };
}

/** Update a customer (RLS also guarantees it belongs to this org). */
export async function updateCustomer(
  id: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireProfile();
  const locale = await getLocale();
  const parsed = parse(formData);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.message ?? "err.invalid";
    return { ok: false, error: t(locale, key) };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("customers").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  return { ok: true };
}

// =====================================================================
//  Statements + bulk operations (ledger 6c.6 and 6c.10).
// =====================================================================

/** Send one customer their statement. Consent and recording live in lib/statements.ts. */
export async function sendCustomerStatement(
  customerId: string,
  channel: "sms" | "email",
): Promise<ActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: t(await getLocale(), "err.forbidden") };
  }
  if (channel !== "sms" && channel !== "email") return { ok: false, error: "unknown channel" };

  const result = await sendStatement({
    organizationId: profile.organization_id!,
    customerId,
    channel,
    actorId: profile.id,
    locale: (await getLocale()) as "en" | "he",
  });
  revalidatePath(`/customers/${customerId}`);
  if (result.ok) return { ok: true };
  // A deliberate skip and a breakage are DIFFERENT answers, and both are said
  // out loud rather than swallowed.
  return {
    ok: false,
    error: result.skipped ? `Not sent: ${result.reason}` : `Send failed: ${result.reason}`,
  };
}

export type BulkFailure = { id: string; label: string; reason: string };
export type BulkActionResult = {
  ok: boolean;
  attempted: number;
  succeeded: number;
  failed: BulkFailure[];
  skipped: BulkFailure[];
  failedCount: number;
  skippedCount: number;
  error?: string;
};

const refuseBulk = (error: string): BulkActionResult => ({
  ok: false,
  attempted: 0,
  succeeded: 0,
  failed: [],
  skipped: [],
  failedCount: 0,
  skippedCount: 0,
  error,
});

async function recordBulk(
  action: string,
  organizationId: string,
  actorId: string,
  report: BulkActionResult,
): Promise<void> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("bulk_operations").insert({
      organization_id: organizationId,
      actor_id: actorId,
      action,
      attempted: report.attempted,
      succeeded: report.succeeded,
      failed: report.failedCount,
      skipped: report.skippedCount,
      failures: [...report.failed, ...report.skipped],
    });
    if (error) console.error(`[bulk] could not record ${action}: ${error.message}`);
  } catch (cause: unknown) {
    console.error(
      `[bulk] could not record ${action}:`,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

/**
 * Send a statement to every selected customer.
 *
 * A customer who opted out is SKIPPED with the reason; a provider error is a
 * FAILURE with its message. The two are never conflated, and the batch is never
 * reported as done while anything failed.
 */
export async function bulkSendStatements(
  rawIds: string[],
  channel: "sms" | "email",
): Promise<BulkActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return refuseBulk(t(await getLocale(), "err.forbidden"));
  }
  if (channel !== "sms" && channel !== "email") return refuseBulk("unknown channel");

  const selection = parseSelection(rawIds) as { ok: boolean; ids?: string[]; reason?: string };
  if (!selection.ok) return refuseBulk(selectionError(selection) as string);

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .in("id", selection.ids!)
    .is("deleted_at", null);
  const nameOf = new Map(
    (customers ?? []).map((row: { id: string; name: string }) => [row.id, row.name]),
  );

  const locale = (await getLocale()) as "en" | "he";
  const results: { id: string; label: string; ok: boolean; skipped?: boolean; reason?: string }[] =
    [];
  for (const id of selection.ids!) {
    const label = nameOf.get(id) ?? id.slice(0, 8);
    if (!nameOf.has(id)) {
      results.push({ id, label, ok: false, reason: "customer not found" });
      continue;
    }
    const result = await sendStatement({
      organizationId: profile.organization_id!,
      customerId: id,
      channel,
      actorId: profile.id,
      locale,
    });
    if (result.ok) results.push({ id, label, ok: true });
    else
      results.push({
        id,
        label,
        ok: false,
        skipped: result.skipped === true,
        reason: result.reason ?? "the send was refused",
      });
  }

  const report = bulkReport("customers.statement", results) as BulkActionResult;
  await recordBulk("customers.statement", profile.organization_id!, profile.id, report);
  revalidatePath("/customers");
  return report;
}

/**
 * Record an opt-out for every selected customer.
 *
 * Only ever writes FALSE. There is deliberately no bulk opt-IN: consent is
 * given by the person, not applied to a list by an operator, and a button that
 * could re-subscribe forty people who replied STOP is a legal problem waiting
 * to happen.
 */
export async function bulkOptOut(
  rawIds: string[],
  channel: "sms" | "email",
): Promise<BulkActionResult> {
  let profile;
  try {
    profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
  } catch {
    return refuseBulk(t(await getLocale(), "err.forbidden"));
  }
  if (channel !== "sms" && channel !== "email") return refuseBulk("unknown channel");

  const selection = parseSelection(rawIds) as { ok: boolean; ids?: string[]; reason?: string };
  if (!selection.ok) return refuseBulk(selectionError(selection) as string);

  const supabase = await createClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .in("id", selection.ids!)
    .is("deleted_at", null);
  const nameOf = new Map(
    (customers ?? []).map((row: { id: string; name: string }) => [row.id, row.name]),
  );

  const results: { id: string; label: string; ok: boolean; skipped?: boolean; reason?: string }[] =
    [];
  for (const id of selection.ids!) {
    const label = nameOf.get(id) ?? id.slice(0, 8);
    if (!nameOf.has(id)) {
      results.push({ id, label, ok: false, reason: "customer not found" });
      continue;
    }
    // Naming the column in each branch rather than computing the key: a computed
    // key of union type widens the object to `{ [x: string]: boolean }`, which
    // says nothing about which column is being cleared. Same write either way.
    const { error } = await supabase
      .from("customers")
      .update(channel === "sms" ? { sms_opt_in: false } : { email_opt_in: false })
      .eq("id", id);
    if (error) results.push({ id, label, ok: false, reason: error.message });
    else results.push({ id, label, ok: true });
  }

  const action = channel === "sms" ? "customers.opt_out_sms" : "customers.opt_out_email";
  const report = bulkReport(action, results) as BulkActionResult;
  await recordBulk(action, profile.organization_id!, profile.id, report);
  revalidatePath("/customers");
  return report;
}

/** Delete a customer. Restricted to owner/office in the app AND by RLS. */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const locale = await getLocale();
  try {
    assertRole(profile, ["owner", "office"]);
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = await createClient();

  // SOFT delete. This was a hard `.delete()`, which permanently destroyed the
  // customer row: no trash, no restore, and no way to recover from a mis-click.
  // `jobs.customer_id` is `on delete restrict`, so it happened to fail for
  // customers WITH jobs and silently destroyed everyone else — the newest
  // customers, the ones most likely to have been added by mistake.
  //
  // Every list already filters `deleted_at is null`, so the visible behaviour is
  // unchanged; the difference is that /trash can now bring it back. Legal
  // erasure remains a separate path (the privacy anonymiser), which overwrites
  // the PII rather than hiding the row.
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/customers");
  revalidatePath("/trash");
  return { ok: true };
}
