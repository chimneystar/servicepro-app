import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getConnection } from "@/lib/integrations/connections";
import { createAccountOnboardingLink } from "@/lib/integrations/stripe-connect";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const connection = await getConnection(createClient(), profile.organization_id!, "stripe");
  if (!connection?.external_account_id) return NextResponse.redirect(new URL("/settings/integrations", request.url));
  const link = await createAccountOnboardingLink(connection.external_account_id);
  return NextResponse.redirect(link.url);
}
