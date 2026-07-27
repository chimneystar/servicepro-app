import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { createGoogleAuthorization } from "@/lib/integrations/gmail";
import { missingPlatformConfig } from "@/lib/integrations/connections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const missing = missingPlatformConfig("gmail");
  if (missing.length) return NextResponse.json({ error: `Platform setup required: ${missing.join(", ")}` }, { status: 503 });
  const redirectUri = `${new URL(request.url).origin}/api/integrations/gmail/callback`;
  return NextResponse.redirect(createGoogleAuthorization({ organizationId: profile.organization_id!, userId: profile.id, redirectUri }));
}
