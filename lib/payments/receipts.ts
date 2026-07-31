import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl, providers, sendEmail, sendSms } from "@/lib/providers";

type Channel = "email" | "sms";

const html = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character] ?? character));

async function claimNotification(admin: ReturnType<typeof createAdminClient>, organizationId: string, paymentId: string, channel: Channel) {
  const { data } = await admin.from("payment_notifications").insert({
    organization_id: organizationId,
    payment_id: paymentId,
    event_type: "receipt",
    channel,
    status: "pending",
    attempts: 1,
  }).select("id").maybeSingle();
  if (data) return data.id as string;

  const { data: existing } = await admin.from("payment_notifications")
    .select("id, status, attempts")
    .eq("payment_id", paymentId).eq("event_type", "receipt").eq("channel", channel)
    .maybeSingle();
  if (!existing || existing.status !== "failed" || Number(existing.attempts) >= 3) return null;
  const { data: retry } = await admin.from("payment_notifications")
    .update({ status: "pending", attempts: Number(existing.attempts) + 1, error_message: null })
    .eq("id", existing.id).eq("status", "failed").select("id").maybeSingle();
  return retry?.id as string | undefined ?? null;
}

export async function sendPaymentReceipt(paymentId: string) {
  const admin = createAdminClient();
  const { data: payment } = await admin.from("payments")
    .select("id, organization_id, invoice_id, estimate_id, base_amount_minor, surcharge_minor, tip_minor, currency, method, normalized_status")
    .eq("id", paymentId).maybeSingle();
  if (!payment || !["settled", "partially_refunded"].includes(payment.normalized_status)) return { email: false, sms: false };

  const [{ data: settings }, { data: organization }] = await Promise.all([
    admin.from("payment_settings").select("receipt_email_enabled, receipt_sms_enabled").eq("organization_id", payment.organization_id).maybeSingle(),
    admin.from("organizations").select("name, locale").eq("id", payment.organization_id).single(),
  ]);
  const documentType = payment.invoice_id ? "invoice" : "estimate";
  const { data: document } = payment.invoice_id
    ? await admin.from("invoices").select("number, public_token, customer_id").eq("id", payment.invoice_id).maybeSingle()
    : await admin.from("estimates").select("number, public_token, customer_id").eq("id", payment.estimate_id!).maybeSingle();
  if (!document?.customer_id) return { email: false, sms: false };
  const { data: customer } = await admin.from("customers").select("name, email, phone").eq("id", document.customer_id).maybeSingle();
  if (!customer) return { email: false, sms: false };

  const he = organization?.locale === "he";
  const business = organization?.name ?? "ServicePro";
  const tipMinor = Number(payment.tip_minor ?? 0);
  const totalMinor = Number(payment.base_amount_minor) + Number(payment.surcharge_minor ?? 0) + tipMinor;
  const format = (minor: number) => new Intl.NumberFormat(he ? "he-IL" : "en-US", { style: "currency", currency: payment.currency ?? "USD" }).format(minor / 100);
  const amount = format(totalMinor);
  // Until tips could be collected, tip_minor was always zero and the receipt
  // could show a single figure. Now that a customer can add one, the receipt has
  // to say what part of the charge was the tip — otherwise the total looks like
  // an overcharge against the invoice they were shown.
  const tipLine = tipMinor > 0
    ? (he ? `<p>כולל טיפ בסך ${html(format(tipMinor))}.</p>` : `<p>Includes a ${html(format(tipMinor))} tip.</p>`)
    : "";
  const tipSms = tipMinor > 0 ? (he ? ` כולל טיפ ${format(tipMinor)}.` : ` Includes a ${format(tipMinor)} tip.`) : "";
  const label = he ? (documentType === "invoice" ? "חשבונית" : "הצעת מחיר") : documentType;
  const firstName = String(customer.name ?? "").trim().split(/\s+/)[0] || (he ? "שלום" : "there");
  const link = document.public_token && appUrl() ? `${appUrl().replace(/\/$/, "")}/p/${document.public_token}` : "";
  const subject = he ? `קבלה מ־${business} — ${label} #${document.number}` : `Receipt from ${business} — ${label} #${document.number}`;
  const emailBody = he
    ? `<div dir="rtl"><p>${html(firstName)}, שלום</p><p>קיבלנו את התשלום שלך בסך <strong>${html(amount)}</strong> עבור ${html(label)} #${html(document.number)}.</p>${tipLine}<p>אמצעי תשלום: ${html(payment.method)}</p>${link ? `<p><a href="${html(link)}">צפייה במסמך ובסטטוס התשלום</a></p>` : ""}<p>תודה,<br>${html(business)}</p></div>`
    : `<p>Hi ${html(firstName)},</p><p>We received your <strong>${html(amount)}</strong> payment for ${html(label)} #${html(document.number)}.</p>${tipLine}<p>Payment method: ${html(payment.method)}</p>${link ? `<p><a href="${html(link)}">View your document and payment status</a></p>` : ""}<p>Thank you,<br>${html(business)}</p>`;
  const smsBody = he
    ? `${business}: התשלום בסך ${amount} עבור ${label} #${document.number} התקבל.${tipSms}${link ? ` ${link}` : ""}`
    : `${business}: We received your ${amount} payment for ${label} #${document.number}.${tipSms}${link ? ` ${link}` : ""}`;

  let emailSent = false; let smsSent = false;
  if (settings?.receipt_email_enabled && customer.email && providers.email()) {
    const notificationId = await claimNotification(admin, payment.organization_id, payment.id, "email");
    if (notificationId) {
      try {
        const providerId = await sendEmail(customer.email, subject, emailBody);
        await Promise.all([
          admin.from("payment_notifications").update({ status: "sent", provider_message_id: providerId, sent_at: new Date().toISOString() }).eq("id", notificationId),
          admin.from("email_messages").insert({ organization_id: payment.organization_id, related_type: "payment_receipt", related_id: payment.id, to_email: customer.email, subject, provider: "resend", provider_message_id: providerId, status: "sent", sent_at: new Date().toISOString() }),
        ]);
        emailSent = true;
      } catch (error) {
        await admin.from("payment_notifications").update({ status: "failed", error_message: String(error).slice(0, 500) }).eq("id", notificationId);
      }
    }
  }
  if (settings?.receipt_sms_enabled && customer.phone && customer.phone !== "—" && providers.sms()) {
    const notificationId = await claimNotification(admin, payment.organization_id, payment.id, "sms");
    if (notificationId) {
      try {
        const providerId = await sendSms(customer.phone, smsBody);
        await Promise.all([
          admin.from("payment_notifications").update({ status: "sent", provider_message_id: providerId, sent_at: new Date().toISOString() }).eq("id", notificationId),
          admin.from("sms_messages").insert({ organization_id: payment.organization_id, customer_id: document.customer_id, to_phone: customer.phone, body: smsBody, provider: "twilio", provider_message_id: providerId, status: "sent", sent_at: new Date().toISOString() }),
        ]);
        smsSent = true;
      } catch (error) {
        await admin.from("payment_notifications").update({ status: "failed", error_message: String(error).slice(0, 500) }).eq("id", notificationId);
      }
    }
  }
  return { email: emailSent, sms: smsSent };
}

export async function retryFailedPaymentReceipts(limit = 40) {
  const admin = createAdminClient();
  const { data, error } = await admin.from("payment_notifications")
    .select("payment_id")
    .eq("status", "failed")
    .lt("attempts", 3)
    .order("updated_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw error;
  const paymentIds = [...new Set((data ?? []).map((item) => item.payment_id as string))];
  for (const paymentId of paymentIds) {
    try { await sendPaymentReceipt(paymentId); } catch { /* retry again on the next run */ }
  }
  return { retried: paymentIds.length };
}
