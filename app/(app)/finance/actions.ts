"use server";

import { revalidatePath } from "next/cache";
import { assertCapability, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";

export type FinanceResult = { ok: boolean; error?: string };
const initialError = (he: boolean) => he ? "לא הצלחנו לשמור. בדקו את הפרטים ונסו שוב." : "We couldn't save this. Check the details and try again.";
const minor = (value: FormDataEntryValue | null) => Math.round(Number(String(value ?? "0")) * 100);

async function guardFinance() {
  const profile = await requireProfile();
  await assertCapability(profile, "payments.manage");
  return profile;
}

export async function createTaxJurisdiction(_previous: FinanceResult, formData: FormData): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guardFinance();
    const name = String(formData.get("name") ?? "").trim();
    const rate = Number(formData.get("rate") ?? 0);
    if (!name || !Number.isFinite(rate) || rate < 0 || rate > 1000) return { ok: false, error: initialError(he) };
    const supabase = await createClient();
    const { error } = await supabase.from("tax_jurisdictions").insert({
      organization_id: profile.organization_id, name, code: String(formData.get("code") ?? "").trim() || null,
      jurisdiction_type: String(formData.get("type") ?? "state"), applies_to: String(formData.get("appliesTo") ?? "all"),
      rate_bps: Math.round(rate * 100), effective_from: String(formData.get("effectiveFrom") ?? new Date().toISOString().slice(0, 10)),
      notes: String(formData.get("notes") ?? "").trim() || null, created_by: profile.id,
    });
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch { return { ok: false, error: he ? "אין לך הרשאה לנהל כספים." : "You don't have access to manage finance." }; }
}

export async function createTaxFiling(_previous: FinanceResult, formData: FormData): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guardFinance();
    const start = String(formData.get("periodStart") ?? ""), end = String(formData.get("periodEnd") ?? "");
    if (!start || !end || end < start) return { ok: false, error: initialError(he) };
    const supabase = await createClient();
    const { error } = await supabase.from("tax_filings").insert({ organization_id: profile.organization_id, period_start: start, period_end: end,
      due_on: String(formData.get("dueOn") ?? "") || null, taxable_sales_minor: minor(formData.get("taxableSales")),
      exempt_sales_minor: minor(formData.get("exemptSales")), tax_collected_minor: minor(formData.get("taxCollected")),
      tax_remitted_minor: minor(formData.get("taxRemitted")), status: String(formData.get("status") ?? "open"),
      confirmation_reference: String(formData.get("reference") ?? "").trim() || null, created_by: profile.id });
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch { return { ok: false, error: he ? "אין לך הרשאה לנהל כספים." : "You don't have access to manage finance." }; }
}

export async function createSettlement(_previous: FinanceResult, formData: FormData): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guardFinance();
    const gross = minor(formData.get("gross")), fees = minor(formData.get("fees")), refunds = minor(formData.get("refunds"));
    const chargebacks = minor(formData.get("chargebacks")), adjustments = minor(formData.get("adjustments"));
    const netValue = formData.get("net");
    const net = String(netValue ?? "").trim() ? minor(netValue) : gross - fees - refunds - chargebacks + adjustments;
    const supabase = await createClient();
    const { error } = await supabase.from("settlement_batches").insert({ organization_id: profile.organization_id,
      provider: String(formData.get("provider") ?? "manual").trim() || "manual", provider_settlement_id: String(formData.get("providerId") ?? "").trim() || null,
      settlement_date: String(formData.get("settlementDate") ?? new Date().toISOString().slice(0,10)), expected_arrival: String(formData.get("arrival") ?? "") || null,
      gross_minor: gross, fees_minor: fees, refunds_minor: refunds, chargebacks_minor: chargebacks, adjustments_minor: adjustments,
      net_minor: net, status: String(formData.get("status") ?? "expected"), bank_reference: String(formData.get("bankReference") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null, created_by: profile.id });
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch { return { ok: false, error: he ? "אין לך הרשאה לנהל כספים." : "You don't have access to manage finance." }; }
}

export async function createDispute(_previous: FinanceResult, formData: FormData): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guardFinance();
    const reason = String(formData.get("reason") ?? "").trim(), amount = minor(formData.get("amount"));
    if (!reason || amount <= 0) return { ok: false, error: initialError(he) };
    const supabase = await createClient();
    const { error } = await supabase.from("payment_disputes").insert({ organization_id: profile.organization_id,
      payment_id: String(formData.get("paymentId") ?? "") || null, provider: String(formData.get("provider") ?? "manual").trim() || "manual",
      provider_dispute_id: String(formData.get("providerId") ?? "").trim() || null, reason_code: String(formData.get("reasonCode") ?? "").trim() || null,
      reason, disputed_minor: amount, response_due_at: String(formData.get("responseDue") ?? "") || null,
      evidence_notes: String(formData.get("evidence") ?? "").trim() || null, assigned_to: String(formData.get("assignedTo") ?? "") || null,
      created_by: profile.id });
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch { return { ok: false, error: he ? "אין לך הרשאה לנהל כספים." : "You don't have access to manage finance." }; }
}

export async function updateSettlementStatus(id: string, status: string): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  if (!["expected","in_transit","deposited","reconciled","exception"].includes(status)) return { ok:false,error:initialError(he) };
  try { const profile = await guardFinance(); const supabase = await createClient(); const { error } = await supabase.from("settlement_batches").update({ status, reconciled_at: status === "reconciled" ? new Date().toISOString() : null, reconciled_by: status === "reconciled" ? profile.id : null }).eq("id", id).eq("organization_id", profile.organization_id!); if (error) return {ok:false,error:initialError(he)}; revalidatePath("/finance"); return {ok:true}; } catch { return {ok:false,error:he?"אין הרשאה.":"Not allowed."}; }
}

export async function updateDispute(id: string, status: string, evidence: string): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  if (!["needs_response","under_review","won","lost","accepted","closed"].includes(status)) return {ok:false,error:initialError(he)};
  try { const profile = await guardFinance(); const supabase = await createClient(); const { error } = await supabase.from("payment_disputes").update({ status, evidence_notes: evidence.trim() || null, closed_at: ["won","lost","accepted","closed"].includes(status) ? new Date().toISOString() : null }).eq("id",id).eq("organization_id",profile.organization_id!); if(error)return{ok:false,error:initialError(he)}; revalidatePath("/finance");return{ok:true}; } catch{return{ok:false,error:he?"אין הרשאה.":"Not allowed."};}
}

