import { createClient } from "@/lib/supabase/server";
import { providers, sendSms } from "@/lib/providers";

/** Fill {name} {service} {date} {time} {business} placeholders. */
export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

/**
 * Send the "technician on the way" text to the customer, IF an SMS provider
 * is connected and the template is enabled. Always safe to call — it silently
 * does nothing when SMS isn't configured yet. Every send is logged.
 */
export async function notifyOnMyWay(jobId: string): Promise<void> {
  if (!providers.sms()) return;
  const supabase = createClient();
  const { data: job } = await supabase.from("jobs")
    .select("service, scheduled_date, start_time, organization_id, customers(name, phone)")
    .eq("id", jobId).maybeSingle();
  if (!job) return;
  const cust: any = job.customers;
  if (!cust?.phone || cust.phone === "—") return;

  const [{ data: tpl }, { data: org }] = await Promise.all([
    supabase.from("message_templates").select("enabled, body").eq("trigger", "on_the_way").maybeSingle(),
    supabase.from("organizations").select("name").eq("id", job.organization_id).single(),
  ]);
  if (!tpl || !tpl.enabled || !tpl.body) return;

  const body = fillTemplate(tpl.body, {
    name: (cust.name ?? "").split(" ")[0] ?? "",
    service: job.service ?? "",
    date: job.scheduled_date ?? "",
    time: (job.start_time ?? "").slice(0, 5),
    business: org?.name ?? "",
  });

  try {
    const sid = await sendSms(cust.phone, body);
    await supabase.from("sms_messages").insert({
      organization_id: job.organization_id, job_id: jobId, to_phone: cust.phone,
      body, provider: "twilio", provider_message_id: sid, status: "sent", sent_at: new Date().toISOString(),
    });
  } catch (e: any) {
    await supabase.from("sms_messages").insert({
      organization_id: job.organization_id, job_id: jobId, to_phone: cust.phone,
      body, provider: "twilio", status: "failed", error: String(e?.message ?? e).slice(0, 500),
    });
  }
}
