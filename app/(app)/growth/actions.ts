"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
// @ts-ignore — integer-safe money engine (JS module, unit-tested)
import { parseAmountToMinor } from "@/lib/core/money.mjs";

async function context() { const profile = await requireProfile(); assertRole(profile, ["owner", "office"]); return { profile, supabase: await createClient() }; }
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();

export async function createCampaign(data: FormData) {
  const { profile, supabase } = await context(); const name = value(data, "name"); const body = value(data, "body"); if (!name || !body) return;
  await supabase.from("campaigns").insert({ organization_id: profile.organization_id, name, channel: value(data, "channel") || "email", subject: value(data, "subject") || null, body, audience_json: { segment: value(data, "segment") || "all_customers" }, created_by: profile.id });
  revalidatePath("/growth");
}

export async function createReferralProgram(data: FormData) {
  const { profile, supabase } = await context(); const name = value(data, "name"); const rewardText = value(data, "rewardText"); if (!name || !rewardText) return;
  await supabase.from("referral_programs").insert({ organization_id: profile.organization_id, name, reward_text: rewardText }); revalidatePath("/growth");
}

export async function recordAdSpend(data: FormData) {
  const { profile, supabase } = await context(); const source = value(data, "source"); if (!source) return;
  // Integer money, not float: Math.round(Number(x) * 100) mis-rounds and yields
  // NaN on a typo, which was then silently stored as null.
  let spendMinor: number;
  try { spendMinor = Math.max(0, parseAmountToMinor(String(data.get("spend") ?? "0"))); } catch { return; }
  await supabase.from("lead_attribution_costs").insert({ organization_id: profile.organization_id, source, campaign: value(data, "campaign") || null, period_start: value(data, "periodStart"), period_end: value(data, "periodEnd"), spend_minor: spendMinor }); revalidatePath("/growth");
}

export async function scheduleEstimateFollowup(data: FormData) {
  const { profile, supabase } = await context(); const estimateId = value(data, "estimateId"); const scheduledAt = value(data, "scheduledAt"); if (!estimateId || !scheduledAt) return;
  await supabase.from("estimate_followups").insert({ organization_id: profile.organization_id, estimate_id: estimateId, channel: value(data, "channel") || "email", scheduled_at: new Date(scheduledAt).toISOString() }); revalidatePath("/growth");
}
