import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import * as backendData from "@/lib/data/backend";
// @ts-ignore -- pure ESM crypto/logic, proven both ways in tests/push.test.mjs
import {
  vapidStatus,
  pushUnavailableMessage,
  buildVapidAuthorization,
  encryptPushPayload,
  classifyPushResponse,
  jobAssignedNotification,
  // @ts-ignore
} from "@/lib/core/push.mjs";

/**
 * Web Push sender.
 *
 * THE DEFECT THIS FIXES: `device_subscriptions` collected VAPID subscriptions
 * and `public/sw.js` handled the `push` event, but NO SENDER EXISTED ANYWHERE
 * in the codebase. A technician enabled notifications and nothing could ever
 * arrive. This is that sender.
 *
 * Two rules it holds to:
 *  - When VAPID is not configured the feature is UNAVAILABLE and says so — it
 *    records the attempt with the reason and returns it to the caller. A silent
 *    no-op is the exact defect being repaired, so it is never done here.
 *  - A push service answering 404/410 means the browser discarded that
 *    subscription. The row is deleted. Without that the table fills with dead
 *    endpoints for ever and every later send wastes a request on each one.
 */

export type PushNotification = { title: string; body: string; url: string };
export type PushSendResult = {
  ok: boolean;
  delivered: number;
  removed: number;
  failed: number;
  reason: string;
  message: string;
};

const LOG = "[push]";

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  locale: string | null;
};

/** Is push delivery configured at all? Never throws. */
export function pushDelivery(locale: "en" | "he" = "en"): {
  available: boolean;
  reason: string;
  message: string;
} {
  const status = vapidStatus(process.env) as { available: boolean; reason: string };
  return {
    available: status.available,
    reason: status.reason,
    message: status.available ? "" : (pushUnavailableMessage(status.reason, locale) as string),
  };
}

async function recordEvent(
  admin: ReturnType<typeof createAdminClient>,
  row: {
    organizationId: string;
    profileId: string | null;
    eventType: string;
    notification: PushNotification;
    status: string;
    deviceCount: number;
    error: string | null;
    relatedType?: string | null;
    relatedId?: string | null;
  },
) {
  const { error } = await admin.from("push_notification_events").insert({
    organization_id: row.organizationId,
    profile_id: row.profileId,
    event_type: row.eventType,
    title: row.notification.title.slice(0, 200),
    body: row.notification.body.slice(0, 500),
    target_url: row.notification.url,
    status: row.status,
    device_count: row.deviceCount,
    error_message: row.error ? row.error.slice(0, 500) : null,
    related_type: row.relatedType ?? null,
    related_id: row.relatedId ?? null,
    sent_at: row.status === "sent" ? new Date().toISOString() : null,
  });
  // Losing the log must not lose the notification, but it must not be silent either.
  if (error) console.error(`${LOG} could not record the delivery attempt: ${error.message}`);
}

/**
 * Send one notification to every enabled device of one teammate.
 * Never throws: an assignment must not fail because a push service is down.
 */
export async function sendPushToProfile(input: {
  organizationId: string;
  profileId: string;
  eventType: string;
  notification: (locale: "en" | "he") => PushNotification;
  relatedType?: string;
  relatedId?: string;
}): Promise<PushSendResult> {
  const fallback = input.notification("en");
  const status = vapidStatus(process.env) as {
    available: boolean;
    reason: string;
    publicKey: string;
    privateKey: string;
    subject: string;
  };

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    const message = "Push delivery is unavailable: the service role key is not configured.";
    console.error(`${LOG} ${message}`);
    return { ok: false, delivered: 0, removed: 0, failed: 0, reason: "no_service_role", message };
  }

  if (!status.available) {
    const message = pushUnavailableMessage(status.reason, "en") as string;
    console.error(`${LOG} ${message}`);
    await recordEvent(admin, {
      organizationId: input.organizationId,
      profileId: input.profileId,
      eventType: input.eventType,
      notification: fallback,
      status: "unavailable",
      deviceCount: 0,
      error: message,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
    });
    return { ok: false, delivered: 0, removed: 0, failed: 0, reason: status.reason, message };
  }

  // sendPushToProfile NEVER throws (see the doc comment above): a repository
  // read that now throws on a query error is caught here and turned back into
  // the same `lookup_failed` result the caller has always seen.
  let subscriptions: SubscriptionRow[];
  try {
    subscriptions = (await backendData.listEnabledDeviceSubscriptions(
      admin,
      input.organizationId,
      input.profileId,
    )) as SubscriptionRow[];
  } catch (cause: unknown) {
    const message = `Push delivery could not read the device list: ${cause instanceof Error ? cause.message : String(cause)}`;
    console.error(`${LOG} ${message}`);
    return { ok: false, delivered: 0, removed: 0, failed: 0, reason: "lookup_failed", message };
  }

  if (subscriptions.length === 0) {
    const message = pushUnavailableMessage("no_devices", "en") as string;
    await recordEvent(admin, {
      organizationId: input.organizationId,
      profileId: input.profileId,
      eventType: input.eventType,
      notification: fallback,
      status: "unavailable",
      deviceCount: 0,
      error: message,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
    });
    return { ok: false, delivered: 0, removed: 0, failed: 0, reason: "no_devices", message };
  }

  let delivered = 0,
    removed = 0,
    failed = 0;
  const problems: string[] = [];

  for (const subscription of subscriptions) {
    const notification = input.notification(subscription.locale === "he" ? "he" : "en");
    try {
      const body = encryptPushPayload({
        payload: JSON.stringify(notification),
        p256dh: subscription.p256dh,
        auth: subscription.auth_secret,
      }) as Buffer;
      const { authorization } = buildVapidAuthorization({
        endpoint: subscription.endpoint,
        subject: status.subject,
        publicKey: status.publicKey,
        privateKey: status.privateKey,
      }) as { authorization: string };

      const response = await fetch(subscription.endpoint, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: "3600",
          Urgency: "high",
        },
        body: body as unknown as BodyInit,
        signal: AbortSignal.timeout(10_000),
      });

      const verdict = classifyPushResponse(response.status) as string;
      if (verdict === "sent") {
        delivered += 1;
        continue;
      }
      if (verdict === "gone") {
        // The browser discarded this subscription. Remove it, or it is retried
        // for ever and the table never stops growing.
        const { error: deleteError } = await admin
          .from("device_subscriptions")
          .delete()
          .eq("id", subscription.id);
        if (deleteError)
          problems.push(`stale subscription could not be removed: ${deleteError.message}`);
        else removed += 1;
        continue;
      }
      failed += 1;
      problems.push(`${verdict} (${response.status})`);
      if (verdict === "unauthorized")
        console.error(
          `${LOG} the push service refused the VAPID credentials — check VAPID_SUBJECT and the key pair.`,
        );
    } catch (cause: any) {
      failed += 1;
      problems.push(String(cause?.message ?? cause).slice(0, 120));
    }
  }

  const summary = problems.length ? problems.join("; ") : null;
  if (summary) console.error(`${LOG} ${input.eventType}: ${summary}`);
  await recordEvent(admin, {
    organizationId: input.organizationId,
    profileId: input.profileId,
    eventType: input.eventType,
    notification: fallback,
    status: delivered > 0 ? "sent" : "failed",
    deviceCount: delivered,
    error: summary,
    relatedType: input.relatedType,
    relatedId: input.relatedId,
  });

  return {
    ok: delivered > 0,
    delivered,
    removed,
    failed,
    reason: delivered > 0 ? "sent" : "failed",
    message: summary ?? "",
  };
}

/**
 * The trigger that matters: a technician has been given a job.
 *
 * Called from the dispatch board and from job creation. It reads the job with
 * the service role because `device_subscriptions` is own-profile-only under RLS
 * — the dispatcher legitimately cannot see the technician's devices.
 *
 * LEDGER 6c.5 — this trigger was EXTENDED, not replaced. The push is sent
 * exactly as before, with the same wording; afterwards the result is handed to
 * `notifyJobAssignedStaff`, which writes the in-app inbox row and — only when
 * no device was reached — sends an email. Every existing call site therefore
 * gained an inbox and a fallback without changing a line.
 *
 * The import is dynamic because lib/notify.ts imports `sendPushToProfile` from
 * this module; a static import here would be a module cycle.
 */
export async function notifyJobAssigned(input: {
  organizationId: string;
  jobId: string;
  profileId: string;
}): Promise<PushSendResult> {
  let pushed: PushSendResult = {
    ok: false,
    delivered: 0,
    removed: 0,
    failed: 0,
    reason: "error",
    message: "",
  };
  try {
    const admin = createAdminClient();
    const { data: job } = await admin
      .from("jobs")
      .select(
        "id, service, scheduled_date, start_time, organization_id, customers!jobs_customer_id_fkey(name)",
      )
      .eq("id", input.jobId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const customer = (job?.customers ?? null) as { name?: string } | null;
    pushed = await sendPushToProfile({
      organizationId: input.organizationId,
      profileId: input.profileId,
      eventType: "job_assigned",
      relatedType: "job",
      relatedId: input.jobId,
      notification: (locale) =>
        jobAssignedNotification({
          locale,
          service: job?.service ?? "",
          customerName: customer?.name ?? "",
          scheduledDate: job?.scheduled_date ?? "",
          startTime: job?.start_time ?? "",
          jobId: input.jobId,
        }) as PushNotification,
    });
  } catch (cause: any) {
    const message = `Push delivery failed before sending: ${String(cause?.message ?? cause)}`;
    console.error(`${LOG} ${message}`);
    pushed = { ok: false, delivered: 0, removed: 0, failed: 0, reason: "error", message };
  }

  // The inbox row and the email fallback. Never allowed to fail the assignment.
  try {
    const { notifyJobAssignedStaff } = await import("@/lib/notify");
    await notifyJobAssignedStaff({
      organizationId: input.organizationId,
      jobId: input.jobId,
      profileId: input.profileId,
      pushResult: {
        available: pushDelivery().available,
        delivered: pushed.delivered,
        reason: pushed.reason,
        message: pushed.message,
      },
    });
  } catch (cause: any) {
    console.error(
      `${LOG} the staff notification for job ${input.jobId} could not be recorded: ${String(cause?.message ?? cause)}`,
    );
  }

  return pushed;
}
