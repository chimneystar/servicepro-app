import { integrationAppUrl } from "./url";

async function stripeRequest(path: string, form?: URLSearchParams, connectedAccount?: string) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe is not configured");
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(connectedAccount ? { "Stripe-Account": connectedAccount } : {}),
    },
    body: form?.toString(),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Stripe API error ${response.status}`);
  return data;
}

export async function createConnectedAccount(input: { organizationId: string; businessName: string; email?: string | null }) {
  const form = new URLSearchParams({
    type: "express",
    country: "US",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
    "metadata[servicepro_organization_id]": input.organizationId,
    "business_profile[name]": input.businessName,
  });
  if (input.email) form.set("email", input.email);
  return stripeRequest("accounts", form) as Promise<{ id: string; charges_enabled: boolean; details_submitted: boolean }>;
}

export async function retrieveConnectedAccount(accountId: string) {
  return stripeRequest(`accounts/${encodeURIComponent(accountId)}`) as Promise<{ id: string; charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean; requirements?: { currently_due?: string[] } }>;
}

export async function createAccountOnboardingLink(accountId: string) {
  const base = integrationAppUrl();
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  const form = new URLSearchParams({
    account: accountId,
    refresh_url: `${base}/api/integrations/stripe/refresh`,
    return_url: `${base}/api/integrations/stripe/return`,
    type: "account_onboarding",
  });
  return stripeRequest("account_links", form) as Promise<{ url: string; expires_at: number }>;
}

export async function createConnectedCheckout(input: {
  accountId: string;
  amountMinor: number;
  currency: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}) {
  const form = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": input.description.slice(0, 250),
  });
  for (const [key, value] of Object.entries(input.metadata)) form.set(`metadata[${key}]`, value);
  const session = await stripeRequest("checkout/sessions", form, input.accountId);
  if (!session.url) throw new Error("Stripe did not return a Checkout URL");
  return session as { id: string; url: string };
}
