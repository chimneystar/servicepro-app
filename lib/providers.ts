// =====================================================================
//  providers.ts — optional integrations, activated purely by env vars.
//  Nothing here runs (or breaks the app) unless the matching keys are set,
//  so the app ships fully working and you "switch on" each provider later.
//  All calls use the providers' REST APIs via fetch — no extra npm deps.
// =====================================================================

export const providers = {
  stripe: () => !!process.env.STRIPE_SECRET_KEY,
  email: () => !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
  sms: () =>
    !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
};

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "";
}

/** Send an email via Resend. Returns provider message id or throws. */
export async function sendEmail(to: string, subject: string, html: string): Promise<string> {
  if (!providers.email()) throw new Error("email not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.id ?? "";
}

/** Send an SMS via Twilio. Returns provider message sid or throws. */
export async function sendSms(to: string, body: string): Promise<string> {
  if (!providers.sms()) throw new Error("sms not configured");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const form = new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Twilio error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.sid ?? "";
}

/** Create a Stripe Checkout Session for a single amount. Returns the hosted URL. */
export async function createCheckoutUrl(opts: {
  amountMinor: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<string> {
  if (!providers.stripe()) throw new Error("stripe not configured");
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("success_url", opts.successUrl);
  form.set("cancel_url", opts.cancelUrl);
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", opts.currency.toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(opts.amountMinor));
  form.set("line_items[0][price_data][product_data][name]", opts.description.slice(0, 250));
  for (const [k, v] of Object.entries(opts.metadata ?? {})) form.set(`metadata[${k}]`, v);
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Stripe error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data?.url as string;
}
