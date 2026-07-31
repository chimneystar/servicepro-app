"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested)
import { parseAmountToMinor } from "@/lib/core/money.mjs";
// @ts-ignore — consent + audience rules, proven both ways in tests/outreach.test.mjs
import { campaignChannels, contactEligibility, isKnownSegment } from "@/lib/core/outreach.mjs";
// @ts-ignore — escaping for values placed into an email body
import { escapeHtml } from "@/lib/core/security.mjs";
import { providers, sendEmail, sendSms } from "@/lib/providers";

// `{ ok, error }`, same contract as app/(app)/customers/actions.ts. These four
// used to return `void`: a rejected insert cleared the form and revalidated the
// page, so a campaign or a recorded ad spend just failed to appear with no
// explanation anywhere on screen.
export type ActionResult = { ok: boolean; error?: string };

const invalid = (he: boolean) =>
  he ? "חסר מידע או שאחד הפרטים לא תקין." : "Some information is missing or invalid.";
const saveFailed = (he: boolean) =>
  he ? "לא הצלחנו לשמור. אפשר לנסות שוב." : "We couldn't save that. Please try again.";
const forbidden = (he: boolean) =>
  he ? "אין לכם הרשאה לבצע את הפעולה הזאת." : "You don't have permission to do that.";

type Context = {
  profile: Awaited<ReturnType<typeof requireProfile>>;
  supabase: Awaited<ReturnType<typeof createClient>>;
};

async function guard(): Promise<{ he: boolean; ctx?: Context; error?: string }> {
  const he = (await getLocale()) === "he";
  try {
    const profile = await requireProfile();
    assertRole(profile, ["owner", "office"]);
    return { he, ctx: { profile, supabase: await createClient() } };
  } catch {
    return { he, error: forbidden(he) };
  }
}

const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export async function createCampaign(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = value(data, "name");
  const body = value(data, "body");
  if (!name || !body) return { ok: false, error: invalid(he) };
  // Only a channel and a segment the sender can actually build a list for.
  // Storing an unknown segment produced a campaign that would either never be
  // sent or, worse, be interpreted later as "everyone".
  const channel = value(data, "channel") || "email";
  const segment = value(data, "segment") || "all_customers";
  if (!campaignChannels(channel).length || !isKnownSegment(segment))
    return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("campaigns").insert({
    organization_id: ctx.profile.organization_id,
    name,
    channel,
    subject: value(data, "subject") || null,
    body,
    audience_json: { segment },
    created_by: ctx.profile.id,
  });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}

/**
 * Hand a draft campaign to the sender (ledger 5.9).
 *
 * Until this existed, `createCampaign` was the only writer of the table and it
 * only ever produced `status = 'draft'` — so even a working sender would have
 * had nothing to send. Scheduling is the missing half of the loop: the nightly
 * cron picks up 'scheduled' campaigns whose time has come, contacts every
 * opted-in recipient exactly once, and moves the row to 'sent'.
 */
export async function scheduleCampaign(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const id = value(data, "id");
  if (!id) return { ok: false, error: invalid(he) };
  const when = value(data, "sendAt");
  if (when && Number.isNaN(new Date(when).getTime())) return { ok: false, error: invalid(he) };
  const scheduledAt = when ? new Date(when).toISOString() : new Date().toISOString();
  // Only a draft or a paused campaign may be scheduled: re-scheduling one that
  // is 'sending' or 'sent' is how a customer gets the same blast twice.
  const { data: updated, error: dbError } = await ctx.supabase
    .from("campaigns")
    .update({ status: "scheduled", scheduled_at: scheduledAt })
    .eq("id", id)
    .eq("organization_id", ctx.profile.organization_id)
    .in("status", ["draft", "paused"])
    .select("id")
    .maybeSingle();
  if (dbError) return { ok: false, error: saveFailed(he) };
  if (!updated)
    return {
      ok: false,
      error: he
        ? "אפשר לתזמן רק קמפיין בטיוטה או מושהה."
        : "Only a draft or paused campaign can be scheduled.",
    };
  revalidatePath("/growth");
  return { ok: true };
}

/** Stop a scheduled campaign before the cron reaches it. */
export async function pauseCampaign(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const id = value(data, "id");
  if (!id) return { ok: false, error: invalid(he) };
  const { data: updated, error: dbError } = await ctx.supabase
    .from("campaigns")
    .update({ status: "paused" })
    .eq("id", id)
    .eq("organization_id", ctx.profile.organization_id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (dbError) return { ok: false, error: saveFailed(he) };
  if (!updated)
    return {
      ok: false,
      error: he ? "אפשר להשהות רק קמפיין מתוזמן." : "Only a scheduled campaign can be paused.",
    };
  revalidatePath("/growth");
  return { ok: true };
}

export async function createReferralProgram(
  _prev: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = value(data, "name");
  const rewardText = value(data, "rewardText");
  if (!name || !rewardText) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase
    .from("referral_programs")
    .insert({ organization_id: ctx.profile.organization_id, name, reward_text: rewardText });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}

/**
 * Issue one referral code to one customer and actually send it (ledger 5.9).
 *
 * `referral_programs` was a leaflet nobody handed out: the table stored a
 * reward, the screen listed it, and NOTHING in the product ever created a
 * `referrals` row — so no customer ever received a code and no referral could
 * ever be attributed. This is the missing issuance step.
 *
 * Consent is enforced by the same pure rule the cron uses: a customer who
 * replied STOP, or who never had a usable phone/email, is refused with a named
 * reason rather than silently skipped. The referral record is written FIRST and
 * then marked sent, so a provider failure leaves a visible undelivered code
 * instead of a code that may or may not have gone out.
 */
export async function issueReferral(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const programId = value(data, "programId");
  const customerId = value(data, "customerId");
  const channel = value(data, "channel") === "sms" ? "sms" : "email";
  if (!programId || !customerId) return { ok: false, error: invalid(he) };

  const [{ data: program }, { data: customer }] = await Promise.all([
    ctx.supabase
      .from("referral_programs")
      .select("id, name, reward_text, active")
      .eq("id", programId)
      .maybeSingle(),
    ctx.supabase
      .from("customers")
      .select("id, name, phone, email, sms_opt_in, email_opt_in, deleted_at")
      .eq("id", customerId)
      .maybeSingle(),
  ]);
  if (!program?.active || !customer) return { ok: false, error: invalid(he) };

  const eligibility = contactEligibility(customer, channel);
  if (!eligibility.ok) {
    const optedOut = eligibility.reason === "sms_opt_out" || eligibility.reason === "email_opt_out";
    return {
      ok: false,
      error: optedOut
        ? he
          ? "הלקוח ביקש לא לקבל הודעות בערוץ הזה."
          : "This customer has opted out of that channel."
        : he
          ? "אין ללקוח פרטי קשר לערוץ הזה."
          : "This customer has no contact details for that channel.",
    };
  }
  if (channel === "sms" ? !providers.sms() : !providers.email()) {
    return {
      ok: false,
      error: he ? "הערוץ הזה לא מחובר עדיין." : "That channel isn't connected yet.",
    };
  }

  const code = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const { data: referral, error: insertError } = await ctx.supabase
    .from("referrals")
    .insert({
      organization_id: ctx.profile.organization_id,
      program_id: programId,
      referrer_customer_id: customerId,
      code,
      status: "shared",
      channel,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !referral) return { ok: false, error: saveFailed(he) };

  const { data: org } = await ctx.supabase
    .from("organizations")
    .select("name")
    .eq("id", ctx.profile.organization_id)
    .maybeSingle();
  const business = org?.name ?? "";
  const first = String(customer.name ?? "").split(" ")[0] ?? "";
  const body = `Hi ${first}, thanks for choosing ${business}! Share your referral code ${code} with a friend — ${program.reward_text}`;
  try {
    if (channel === "sms") {
      const sid = await sendSms(eligibility.to, body);
      const { error: logError } = await ctx.supabase.from("sms_messages").insert({
        organization_id: ctx.profile.organization_id,
        customer_id: customerId,
        to_phone: eligibility.to,
        body,
        provider: "twilio",
        provider_message_id: sid,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      if (logError) console.error("[growth] referral SMS sent but not logged:", logError.message);
    } else {
      const subject = `${business} — ${program.name}`;
      const id = await sendEmail(eligibility.to, subject, `<p>${escapeHtml(body)}</p>`);
      const { error: logError } = await ctx.supabase.from("email_messages").insert({
        organization_id: ctx.profile.organization_id,
        related_type: "referral",
        related_id: referral.id,
        to_email: eligibility.to,
        subject,
        provider: "resend",
        provider_message_id: id,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      if (logError) console.error("[growth] referral email sent but not logged:", logError.message);
    }
  } catch (e: unknown) {
    // Loud, not swallowed: the code stays on file, undelivered and labelled.
    const detail = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    const { error: markError } = await ctx.supabase
      .from("referrals")
      .update({ error_message: detail })
      .eq("id", referral.id);
    if (markError)
      console.error("[growth] referral send failed and could not be marked:", markError.message);
    revalidatePath("/growth");
    return {
      ok: false,
      error: he
        ? "לא הצלחנו לשלוח את הקוד. הקוד נשמר וניתן לנסות שוב."
        : "We couldn't send the code. It was saved, so you can try again.",
    };
  }
  const { error: sentError } = await ctx.supabase
    .from("referrals")
    .update({ sent_at: new Date().toISOString() })
    .eq("id", referral.id);
  if (sentError) console.error("[growth] referral sent but not marked:", sentError.message);
  revalidatePath("/growth");
  return { ok: true };
}

export async function recordAdSpend(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const source = value(data, "source");
  if (!source) return { ok: false, error: invalid(he) };
  // Integer money, not float: Math.round(Number(x) * 100) mis-rounds and yields
  // NaN on a typo, which was then silently stored as null.
  let spendMinor: number;
  try {
    spendMinor = Math.max(0, parseAmountToMinor(String(data.get("spend") ?? "0")));
  } catch {
    return { ok: false, error: invalid(he) };
  }
  const { error: dbError } = await ctx.supabase.from("lead_attribution_costs").insert({
    organization_id: ctx.profile.organization_id,
    source,
    campaign: value(data, "campaign") || null,
    period_start: value(data, "periodStart"),
    period_end: value(data, "periodEnd"),
    spend_minor: spendMinor,
  });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}

export async function scheduleEstimateFollowup(
  _prev: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const estimateId = value(data, "estimateId");
  const scheduledAt = value(data, "scheduledAt");
  if (!estimateId || !scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))
    return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("estimate_followups").insert({
    organization_id: ctx.profile.organization_id,
    estimate_id: estimateId,
    channel: value(data, "channel") || "email",
    scheduled_at: new Date(scheduledAt).toISOString(),
  });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}
