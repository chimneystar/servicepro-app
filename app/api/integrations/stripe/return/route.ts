import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getConnection, saveConnection } from "@/lib/integrations/connections";
import { retrieveConnectedAccount } from "@/lib/integrations/stripe-connect";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const client = createClient();
  const connection = await getConnection(client, profile.organization_id!, "stripe");
  if (connection?.external_account_id) {
    const account = await retrieveConnectedAccount(connection.external_account_id);
    await saveConnection(client, {
      organizationId: profile.organization_id!, provider: "stripe",
      status: account.charges_enabled && account.details_submitted ? "connected" : "action_required",
      externalAccountId: account.id,
      metadata: { charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled, details_submitted: account.details_submitted, requirements_due: account.requirements?.currently_due ?? [] },
      errorMessage: account.charges_enabled ? null : "Stripe needs more business information.", connectedBy: profile.id,
    });
  }
  return NextResponse.redirect(new URL("/settings/integrations?stripe=returned", request.url));
}
