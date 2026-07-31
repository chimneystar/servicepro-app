"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested)
import { parseAmountToMinor } from "@/lib/core/money.mjs";

// `{ ok, error }`, same contract as app/(app)/customers/actions.ts. These four
// used to return `void`: a rejected insert cleared the form and revalidated the
// page, so a campaign or a recorded ad spend just failed to appear with no
// explanation anywhere on screen.
export type ActionResult = { ok: boolean; error?: string };

const invalid = (he: boolean) => (he ? "חסר מידע או שאחד הפרטים לא תקין." : "Some information is missing or invalid.");
const saveFailed = (he: boolean) => (he ? "לא הצלחנו לשמור. אפשר לנסות שוב." : "We couldn't save that. Please try again.");
const forbidden = (he: boolean) => (he ? "אין לכם הרשאה לבצע את הפעולה הזאת." : "You don't have permission to do that.");

type Context = { profile: Awaited<ReturnType<typeof requireProfile>>; supabase: Awaited<ReturnType<typeof createClient>> };

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
  const name = value(data, "name"); const body = value(data, "body");
  if (!name || !body) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("campaigns").insert({ organization_id: ctx.profile.organization_id, name, channel: value(data, "channel") || "email", subject: value(data, "subject") || null, body, audience_json: { segment: value(data, "segment") || "all_customers" }, created_by: ctx.profile.id });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}

export async function createReferralProgram(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const name = value(data, "name"); const rewardText = value(data, "rewardText");
  if (!name || !rewardText) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("referral_programs").insert({ organization_id: ctx.profile.organization_id, name, reward_text: rewardText });
  if (dbError) return { ok: false, error: saveFailed(he) };
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
  try { spendMinor = Math.max(0, parseAmountToMinor(String(data.get("spend") ?? "0"))); } catch { return { ok: false, error: invalid(he) }; }
  const { error: dbError } = await ctx.supabase.from("lead_attribution_costs").insert({ organization_id: ctx.profile.organization_id, source, campaign: value(data, "campaign") || null, period_start: value(data, "periodStart"), period_end: value(data, "periodEnd"), spend_minor: spendMinor });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}

export async function scheduleEstimateFollowup(_prev: ActionResult, data: FormData): Promise<ActionResult> {
  const { he, ctx, error } = await guard();
  if (!ctx) return { ok: false, error };
  const estimateId = value(data, "estimateId"); const scheduledAt = value(data, "scheduledAt");
  if (!estimateId || !scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) return { ok: false, error: invalid(he) };
  const { error: dbError } = await ctx.supabase.from("estimate_followups").insert({ organization_id: ctx.profile.organization_id, estimate_id: estimateId, channel: value(data, "channel") || "email", scheduled_at: new Date(scheduledAt).toISOString() });
  if (dbError) return { ok: false, error: saveFailed(he) };
  revalidatePath("/growth");
  return { ok: true };
}
