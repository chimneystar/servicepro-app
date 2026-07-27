"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { disconnectConnection, getConnection, missingPlatformConfig, saveConnection } from "@/lib/integrations/connections";
import type { IntegrationProvider } from "@/lib/integrations/types";
import { provisionTwilioOrganization } from "@/lib/integrations/twilio";
import { createAccountOnboardingLink, createConnectedAccount, retrieveConnectedAccount } from "@/lib/integrations/stripe-connect";

export async function disconnectIntegration(formData: FormData) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const provider = String(formData.get("provider") ?? "") as IntegrationProvider;
  if (!(["gmail", "twilio", "stripe"] as string[]).includes(provider)) throw new Error("Invalid provider");
  const client = createClient();
  await disconnectConnection(client, profile.organization_id!, provider);
  revalidatePath("/settings/integrations");
}

export async function provisionTextMessaging(formData: FormData) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const missing = missingPlatformConfig("twilio");
  if (missing.length) throw new Error(`Platform setup required: ${missing.join(", ")}`);
  const areaCode = String(formData.get("area_code") ?? "").replace(/\D/g, "");
  const client = createClient();
  const [{ data: organization }, current] = await Promise.all([
    client.from("organizations").select("name").eq("id", profile.organization_id!).single(),
    getConnection(client, profile.organization_id!, "twilio"),
  ]);
  if (current?.encrypted_credentials) throw new Error("Text messaging is already provisioned. Disconnect it before creating another number.");
  const provisioned = await provisionTwilioOrganization({
    organizationId: profile.organization_id!,
    businessName: organization?.name ?? "ServicePro business",
    areaCode,
  });
  await saveConnection(client, {
    organizationId: profile.organization_id!,
    provider: "twilio",
    status: "action_required",
    externalAccountId: provisioned.externalAccountId,
    encryptedCredentials: provisioned.encryptedCredentials,
    metadata: provisioned.metadata,
    errorMessage: "Complete A2P 10DLC registration before sending regular customer traffic.",
    connectedBy: profile.id,
  });
  revalidatePath("/settings/integrations");
}

export async function startStripeOnboarding() {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const missing = missingPlatformConfig("stripe");
  if (missing.includes("STRIPE_SECRET_KEY")) throw new Error("Platform setup required: STRIPE_SECRET_KEY");
  const client = createClient();
  const [{ data: organization }, current] = await Promise.all([
    client.from("organizations").select("name, email").eq("id", profile.organization_id!).single(),
    getConnection(client, profile.organization_id!, "stripe"),
  ]);
  let accountId = current?.external_account_id ?? null;
  if (!accountId) {
    const account = await createConnectedAccount({
      organizationId: profile.organization_id!,
      businessName: organization?.name ?? "ServicePro business",
      email: organization?.email,
    });
    accountId = account.id;
    await saveConnection(client, {
      organizationId: profile.organization_id!,
      provider: "stripe",
      status: "pending",
      externalAccountId: accountId,
      metadata: { charges_enabled: false, details_submitted: false },
      connectedBy: profile.id,
    });
  }
  const link = await createAccountOnboardingLink(accountId);
  redirect(link.url);
}

export async function refreshStripeConnection() {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const client = createClient();
  const current = await getConnection(client, profile.organization_id!, "stripe");
  if (!current?.external_account_id) return;
  const account = await retrieveConnectedAccount(current.external_account_id);
  await saveConnection(client, {
    organizationId: profile.organization_id!,
    provider: "stripe",
    status: account.charges_enabled && account.details_submitted ? "connected" : "action_required",
    externalAccountId: account.id,
    metadata: {
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      requirements_due: account.requirements?.currently_due ?? [],
    },
    errorMessage: account.charges_enabled ? null : "Stripe needs more business information.",
    connectedBy: profile.id,
  });
  revalidatePath("/settings/integrations");
}
