import { NextResponse, type NextRequest } from "next/server";
// @ts-ignore -- pure logic, proven both ways in tests/invitations.test.mjs
import { isValidInvitationToken } from "@/lib/core/invitations.mjs";

export const dynamic = "force-dynamic";

/**
 * The invitation link's landing point.
 *
 * Invitations previously carried a token that NOTHING ever used: no email was
 * sent, and acceptance matched on email alone. The emailed link now lands here,
 * the token is parked in an httpOnly cookie, and `/onboarding` redeems it
 * through `accept_invitation(token)`.
 *
 * The cookie is httpOnly and SameSite=Lax so the token is not readable by page
 * scripts and is not sent from a third-party context. Nothing is granted here:
 * the token still has to match an open invitation whose email is the signed-in
 * user's, which is checked in the database, not here.
 */
export async function GET(request: NextRequest) {
  const token = (request.nextUrl.searchParams.get("token") ?? "").trim();
  const destination = new URL("/", request.nextUrl.origin);

  if (!isValidInvitationToken(token)) {
    // A malformed link must not look like it worked.
    destination.searchParams.set("invite", "invalid");
    return NextResponse.redirect(destination);
  }

  const response = NextResponse.redirect(destination);
  response.cookies.set("invite_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // the invitation itself expires in 7 days
  });
  return response;
}
