import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { exchangeGoogleCode, gmailCredentialPayload, gmailProfile, registerGmailWatch } from "@/lib/integrations/gmail";
import { verifyState } from "@/lib/integrations/crypto";
import { saveConnection } from "@/lib/integrations/connections";

export const dynamic = "force-dynamic";

type OAuthState = { organizationId: string; userId: string; redirectUri: string; verifier: string; exp: number };

export async function GET(request: NextRequest) {
  const profile = await requireProfile();
  assertRole(profile, ["owner"]);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateText = url.searchParams.get("state");
  if (!code || !stateText || url.searchParams.get("error")) return NextResponse.redirect(new URL("/settings/integrations?gmail=cancelled", url.origin));
  try {
    const state = verifyState<OAuthState>(stateText);
    if (state.organizationId !== profile.organization_id || state.userId !== profile.id || state.redirectUri !== `${url.origin}/api/integrations/gmail/callback`) throw new Error("OAuth account mismatch");
    const token = await exchangeGoogleCode({ code, redirectUri: state.redirectUri, verifier: state.verifier });
    const googleProfile = await gmailProfile(token.access_token);
    const client = createClient();
    let connection = await saveConnection(client, {
      organizationId: profile.organization_id!,
      provider: "gmail",
      status: "connected",
      externalAccountId: googleProfile.emailAddress,
      encryptedCredentials: gmailCredentialPayload(token.refresh_token, googleProfile.emailAddress),
      metadata: { email: googleProfile.emailAddress, history_id: googleProfile.historyId },
      connectedBy: profile.id,
    });
    try {
      const watch = await registerGmailWatch(connection);
      connection = await saveConnection(client, {
        organizationId: profile.organization_id!, provider: "gmail", status: "connected",
        externalAccountId: connection.external_account_id, encryptedCredentials: connection.encrypted_credentials,
        metadata: { ...connection.metadata, email: googleProfile.emailAddress, history_id: watch.historyId, watch_expiration: watch.expiration },
        connectedBy: profile.id,
      });
    } catch (watchError: any) {
      await saveConnection(client, {
        organizationId: profile.organization_id!, provider: "gmail", status: "action_required",
        externalAccountId: connection.external_account_id, encryptedCredentials: connection.encrypted_credentials,
        metadata: connection.metadata, errorMessage: `Mailbox connected, but reply sync needs attention: ${String(watchError?.message ?? watchError).slice(0, 180)}`,
        connectedBy: profile.id,
      });
    }
    return NextResponse.redirect(new URL("/settings/integrations?gmail=connected", url.origin));
  } catch (error: any) {
    return NextResponse.redirect(new URL(`/settings/integrations?gmail=error&message=${encodeURIComponent(String(error?.message ?? error).slice(0, 120))}`, url.origin));
  }
}
