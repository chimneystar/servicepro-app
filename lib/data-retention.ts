import { createAdminClient } from "@/lib/supabase/admin";
import * as backendData from "@/lib/data/backend";

const before = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

export async function runDataRetentionForOrganization(
  organizationId: string,
  enforce: boolean,
  actorId: string | null = null,
) {
  const admin = createAdminClient();
  const { data: settings, error: settingsError } = await admin
    .from("organization_privacy_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .single();
  if (settingsError || !settings) throw new Error("privacy_settings_unavailable");
  const now = new Date(),
    runKey = `${now.toISOString().slice(0, 10)}:${actorId ? "manual" : "daily"}`;
  const { data: existing } = await admin
    .from("retention_runs")
    .select("id,status,summary")
    .eq("organization_id", organizationId)
    .eq("run_key", runKey)
    .eq("mode", enforce ? "enforce" : "preview")
    .maybeSingle();
  if (existing?.status === "completed") return existing.summary;
  const { data: run, error: runError } = await admin
    .from("retention_runs")
    .upsert(
      {
        organization_id: organizationId,
        run_key: runKey,
        mode: enforce ? "enforce" : "preview",
        status: "running",
        created_by: actorId,
      },
      { onConflict: "organization_id,run_key,mode" },
    )
    .select("id")
    .single();
  if (runError || !run) throw new Error("retention_run_unavailable");
  try {
    const holds = await backendData.listActiveRetentionHolds(
      admin,
      organizationId,
      now.toISOString(),
    );
    const held = (category: string) =>
      holds.some((row: any) => row.category === "all" || row.category === category);
    // Five tables, one age column each — written out rather than taken as
    // `table: string`, which the typed client cannot check at all (`from()`
    // needs a literal). `merchant_accounts`, a table that never existed, sat in
    // production code for months precisely because a dynamic table name is
    // unverifiable. Behaviour is identical; the set is the same five.
    const AGE_COLUMN = {
      technician_locations: "recorded_at",
      sms_messages: "created_at",
      email_messages: "created_at",
      job_photos: "created_at",
      audit_log: "at",
    } as const;
    const count = async (table: keyof typeof AGE_COLUMN, cutoff: string) => {
      const { count, error } = await admin
        .from(table)
        .select("*", { head: true, count: "exact" })
        .eq("organization_id", organizationId)
        .lt(AGE_COLUMN[table], cutoff);
      if (error) throw error;
      return count ?? 0;
    };
    const locationCutoff = before(settings.location_retention_days),
      callCutoff = before(settings.call_recording_retention_days),
      communicationCutoff = before(settings.communication_retention_days);
    const summary: any = {
      preview: !enforce,
      locationPoints: held("location") ? 0 : await count("technician_locations", locationCutoff),
      callRecordings: 0,
      smsMessages: 0,
      emailMessages: 0,
      mediaRowsDue: 0,
      auditRowsDue: 0,
      holds: (holds ?? []).length,
    };
    if (!held("calls")) {
      const { count, error } = await admin
        .from("call_events")
        .select("*", { head: true, count: "exact" })
        .eq("organization_id", organizationId)
        .not("recording_url", "is", null)
        .lt("started_at", callCutoff);
      if (error) throw error;
      summary.callRecordings = count ?? 0;
    }
    if (!held("communications")) {
      summary.smsMessages = await count("sms_messages", communicationCutoff);
      summary.emailMessages = await count("email_messages", communicationCutoff);
    }
    if (!held("media")) {
      const mediaCutoff = before(settings.job_media_retention_days);
      summary.mediaRowsDue = await count("job_photos", mediaCutoff);
    }
    if (!held("audit")) {
      const auditCutoff = before(settings.audit_retention_days);
      summary.auditRowsDue = await count("audit_log", auditCutoff);
    }
    if (enforce) {
      if (!held("location"))
        await admin
          .from("technician_locations")
          .delete()
          .eq("organization_id", organizationId)
          .lt("recorded_at", locationCutoff);
      if (!held("calls"))
        await admin
          .from("call_events")
          .update({ recording_url: null })
          .eq("organization_id", organizationId)
          .not("recording_url", "is", null)
          .lt("started_at", callCutoff);
      if (!held("communications")) {
        await admin
          .from("sms_messages")
          .delete()
          .eq("organization_id", organizationId)
          .lt("created_at", communicationCutoff);
        await admin
          .from("email_messages")
          .delete()
          .eq("organization_id", organizationId)
          .lt("created_at", communicationCutoff);
      }
      // Media storage objects and immutable audit history are previewed but never silently removed.
    }
    await admin
      .from("retention_runs")
      .update({ status: "completed", summary, finished_at: new Date().toISOString() })
      .eq("id", run.id);
    return summary;
  } catch (error: any) {
    await admin
      .from("retention_runs")
      .update({
        status: "failed",
        error_message: String(error?.message ?? error),
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    throw error;
  }
}

export async function runAutomaticDataRetention() {
  const admin = createAdminClient();
  const settings = await backendData.listOrgsWithAutoRetention(admin);
  let completed = 0,
    failed = 0;
  for (const row of settings) {
    try {
      await runDataRetentionForOrganization(row.organization_id, true);
      completed++;
    } catch {
      failed++;
    }
  }
  return { completed, failed };
}
