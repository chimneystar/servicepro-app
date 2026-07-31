import { createAdminClient } from "@/lib/supabase/admin";
import { providers, sendSms } from "@/lib/providers";
import { fillTemplate } from "@/lib/notify";

function addMonths(iso: string, m: number) { const d = new Date(iso + "T00:00:00"); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); }
const dayISO = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };

/** Create jobs for every maintenance plan that's due today (all orgs). */
export async function runRecurringGeneration(): Promise<number> {
  const admin = createAdminClient();
  const today = dayISO(0);
  const { data: due } = await admin.from("recurring_plans").select("*").eq("active", true).lte("next_due", today);
  let created = 0;
  for (const p of due ?? []) {
    const { error } = await admin.from("jobs").insert({
      organization_id: p.organization_id, created_by: p.created_by, customer_id: p.customer_id,
      assigned_to: p.assigned_to, service: p.service, price_minor: p.price_minor,
      scheduled_date: p.next_due, end_date: p.next_due, source: "Maintenance plan",
    });
    if (!error) { created++; await admin.from("recurring_plans").update({ next_due: addMonths(p.next_due, p.interval_months) }).eq("id", p.id); }
  }
  return created;
}

/** Send day-before appointment reminders + weekly overdue-invoice nudges (SMS). */
export async function runReminders(): Promise<{ appointments: number; overdue: number }> {
  if (!providers.sms()) return { appointments: 0, overdue: 0 };
  const admin = createAdminClient();
  const today = dayISO(0), tomorrow = dayISO(1), weekAgo = dayISO(-7);
  let appointments = 0, overdue = 0;

  // --- Appointment reminders (jobs scheduled tomorrow) ---
  const { data: jobs } = await admin.from("jobs")
    .select("id, service, scheduled_date, start_time, organization_id, customers(name, phone, sms_opt_in)")
    .eq("scheduled_date", tomorrow).eq("status", "scheduled").is("deleted_at", null);
  for (const j of jobs ?? []) {
    const cust: any = (j as any).customers;
    if (!cust?.phone || cust.phone === "—") continue;
    if (cust.sms_opt_in === false) continue; // customer replied STOP
    const { data: tpl } = await admin.from("message_templates").select("enabled, body").eq("organization_id", j.organization_id).eq("trigger", "day_before").maybeSingle();
    if (!tpl?.enabled || !tpl.body) continue;
    // Claim the slot first so two concurrent runs cannot both send...
    const { error: dupe } = await admin.from("reminder_log").insert({ organization_id: j.organization_id, kind: "appointment", ref_id: j.id, sent_on: today });
    if (dupe) continue; // already sent today
    const { data: org } = await admin.from("organizations").select("name").eq("id", j.organization_id).single();
    const body = fillTemplate(tpl.body, { name: (cust.name ?? "").split(" ")[0] ?? "", service: j.service ?? "", date: j.scheduled_date ?? "", time: (j.start_time ?? "").slice(0, 5), business: org?.name ?? "" });
    try {
      const sid = await sendSms(cust.phone, body);
      await admin.from("sms_messages").insert({ organization_id: j.organization_id, job_id: j.id, to_phone: cust.phone, body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString() });
      appointments++;
    } catch (e: unknown) {
      // ...but RELEASE it on failure, or a transient provider error would
      // suppress this reminder permanently — it could never be retried.
      await admin.from("reminder_log").delete().eq("organization_id", j.organization_id).eq("kind", "appointment").eq("ref_id", j.id).eq("sent_on", today);
      console.error(`[cron] appointment reminder failed for job ${j.id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  // --- Overdue invoice nudges (unpaid > 14 days, at most weekly) ---
  const { data: invs } = await admin.from("invoices")
    .select("id, number, issue_date, organization_id, customers(name, phone, sms_opt_in)")
    .eq("status", "unpaid").is("deleted_at", null).lte("issue_date", dayISO(-14));
  for (const inv of invs ?? []) {
    const cust: any = (inv as any).customers;
    if (!cust?.phone || cust.phone === "—") continue;
    if (cust.sms_opt_in === false) continue; // customer replied STOP
    const { data: recent } = await admin.from("reminder_log").select("id").eq("kind", "overdue").eq("ref_id", inv.id).gte("sent_on", weekAgo).limit(1);
    if (recent && recent.length) continue;
    const { error: dupe } = await admin.from("reminder_log").insert({ organization_id: inv.organization_id, kind: "overdue", ref_id: inv.id, sent_on: today });
    if (dupe) continue;
    const { data: org } = await admin.from("organizations").select("name").eq("id", inv.organization_id).single();
    const body = `Friendly reminder from ${org?.name}: invoice #${inv.number} is past due. Please let us know if you have any questions — thank you!`;
    try {
      const sid = await sendSms(cust.phone, body);
      await admin.from("sms_messages").insert({ organization_id: inv.organization_id, to_phone: cust.phone, body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString() });
      overdue++;
    } catch (e: unknown) {
      // Release the claim so a transient failure can be retried next run.
      await admin.from("reminder_log").delete().eq("organization_id", inv.organization_id).eq("kind", "overdue").eq("ref_id", inv.id).eq("sent_on", today);
      console.error(`[cron] overdue nudge failed for invoice ${inv.id}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return { appointments, overdue };
}
