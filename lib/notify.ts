import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { providers, sendSms, sendEmail, appUrl } from "@/lib/providers";
import { pushDelivery, sendPushToProfile } from "@/lib/push";
// @ts-ignore -- shared JS module, proven both ways in tests/staff-notifications.test.mjs
import {
  deliveryPlan,
  notificationKey,
  notificationOutcome,
  paymentNotificationRecipients,
  staffEmailEligibility,
  staffNotification,
} from "@/lib/core/staff-notify.mjs";
// @ts-ignore -- shared JS module
import { escapeHtml } from "@/lib/core/security.mjs";

/** Fill {name} {service} {date} {time} {business} placeholders. */
export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Send the "technician on the way" text to the customer, IF an SMS provider
 * is connected and the template is enabled. Always safe to call — it silently
 * does nothing when SMS isn't configured yet. Every send is logged.
 *
 * `options` is ADDITIVE (remediation plan 6c.8): an existing caller that passes
 * nothing behaves exactly as before. When a tracking link is supplied it fills
 * a `{track}` placeholder if the business's template has one, and is otherwise
 * appended — the message was previously a dead end, which is what generated the
 * "where are they?" call it was meant to prevent.
 */
export async function notifyOnMyWay(
  jobId: string,
  options?: { trackUrl?: string | null; etaMinutes?: number | null },
): Promise<void> {
  if (!providers.sms()) return;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "service, scheduled_date, start_time, organization_id, customers!jobs_customer_id_fkey(name, phone)",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return;
  const cust: any = job.customers;
  if (!cust?.phone || cust.phone === "—") return;

  const [{ data: tpl }, { data: org }] = await Promise.all([
    supabase
      .from("message_templates")
      .select("enabled, body")
      .eq("trigger", "on_the_way")
      .maybeSingle(),
    supabase.from("organizations").select("name").eq("id", job.organization_id).single(),
  ]);
  if (!tpl || !tpl.enabled || !tpl.body) return;

  const trackUrl = options?.trackUrl ?? "";
  const eta = options?.etaMinutes ?? null;
  let body = fillTemplate(tpl.body, {
    name: (cust.name ?? "").split(" ")[0] ?? "",
    service: job.service ?? "",
    date: job.scheduled_date ?? "",
    time: (job.start_time ?? "").slice(0, 5),
    business: org?.name ?? "",
    track: trackUrl,
    eta: eta ? String(eta) : "",
  });
  // Appended only when the template did not already place it, so a business
  // that customised its wording is not given the link twice.
  if (trackUrl && !body.includes(trackUrl)) {
    body = `${body} ${eta ? `ETA ~${eta} min. ` : ""}Track: ${trackUrl}`.trim();
  }

  try {
    const sid = await sendSms(cust.phone, body);
    await supabase.from("sms_messages").insert({
      organization_id: job.organization_id,
      job_id: jobId,
      to_phone: cust.phone,
      body,
      provider: "twilio",
      provider_message_id: sid,
      status: "sent",
      sent_at: new Date().toISOString(),
    });
  } catch (e: any) {
    await supabase.from("sms_messages").insert({
      organization_id: job.organization_id,
      job_id: jobId,
      to_phone: cust.phone,
      body,
      provider: "twilio",
      status: "failed",
      error: String(e?.message ?? e).slice(0, 500),
    });
  }
}

/**
 * Ask a customer for a review after a completed job. Uses SMS if connected,
 * else email. Returns whether it actually sent (so a manual button can fall
 * back to the user's own phone/email app).
 */
export async function sendReviewRequest(jobId: string): Promise<{
  sent: boolean;
  reviewUrl: string | null;
  phone: string | null;
  email: string | null;
}> {
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("organization_id, customers!jobs_customer_id_fkey(name, phone, email)")
    .eq("id", jobId)
    .maybeSingle();
  const cust: any = job?.customers;
  const { data: org } = await supabase
    .from("organizations")
    .select("name, review_url")
    .eq("id", job?.organization_id)
    .single();
  const reviewUrl = org?.review_url ?? null;
  const phone = cust?.phone && cust.phone !== "—" ? cust.phone : null;
  const email = cust?.email ?? null;
  if (!job || !reviewUrl) return { sent: false, reviewUrl, phone, email };

  const first = (cust?.name ?? "").split(" ")[0] ?? "";
  const text = `Hi ${first}, thanks for choosing ${org?.name}! We'd really appreciate a quick review: ${reviewUrl}`;
  try {
    if (providers.sms() && phone) {
      const sid = await sendSms(phone, text);
      await supabase.from("sms_messages").insert({
        organization_id: job.organization_id,
        job_id: jobId,
        to_phone: phone,
        body: text,
        provider: "twilio",
        provider_message_id: sid,
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      return { sent: true, reviewUrl, phone, email };
    }
    if (providers.email() && email) {
      await sendEmail(
        email,
        `How did we do? — ${org?.name}`,
        `<p>Hi ${first},</p><p>Thanks for choosing ${org?.name}! We'd love a quick review:</p><p><a href="${reviewUrl}">Leave a review</a></p>`,
      );
      await supabase.from("email_messages").insert({
        organization_id: job.organization_id,
        related_type: "review",
        to_email: email,
        subject: "Review request",
        provider: "resend",
        status: "sent",
        sent_at: new Date().toISOString(),
      });
      return { sent: true, reviewUrl, phone, email };
    }
  } catch {
    /* fall through to manual */
  }
  return { sent: false, reviewUrl, phone, email };
}

// =====================================================================
//  STAFF NOTIFICATIONS (ledger 6c.5).
//
//  THE DEFECT: nothing told a technician they had been assigned a job, and
//  nothing at all told an owner that a payment had arrived. 5.13 built a push
//  SENDER, but push is one channel on one device: a technician who never
//  enabled notifications, or whose browser silently dropped the subscription,
//  learned nothing — and there was no record that they had not been told.
//
//  What is added here, and nothing more:
//    * an IN-APP INBOX (`staff_notifications`), which is also the CLAIM;
//    * the EXISTING push sender (`lib/push.ts`) as a second channel — no second
//      web-push implementation is built;
//    * an EMAIL FALLBACK, attempted only when push reached no device.
//
//  The three rules the reminder loops in lib/cron-tasks.ts already follow are
//  followed here: CLAIM before sending, RELEASE the claim on failure so it can
//  be retried, and RECORD the outcome including a deliberate skip and its
//  reason.
// =====================================================================

export type StaffNotifyResult = {
  ok: boolean;
  status: "sent" | "inbox_only" | "failed" | "duplicate";
  reached: string[];
  reason: string;
};

type StaffNotifyInput = {
  organizationId: string;
  profileId: string;
  type: "job_assigned" | "payment_received" | "job_unassigned";
  relatedType: string;
  relatedId: string;
  /** Values the bilingual renderer needs. */
  vars: Record<string, string>;
  urgent?: boolean;
  /**
   * A push this caller ALREADY attempted. `lib/push.ts` sends the assignment
   * push with its own wording and then asks for the inbox row and the email
   * fallback; passing the result here means the notification is not pushed
   * twice, and the fallback still knows whether a device was reached.
   */
  pushResult?: { available: boolean; delivered: number; reason?: string; message?: string };
};

const staffError = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/**
 * Where a teammate's notifications are emailed.
 *
 * `profiles` HAS NO EMAIL COLUMN — the address lives in `auth.users`, which
 * only the service role can read. Without this resolution step every staff
 * email would be refused as `no_email` and the fallback would silently never
 * fire, which is precisely the class of defect this item exists to remove.
 *
 * `profiles.notify_email` wins when set (a business routing alerts to a shared
 * inbox); otherwise the login address is used.
 */
export async function resolveStaffEmail(
  admin: ReturnType<typeof createAdminClient>,
  profile: { id: string; notify_email?: string | null },
): Promise<string | null> {
  const configured = String(profile?.notify_email ?? "").trim();
  if (configured) return configured;
  try {
    const { data, error } = await admin.auth.admin.getUserById(profile.id);
    if (error) {
      console.error(
        `[notify] could not resolve the login email for ${profile.id}: ${error.message}`,
      );
      return null;
    }
    return data?.user?.email ?? null;
  } catch (cause: unknown) {
    console.error(
      `[notify] could not resolve the login email for ${profile.id}: ${staffError(cause)}`,
    );
    return null;
  }
}

/**
 * Shape a profile into the contact row `contactEligibility` understands, with
 * the address actually resolved. Kept here so the cron and the actions cannot
 * drift into two different answers.
 */
export async function staffContact(
  admin: ReturnType<typeof createAdminClient>,
  profile: {
    id: string;
    active?: boolean;
    notify_email?: string | null;
    notify_email_opt_in?: unknown;
  },
): Promise<{ ok: boolean; to?: string; reason?: string }> {
  // The opt-in flag is checked FIRST and by the shared rule, so a teammate who
  // turned alerts off is never looked up at all.
  const preflight = staffEmailEligibility({ ...profile, email: "placeholder@example.com" }) as {
    ok: boolean;
    reason?: string;
  };
  if (!preflight.ok) return preflight;
  const email = await resolveStaffEmail(admin, profile);
  return staffEmailEligibility({ ...profile, email }) as {
    ok: boolean;
    to?: string;
    reason?: string;
  };
}

/**
 * Notify one teammate. NEVER THROWS — an assignment or a payment must not fail
 * because a push service is down — but it never fails silently either: the
 * inbox row carries the outcome and the reason.
 */
export async function notifyStaff(input: StaffNotifyInput): Promise<StaffNotifyResult> {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    // No service role: device_subscriptions is own-profile-only under RLS, so
    // nothing can be delivered and nothing can be recorded. Say so loudly.
    console.error("[notify] staff notification skipped: no service role key is configured");
    return { ok: false, status: "failed", reached: [], reason: "no_service_role" };
  }

  let dedupeKey: string;
  try {
    dedupeKey = notificationKey({
      type: input.type,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      profileId: input.profileId,
    }) as string;
  } catch (cause: unknown) {
    console.error(
      `[notify] refusing to send a notification with an incomplete key: ${staffError(cause)}`,
    );
    return { ok: false, status: "failed", reached: [], reason: "bad_key" };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select(
      "id, organization_id, full_name, active, notify_email, notify_email_opt_in, notify_push_opt_in",
    )
    .eq("id", input.profileId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!profile) return { ok: false, status: "failed", reached: [], reason: "profile_not_found" };

  const content = staffNotification({ type: input.type, locale: "en", ...input.vars }) as {
    title: string;
    body: string;
    url: string;
  };

  // ---- CLAIM. Insert the inbox row first, under the unique dedupe key. Two
  // concurrent writers cannot both get past this, so a job saved twice cannot
  // notify the technician twice.
  const { data: claimed, error: claimError } = await admin
    .from("staff_notifications")
    .insert({
      organization_id: input.organizationId,
      profile_id: input.profileId,
      dedupe_key: dedupeKey,
      type: input.type,
      title: content.title,
      body: content.body,
      url: content.url,
      related_type: input.relatedType,
      related_id: input.relatedId,
      delivery_status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (claimError) {
    // 23505 means a concurrent writer (or an earlier run) already owns it.
    if (String((claimError as { code?: string }).code ?? "") === "23505") {
      return { ok: true, status: "duplicate", reached: [], reason: "already_notified" };
    }
    console.error(`[notify] could not record the staff notification: ${claimError.message}`);
    return { ok: false, status: "failed", reached: [], reason: "claim_failed" };
  }
  const rowId = (claimed as { id?: string } | null)?.id ?? null;

  try {
    const pushStatus = pushDelivery();
    const pushWanted = pushStatus.available && profile.notify_push_opt_in !== false;
    const push = input.pushResult
      ? {
          delivered: input.pushResult.delivered,
          reason: input.pushResult.reason ?? "",
          message: input.pushResult.message ?? "",
        }
      : pushWanted
        ? await sendPushToProfile({
            organizationId: input.organizationId,
            profileId: input.profileId,
            eventType: input.type,
            relatedType: input.relatedType,
            relatedId: input.relatedId,
            notification: (deviceLocale) =>
              staffNotification({ type: input.type, locale: deviceLocale, ...input.vars }) as {
                title: string;
                body: string;
                url: string;
              },
          })
        : {
            ok: false,
            delivered: 0,
            removed: 0,
            failed: 0,
            reason: pushStatus.reason || "push_opt_out",
            message: pushStatus.message,
          };

    const eligibility = await staffContact(admin, profile);
    const plan = deliveryPlan({
      pushAvailable: input.pushResult ? input.pushResult.available : pushWanted,
      pushDelivered: push.delivered,
      emailAvailable: providers.email(),
      emailEligible: eligibility.ok,
      urgent: input.urgent === true,
    }) as { channels: string[]; emailFallback: boolean; emailSkipReason: string };

    let emailSent = false;
    let emailError = "";
    if (plan.emailFallback && eligibility.ok && eligibility.to) {
      const origin = appUrl().replace(/\/$/, "");
      const link = origin ? `${origin}${content.url}` : "";
      const html =
        `<p>${escapeHtml(content.title)}</p><p>${escapeHtml(content.body)}</p>` +
        (link ? `<p><a href="${escapeHtml(link)}">Open in ServicePro</a></p>` : "");
      try {
        const id = await sendEmail(eligibility.to, content.title, html);
        emailSent = true;
        await admin.from("email_messages").insert({
          organization_id: input.organizationId,
          related_type: `staff_${input.type}`,
          related_id: input.relatedId,
          to_email: eligibility.to,
          subject: content.title,
          provider: "resend",
          provider_message_id: id,
          status: "sent",
          sent_at: new Date().toISOString(),
        });
      } catch (cause: unknown) {
        emailError = staffError(cause);
        await admin.from("email_messages").insert({
          organization_id: input.organizationId,
          related_type: `staff_${input.type}`,
          related_id: input.relatedId,
          to_email: eligibility.to,
          subject: content.title,
          provider: "resend",
          status: "failed",
          error: emailError,
        });
        console.error(`[notify] the email fallback for ${input.type} failed: ${emailError}`);
      }
    }

    const outcome = notificationOutcome({
      inapp: { recorded: Boolean(rowId) },
      push: { delivered: push.delivered },
      email: { sent: emailSent },
    }) as { ok: boolean; reached: string[]; status: string };

    const reason =
      emailError ||
      (plan.emailFallback ? "" : plan.emailSkipReason) ||
      (push.delivered > 0 ? "" : push.message || push.reason || "");

    if (rowId) {
      await admin
        .from("staff_notifications")
        .update({
          delivery_status: outcome.status,
          delivery_error: reason ? String(reason).slice(0, 500) : null,
          push_delivered: push.delivered,
          email_sent_at: emailSent ? new Date().toISOString() : null,
        })
        .eq("id", rowId);
    }

    return {
      ok: outcome.ok,
      status: outcome.status as StaffNotifyResult["status"],
      reached: outcome.reached,
      reason: String(reason),
    };
  } catch (cause: unknown) {
    // ---- RELEASE. The claim is given back so a later attempt can retry it. A
    // swallowed send is indistinguishable from a successful one; this is
    // neither — it is deleted and logged.
    if (rowId) await admin.from("staff_notifications").delete().eq("id", rowId);
    console.error(
      `[notify] released the ${input.type} claim for ${input.profileId}: ${staffError(cause)}`,
    );
    return { ok: false, status: "failed", reached: [], reason: staffError(cause) };
  }
}

/**
 * A technician has been given (or taken off) a job.
 *
 * Called by `notifyJobAssigned` in lib/push.ts — the EXISTING trigger — so
 * every place that already assigned work (the dispatch board, the schedule's
 * create form, the crew editor) now produces an inbox row and, when no device
 * was reached, an email. No call site had to change.
 */
export async function notifyJobAssignedStaff(input: {
  organizationId: string;
  jobId: string;
  profileId: string;
  unassigned?: boolean;
  pushResult?: { available: boolean; delivered: number; reason?: string; message?: string };
}): Promise<StaffNotifyResult> {
  try {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("jobs")
      .select("id, service, scheduled_date, start_time, customers!jobs_customer_id_fkey(name)")
      .eq("id", input.jobId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const customer = (job?.customers ?? null) as { name?: string } | null;
    return await notifyStaff({
      organizationId: input.organizationId,
      profileId: input.profileId,
      type: input.unassigned ? "job_unassigned" : "job_assigned",
      relatedType: "job",
      relatedId: input.jobId,
      pushResult: input.pushResult,
      vars: {
        service: job?.service ?? "",
        customerName: customer?.name ?? "",
        scheduledDate: job?.scheduled_date ?? "",
        startTime: job?.start_time ?? "",
        jobId: input.jobId,
      },
    });
  } catch (cause: unknown) {
    console.error(`[notify] job assignment notification failed: ${staffError(cause)}`);
    return { ok: false, status: "failed", reached: [], reason: staffError(cause) };
  }
}

/**
 * Money arrived. The owner is told; an office member is told only when they can
 * actually open the payment, because telling somebody about a record they are
 * not permitted to see is a disclosure, not a courtesy.
 */
export async function notifyPaymentReceived(input: {
  organizationId: string;
  paymentId: string;
  amountLabel: string;
  customerName?: string;
  invoiceNumber?: string | number | null;
  invoiceId?: string | null;
}): Promise<{ notified: number; results: StaffNotifyResult[] }> {
  try {
    const admin = createAdminClient();
    const { data: team } = await admin
      .from("profiles")
      .select("id, role, active")
      .eq("organization_id", input.organizationId)
      .limit(200);
    const ids = (team ?? []).map((row: { id: string }) => row.id);
    const { data: capabilities } = ids.length
      ? await admin
          .from("profile_capabilities")
          .select("profile_id, can_manage_payments")
          .in("profile_id", ids)
      : { data: [] as { profile_id: string; can_manage_payments: boolean }[] };
    const canPay = new Map(
      ((capabilities ?? []) as { profile_id: string; can_manage_payments: boolean }[]).map(
        (row) => [String(row.profile_id), row.can_manage_payments === true],
      ),
    );

    const recipients = paymentNotificationRecipients(
      (team ?? []).map((row: { id: string; role: string; active: boolean }) => ({
        ...row,
        can_manage_payments: canPay.get(String(row.id)) === true,
      })),
    ) as string[];

    const results: StaffNotifyResult[] = [];
    for (const profileId of recipients) {
      results.push(
        await notifyStaff({
          organizationId: input.organizationId,
          profileId,
          type: "payment_received",
          relatedType: "payment",
          relatedId: input.paymentId,
          vars: {
            amountLabel: input.amountLabel,
            customerName: input.customerName ?? "",
            invoiceNumber: input.invoiceNumber ? String(input.invoiceNumber) : "",
            invoiceId: input.invoiceId ?? "",
          },
        }),
      );
    }
    return { notified: results.filter((r) => r.ok).length, results };
  } catch (cause: unknown) {
    console.error(`[notify] payment notification failed: ${staffError(cause)}`);
    return { notified: 0, results: [] };
  }
}
