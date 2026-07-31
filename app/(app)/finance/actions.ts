"use server";

import { revalidatePath } from "next/cache";
import { assertCapability, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested in tests/money.test.mjs)
import { parseAmountToMinor, parsePercentToBps } from "@/lib/core/money.mjs";

export type FinanceResult = { ok: boolean; error?: string };
const initialError = (he: boolean) => he ? "לא הצלחנו לשמור. בדקו את הפרטים ונסו שוב." : "We couldn't save this. Check the details and try again.";
const amountError = (he: boolean) => he ? "סכום לא תקין. הזינו מספר, למשל 1234.56" : "That amount isn't valid. Enter a number, for example 1234.56";
const forbiddenError = (he: boolean) => he ? "אין לך הרשאה לנהל כספים." : "You don't have access to manage finance.";
const rateError = (he: boolean) => he ? "שיעור מס לא תקין. הזינו אחוז, למשל 8.25" : "That tax rate isn't valid. Enter a percentage, for example 8.25";
const dateOrderError = (he: boolean) => he ? "תאריך הסיום מוקדם מתאריך ההתחלה." : "The end date is before the start date.";
const migrationError = (he: boolean) => he
  ? "לא ניתן לשמור. ודאו שההגירה db/035_custom_fields_tax.sql הורצה."
  : "Couldn't save. Check that migration db/035_custom_fields_tax.sql has been run.";

/** Thrown for a malformed money field so it is not reported as a permission problem. */
class AmountError extends Error {}

/**
 * Parse a money field to integer minor units.
 *
 * This used to be `Math.round(Number(value) * 100)`, the one money entry point
 * in the app that bypassed the tested integer engine. Two defects:
 *   - float rounding (Math.round(1.005 * 100) is 100, not 101);
 *   - non-numeric input became NaN and was silently serialised as null, so a
 *     typo saved a settlement row with a missing figure and no warning.
 * Every other entry point already used parseAmountToMinor.
 */
const minor = (value: FormDataEntryValue | null): number => {
  try {
    return parseAmountToMinor(String(value ?? "0"));
  } catch {
    throw new AmountError(String(value ?? ""));
  }
};

/** Map a thrown error to the right message: bad input is not a permission failure. */
const failure = (error: unknown, he: boolean): FinanceResult =>
  error instanceof AmountError
    ? { ok: false, error: amountError(he) }
    : { ok: false, error: forbiddenError(he) };

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
    if (!name) return { ok: false, error: initialError(he) };
    // A rate is not money, but it multiplies money. `Math.round(rate * 100)` had
    // the same float trap the money path was cleaned of (8.365% became 8.36%),
    // and a non-numeric entry became NaN and was written as null.
    let rate_bps: number;
    try {
      rate_bps = parsePercentToBps(String(formData.get("rate") ?? "0"));
    } catch {
      return { ok: false, error: rateError(he) };
    }

    const effectiveFrom = String(formData.get("effectiveFrom") ?? "").trim() || new Date().toISOString().slice(0, 10);
    const effectiveTo = String(formData.get("effectiveTo") ?? "").trim() || null;
    if (effectiveTo && effectiveTo < effectiveFrom) return { ok: false, error: dateOrderError(he) };

    const supabase = await createClient();
    const { error } = await supabase.from("tax_jurisdictions").insert({
      organization_id: profile.organization_id, name, code: String(formData.get("code") ?? "").trim() || null,
      jurisdiction_type: String(formData.get("type") ?? "state"), applies_to: String(formData.get("appliesTo") ?? "all"),
      rate_bps, effective_from: effectiveFrom, effective_to: effectiveTo,
      notes: String(formData.get("notes") ?? "").trim() || null, created_by: profile.id,
    });
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch (e) { return failure(e, he); }
}

/**
 * Turn jurisdictional tax on or off for the business (ledger 5.16).
 *
 * OFF ('flat') is the default and is exactly what every document did before this
 * existed: the single `organizations.tax_rate_bps`. Switching this changes the
 * tax on documents created from now on, which is why it is a deliberate choice
 * and not something the deploy did on the owner's behalf.
 */
export async function setTaxMode(_previous: FinanceResult, formData: FormData): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  const mode = String(formData.get("mode") ?? "");
  if (!["flat", "jurisdictions"].includes(mode)) return { ok: false, error: initialError(he) };
  try {
    const profile = await guardFinance();
    const supabase = await createClient();
    const { error } = await supabase.from("organizations").update({ tax_mode: mode }).eq("id", profile.organization_id!);
    if (error) return { ok: false, error: migrationError(he) };
    revalidatePath("/finance"); revalidatePath("/settings"); return { ok: true };
  } catch (e) { return failure(e, he); }
}

/** Retire (or restore) a tax rule. There was no way to stop charging a rate that ended. */
export async function setTaxJurisdictionActive(id: string, active: boolean): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guardFinance();
    const supabase = await createClient();
    const { error } = await supabase.from("tax_jurisdictions").update({ active })
      .eq("id", id).eq("organization_id", profile.organization_id!);
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch (e) { return failure(e, he); }
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
  } catch (e) { return failure(e, he); }
}

export async function createSettlement(_previous: FinanceResult, formData: FormData): Promise<FinanceResult> {
  const locale = await getLocale(), he = locale === "he";
  try {
    const profile = await guardFinance();
    const gross = minor(formData.get("gross")), fees = minor(formData.get("fees")), refunds = minor(formData.get("refunds"));
    const chargebacks = minor(formData.get("chargebacks")), adjustments = minor(formData.get("adjustments"));
    const netValue = formData.get("net");
    const derivedNet = gross - fees - refunds - chargebacks + adjustments;
    const net = String(netValue ?? "").trim() ? minor(netValue) : derivedNet;

    // The reconciliation ledger previously accepted any arithmetic typed into it:
    // negative gross, fees exceeding gross, and a hand-entered net that
    // contradicted its own components — used verbatim, never checked.
    if (gross < 0 || fees < 0 || refunds < 0 || chargebacks < 0) {
      return { ok: false, error: he ? "סכומים לא יכולים להיות שליליים." : "Gross, fees, refunds and chargebacks cannot be negative." };
    }
    if (net !== derivedNet) {
      const money = (m: number) => (m / 100).toFixed(2);
      return {
        ok: false,
        error: he
          ? `הנטו שהוזן (${money(net)}) לא תואם את החישוב (${money(derivedNet)}).`
          : `The net you entered (${money(net)}) doesn't match its components (${money(derivedNet)}). Fix one or leave net blank to calculate it.`,
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("settlement_batches").insert({ organization_id: profile.organization_id,
      provider: String(formData.get("provider") ?? "manual").trim() || "manual", provider_settlement_id: String(formData.get("providerId") ?? "").trim() || null,
      settlement_date: String(formData.get("settlementDate") ?? new Date().toISOString().slice(0,10)), expected_arrival: String(formData.get("arrival") ?? "") || null,
      gross_minor: gross, fees_minor: fees, refunds_minor: refunds, chargebacks_minor: chargebacks, adjustments_minor: adjustments,
      net_minor: net, status: String(formData.get("status") ?? "expected"), bank_reference: String(formData.get("bankReference") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null, created_by: profile.id });
    if (error) return { ok: false, error: initialError(he) };
    revalidatePath("/finance"); return { ok: true };
  } catch (e) { return failure(e, he); }
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
  } catch (e) { return failure(e, he); }
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

