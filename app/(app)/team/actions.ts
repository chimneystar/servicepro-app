"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, assertRole, type Role } from "@/lib/auth";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import { appUrl, providers, sendEmail } from "@/lib/providers";
import { getRequestContext } from "@/lib/request-context";
// @ts-ignore -- pure logic, proven both ways in tests/invitations.test.mjs
import { invitationAcceptUrl, invitationEmail } from "@/lib/core/invitations.mjs";
// @ts-ignore -- integer-safe money math
import { parseAmountToMinor } from "@/lib/core/money.mjs";
// @ts-ignore -- pure logic, proven both ways in tests/skills.test.mjs
import { normalizeSkillCode } from "@/lib/core/skills.mjs";

/**
 * Attach the request context to the permission changes this call just caused.
 *
 * THE DEFECT (ledger 6b.3): this file contained no audit call of any kind.
 * Granting `can_refund_payments`, handing someone owner rights, or quietly
 * changing a technician's commission left no trace anywhere in the product.
 *
 * The RECORD itself is written by a database trigger (migration 038 §3), not
 * from here — deliberately. The threat model on this branch is an attacker who
 * skips the server actions and talks to PostgREST directly, and a log written
 * in application code would only ever see the polite door. What the trigger
 * cannot see is an HTTP header, so this stamps the IP and user agent onto the
 * rows it just produced. `stamp_permission_change_context` only ever touches
 * rows whose actor is the caller, so it adds provenance without adding a way
 * to forge any.
 */
async function stampPermissionContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  subjectId: string | null,
  since: string,
) {
  try {
    const context = await getRequestContext();
    await supabase.rpc("stamp_permission_change_context", {
      p_subject: subjectId,
      p_since: since,
      p_ip: context.ip,
      p_user_agent: context.userAgent,
    });
  } catch {
    // The change is already on the record; only its provenance is missing.
  }
}

export type ActionResult = { ok: boolean; error?: string; notice?: string };
export type CapabilityValues = {
  viewCustomers: boolean;
  editCustomers: boolean;
  manageSchedule: boolean;
  editJobs: boolean;
  manageEstimates: boolean;
  manageInvoices: boolean;
  managePayments: boolean;
  viewReports: boolean;
  managePurchasing: boolean;
  manageAutomations: boolean;
  manageSettings: boolean;
  manageTeam: boolean;
};

function guardOwner() {
  return requireProfile().then((p) => {
    assertRole(p, ["owner"]);
    return p;
  });
}
const saveError = (locale: "en" | "he") =>
  locale === "he"
    ? "לא הצלחנו לשמור את השינוי. נסו שוב בעוד רגע."
    : "We couldn't save the change. Please try again.";
const memberError = (locale: "en" | "he", message?: string) =>
  message?.includes("last_owner_required")
    ? locale === "he"
      ? "אי אפשר להסיר או לשנות את התפקיד של הבעלים האחרון. קודם הוסיפו בעלים נוסף."
      : "The last owner cannot be removed or changed. Add another owner first."
    : saveError(locale);

/**
 * Actually deliver an invitation, and record whether it was delivered.
 *
 * THE DEFECT THIS FIXES: `inviteMember` generated a token, wrote the row, and
 * SENT NOTHING. There was no `sendEmail` anywhere in the team flow — the screen
 * simply told the owner to go and tell the person themselves, while the token
 * it had generated protected nothing because acceptance matched on email alone.
 *
 * When no email provider is connected the invitation is still created, but the
 * row is marked `unavailable` and the owner is told in plain words that nobody
 * has been emailed. A silent "invitation sent" is the thing being repaired.
 */
async function deliverInvitation(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  inviteId: string;
  organizationId: string;
  email: string;
  role: string;
  token: string;
  inviterName: string;
  locale: "en" | "he";
}): Promise<{ delivered: boolean; notice: string }> {
  const { supabase, locale } = input;
  const he = locale === "he";
  // Origin is derived server-side from configuration, never from a request
  // header — same rule the document-sending path had to be fixed to follow.
  const acceptUrl = invitationAcceptUrl(appUrl(), input.token) as string | null;

  const markFailure = async (status: "unavailable" | "failed", reason: string, notice: string) => {
    await supabase
      .from("invitations")
      .update({ delivery_status: status, delivery_error: reason.slice(0, 500) })
      .eq("id", input.inviteId);
    return { delivered: false, notice };
  };

  if (!acceptUrl) {
    return markFailure(
      "unavailable",
      "NEXT_PUBLIC_APP_URL is not configured, so no invitation link could be built",
      he
        ? "ההזמנה נשמרה אך לא נשלחה: כתובת האפליקציה (NEXT_PUBLIC_APP_URL) אינה מוגדרת."
        : "Invitation saved but NOT emailed: the app URL (NEXT_PUBLIC_APP_URL) is not configured.",
    );
  }
  if (!providers.email()) {
    return markFailure(
      "unavailable",
      "no email provider is connected (RESEND_API_KEY / EMAIL_FROM)",
      he
        ? `ההזמנה נשמרה אך לא נשלחה: שירות המייל אינו מחובר. שלחו את הקישור בעצמכם: ${acceptUrl}`
        : `Invitation saved but NOT emailed: no email provider is connected. Send this link yourself: ${acceptUrl}`,
    );
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", input.organizationId)
    .maybeSingle();
  const { subject, html } = invitationEmail({
    locale,
    businessName: organization?.name ?? "",
    inviterName: input.inviterName,
    role: input.role,
    acceptUrl,
  }) as { subject: string; html: string };

  try {
    const messageId = await sendEmail(input.email, subject, html);
    await supabase
      .from("invitations")
      .update({ delivery_status: "sent", delivery_error: null, sent_at: new Date().toISOString() })
      .eq("id", input.inviteId);
    await supabase.from("email_messages").insert({
      organization_id: input.organizationId,
      related_type: "invitation",
      related_id: input.inviteId,
      to_email: input.email,
      subject,
      provider: "resend",
      provider_message_id: messageId,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    return { delivered: true, notice: "" };
  } catch (cause: any) {
    const reason = String(cause?.message ?? cause);
    await supabase.from("email_messages").insert({
      organization_id: input.organizationId,
      related_type: "invitation",
      related_id: input.inviteId,
      to_email: input.email,
      subject,
      provider: "resend",
      status: "failed",
      error: reason.slice(0, 500),
    });
    return markFailure(
      "failed",
      reason,
      he
        ? `ההזמנה נשמרה אך שליחת המייל נכשלה. שלחו את הקישור בעצמכם: ${acceptUrl}`
        : `Invitation saved but the email failed to send. Send this link yourself: ${acceptUrl}`,
    );
  }
}

/** Owner invites a teammate by email + role. They join through the emailed link. */
export async function inviteMember(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try {
    profile = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "tech") as Role;
  if (!email || !email.includes("@")) return { ok: false, error: t(locale, "err.email_invalid") };
  if (!["owner", "office", "tech"].includes(role))
    return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const token = randomUUID();
  const since = new Date(Date.now() - 5_000).toISOString();
  const { data: invite, error } = await supabase
    .from("invitations")
    .insert({
      organization_id: profile.organization_id,
      email,
      role,
      token,
      invited_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !invite) return { ok: false, error: memberError(locale, error?.message) };

  const delivery = await deliverInvitation({
    supabase,
    inviteId: invite.id,
    organizationId: profile.organization_id!,
    email,
    role,
    token,
    inviterName: profile.full_name,
    locale,
  });
  // An invitation is a permission grant in waiting — especially an owner one.
  await stampPermissionContext(supabase, null, since);
  revalidatePath("/team");
  return delivery.delivered ? { ok: true } : { ok: true, notice: delivery.notice };
}

/**
 * Send the invitation again — the only way to reach anyone invited before
 * delivery existed, and the fix for a bounced or lost email. The token is
 * unchanged (it is what the link carries) and the 7-day window restarts.
 */
export async function resendInvite(id: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try {
    profile = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = await createClient();
  const { data: invite } = await supabase
    .from("invitations")
    .select("id, email, role, token, organization_id, accepted_at")
    .eq("id", id)
    .maybeSingle();
  if (!invite || invite.accepted_at || invite.organization_id !== profile.organization_id)
    return { ok: false, error: t(locale, "err.invalid") };

  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  const { error } = await supabase.from("invitations").update({ expires_at: expires }).eq("id", id);
  if (error) return { ok: false, error: saveError(locale) };

  const delivery = await deliverInvitation({
    supabase,
    inviteId: invite.id,
    organizationId: invite.organization_id,
    email: invite.email,
    role: String(invite.role),
    token: invite.token,
    inviterName: profile.full_name,
    locale,
  });
  revalidatePath("/team");
  return delivery.delivered ? { ok: true } : { ok: true, notice: delivery.notice };
}

export async function changeRole(memberId: string, role: string): Promise<ActionResult> {
  const locale = await getLocale();
  let currentOwner;
  try {
    currentOwner = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  if (!["owner", "office", "tech"].includes(role))
    return { ok: false, error: t(locale, "err.invalid") };
  const supabase = await createClient();
  const since = new Date(Date.now() - 5_000).toISOString();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", memberId);
  if (error) return { ok: false, error: memberError(locale, error.message) };
  const office = role === "office";
  const owner = role === "owner";
  await supabase.from("profile_capabilities").upsert(
    {
      profile_id: memberId,
      organization_id: currentOwner.organization_id,
      can_view_customers: true,
      can_edit_customers: office || owner,
      can_manage_schedule: office || owner,
      can_edit_jobs: true,
      can_manage_estimates: office || owner,
      can_manage_invoices: office || owner,
      can_manage_payments: office || owner,
      can_view_reports: office || owner,
      can_manage_purchasing: office || owner,
      can_manage_automations: office || owner,
      can_manage_settings: owner,
      can_manage_team: owner,
    },
    { onConflict: "profile_id" },
  );
  if (role !== "office")
    await supabase.from("profile_payment_permissions").delete().eq("profile_id", memberId);
  await stampPermissionContext(supabase, memberId, since);
  revalidatePath("/team");
  return { ok: true };
}

export async function updateCapabilities(
  memberId: string,
  values: CapabilityValues,
): Promise<ActionResult> {
  const locale = await getLocale();
  let owner;
  try {
    owner = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  if (!memberId || memberId === owner.id) return { ok: false, error: t(locale, "err.invalid") };
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("profiles")
    .select("id, role, organization_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!member || member.organization_id !== owner.organization_id || member.role === "owner")
    return { ok: false, error: t(locale, "err.invalid") };
  const since = new Date(Date.now() - 5_000).toISOString();
  const { error } = await supabase.from("profile_capabilities").upsert(
    {
      profile_id: memberId,
      organization_id: owner.organization_id,
      can_view_customers: !!values.viewCustomers,
      can_edit_customers: !!values.editCustomers,
      can_manage_schedule: !!values.manageSchedule,
      can_edit_jobs: !!values.editJobs,
      can_manage_estimates: !!values.manageEstimates,
      can_manage_invoices: !!values.manageInvoices,
      can_manage_payments: !!values.managePayments,
      can_view_reports: !!values.viewReports,
      can_manage_purchasing: !!values.managePurchasing,
      can_manage_automations: !!values.manageAutomations,
      can_manage_settings: !!values.manageSettings,
      can_manage_team: !!values.manageTeam,
      updated_by: owner.id,
    },
    { onConflict: "profile_id" },
  );
  if (error)
    return {
      ok: false,
      error:
        locale === "he"
          ? "לא הצלחנו לשמור את הרשאות העובד."
          : "We couldn't save this team member's access.",
    };
  await stampPermissionContext(supabase, memberId, since);
  revalidatePath("/team");
  return { ok: true };
}

export async function updatePaymentPermissions(
  memberId: string,
  permissions: { confirmManual: boolean; refund: boolean; overrideAchHold: boolean },
): Promise<ActionResult> {
  const locale = await getLocale();
  let owner;
  try {
    owner = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  if (!memberId || memberId === owner.id) return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", memberId)
    .maybeSingle();
  if (!member || member.role !== "office") return { ok: false, error: t(locale, "err.invalid") };

  const since = new Date(Date.now() - 5_000).toISOString();
  const { error } = await supabase.from("profile_payment_permissions").upsert(
    {
      profile_id: memberId,
      organization_id: owner.organization_id,
      can_confirm_manual_payments: !!permissions.confirmManual,
      can_refund_payments: !!permissions.refund,
      can_override_ach_holds: !!permissions.overrideAchHold,
      updated_by: owner.id,
    },
    { onConflict: "profile_id" },
  );
  if (error)
    return {
      ok: false,
      error:
        locale === "he"
          ? "לא הצלחנו לשמור את הרשאות התשלום."
          : "We couldn't save the payment permissions.",
    };
  await stampPermissionContext(supabase, memberId, since);
  revalidatePath("/team");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 6c.2 — the wage rate.
//
// WHERE IT LIVES AND WHO CAN SEE IT. `technician_pay_rates`, not `profiles`.
// Every member of the organisation can read `profiles` — dispatch, the schedule
// and the job page need names and colours — so a rate column there would hand
// the whole payroll to every technician through PostgREST whatever the screen
// showed. The table's RLS is OWNER ONLY: office staff cannot read it either,
// and reach the derived per-job figure through `job_labour_cost()`, which
// returns money for one job and never a person's rate.
//
// Rates are effective-dated, so a rise in June does not retroactively re-cost
// March's finished jobs. Setting a rate INSERTS a new dated row; it does not
// overwrite history.
// ---------------------------------------------------------------------
export async function setPayRate(
  memberId: string,
  amount: string,
  effectiveFrom: string,
): Promise<ActionResult> {
  const locale = await getLocale();
  let owner;
  try {
    owner = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const from = /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
    ? effectiveFrom
    : new Date().toISOString().slice(0, 10);

  let cost_rate_minor = 0;
  try {
    cost_rate_minor = parseAmountToMinor(amount);
  } catch {
    return { ok: false, error: t(locale, "err.invalid") };
  }
  if (cost_rate_minor < 0) return { ok: false, error: t(locale, "err.invalid") };

  const supabase = await createClient();
  const { data: member } = await supabase
    .from("profiles")
    .select("id, organization_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!member || member.organization_id !== owner.organization_id)
    return { ok: false, error: t(locale, "err.invalid") };

  const { error } = await supabase.from("technician_pay_rates").upsert(
    {
      organization_id: owner.organization_id,
      profile_id: memberId,
      cost_rate_minor,
      effective_from: from,
      created_by: owner.id,
    },
    { onConflict: "profile_id,effective_from" },
  );
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 6c.11 — certifications.
// ---------------------------------------------------------------------
export async function addSkill(
  memberId: string,
  values: {
    skill: string;
    label?: string;
    certificationNumber?: string;
    issuedOn?: string;
    expiresOn?: string;
  },
): Promise<ActionResult> {
  const locale = await getLocale();
  let owner;
  try {
    owner = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }

  // The code is folded to [a-z0-9_] here AND constrained in the database, so
  // "Gas Safe" and "gas_safe" cannot become two unmatchable certifications.
  const skill_code = normalizeSkillCode(values.skill) as string | null;
  if (!skill_code)
    return {
      ok: false,
      error:
        locale === "he"
          ? "קוד הסמכה לא תקין."
          : "That certification name is not usable — use 2–40 letters, digits or underscores.",
    };

  const day = (value?: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value! : null);
  const supabase = await createClient();
  const { error } = await supabase.from("technician_skills").upsert(
    {
      organization_id: owner.organization_id,
      profile_id: memberId,
      skill_code,
      label: (values.label ?? "").trim().slice(0, 80) || null,
      certification_number: (values.certificationNumber ?? "").trim().slice(0, 80) || null,
      issued_on: day(values.issuedOn),
      expires_on: day(values.expiresOn),
      created_by: owner.id,
    },
    { onConflict: "organization_id,profile_id,skill_code" },
  );
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  revalidatePath("/dispatch");
  return { ok: true };
}

export async function removeSkill(id: string): Promise<ActionResult> {
  const locale = await getLocale();
  try {
    await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("technician_skills").delete().eq("id", id);
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  revalidatePath("/dispatch");
  return { ok: true };
}

// ---------------------------------------------------------------------
// 6c.3 — time off and non-working days.
//
// `memberId` empty means the WHOLE BUSINESS is closed (the public-holiday
// case), which is why the column is nullable rather than a second table:
// closure and absence are the same question asked of the calendar.
//
// This NEVER touches jobs or job_assignments, so it cannot become a route
// around `jobs_no_double_book`. It removes availability; the exclusion
// constraint still refuses overlaps whatever is recorded here.
// ---------------------------------------------------------------------
export async function addTimeOff(values: {
  memberId?: string | null;
  startsOn: string;
  endsOn?: string;
  startTime?: string;
  endTime?: string;
  kind?: string;
  note?: string;
}): Promise<ActionResult> {
  const locale = await getLocale();
  let owner;
  try {
    owner = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }

  const day = (value?: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value! : null);
  const starts_on = day(values.startsOn);
  const ends_on = day(values.endsOn) ?? starts_on;
  if (!starts_on || !ends_on || ends_on < starts_on) {
    return {
      ok: false,
      error: locale === "he" ? "טווח התאריכים אינו תקין." : "That date range is not valid.",
    };
  }
  const time = (value?: string) => (/^\d{2}:\d{2}$/.test(value ?? "") ? `${value}:00` : null);
  const start_time = time(values.startTime);
  const end_time = time(values.endTime);
  if (
    (start_time === null) !== (end_time === null) ||
    (start_time && end_time && end_time <= start_time)
  ) {
    return {
      ok: false,
      error:
        locale === "he"
          ? "שעות החופשה אינן תקינות."
          : "Enter both a start and an end time, or neither.",
    };
  }
  const kinds = ["time_off", "vacation", "sick", "personal", "training", "holiday", "other"];
  const kind = kinds.includes(values.kind ?? "") ? values.kind! : "time_off";

  const supabase = await createClient();
  if (values.memberId) {
    const { data: member } = await supabase
      .from("profiles")
      .select("id, organization_id")
      .eq("id", values.memberId)
      .maybeSingle();
    if (!member || member.organization_id !== owner.organization_id)
      return { ok: false, error: t(locale, "err.invalid") };
  }
  const { error } = await supabase.from("technician_time_off").insert({
    organization_id: owner.organization_id,
    profile_id: values.memberId || null,
    starts_on,
    ends_on,
    start_time,
    end_time,
    kind,
    status: "approved",
    note: (values.note ?? "").trim().slice(0, 300) || null,
    created_by: owner.id,
  });
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  revalidatePath("/dispatch");
  revalidatePath("/schedule");
  return { ok: true };
}

export async function removeTimeOff(id: string): Promise<ActionResult> {
  const locale = await getLocale();
  try {
    await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("technician_time_off").delete().eq("id", id);
  if (error) return { ok: false, error: saveError(locale) };
  revalidatePath("/team");
  revalidatePath("/dispatch");
  revalidatePath("/schedule");
  return { ok: true };
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  const locale = await getLocale();
  let profile;
  try {
    profile = await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  if (memberId === profile.id) return { ok: false, error: t(locale, "err.invalid") };
  const supabase = await createClient();
  const since = new Date(Date.now() - 5_000).toISOString();
  const { error } = await supabase.from("profiles").delete().eq("id", memberId);
  if (error) return { ok: false, error: memberError(locale, error.message) };
  await stampPermissionContext(supabase, memberId, since);
  revalidatePath("/team");
  return { ok: true };
}

export async function cancelInvite(id: string): Promise<ActionResult> {
  const locale = await getLocale();
  try {
    await guardOwner();
  } catch {
    return { ok: false, error: t(locale, "err.forbidden") };
  }
  const supabase = await createClient();
  const since = new Date(Date.now() - 5_000).toISOString();
  const { error } = await supabase.from("invitations").delete().eq("id", id);
  if (error) return { ok: false, error: saveError(locale) };
  await stampPermissionContext(supabase, null, since);
  revalidatePath("/team");
  return { ok: true };
}
