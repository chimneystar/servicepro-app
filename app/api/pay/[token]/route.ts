import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createConnectedCheckout } from "@/lib/integrations/stripe-connect";

export const dynamic = "force-dynamic";

/** Public Pay now redirect. The charge is created directly on the invoice
 * owner's connected Stripe account; ServicePro never handles card data. */
export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  const origin = new URL(request.url).origin;
  const back = `${origin}/p/${params.token}`;
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.redirect(`${back}?payment=not-configured`);

  const isDeposit = new URL(request.url).searchParams.get("deposit") === "1";
  const client = createClient();
  const { data } = await client.rpc("public_document", { p_token: params.token });
  const doc: any = data;
  if (!doc) return NextResponse.redirect(back);

  const deposit = doc.deposit_minor ?? 0;
  const payingDeposit = isDeposit && doc.kind === "estimate" && deposit > 0;
  const payingInvoice = doc.kind === "invoice" && doc.status !== "paid" && doc.total_minor > 0;
  if (!payingDeposit && !payingInvoice) return NextResponse.redirect(back);

  try {
    const admin = createAdminClient();
    const table = payingDeposit ? "estimates" : "invoices";
    const { data: source } = await admin.from(table).select("id, organization_id").eq("public_token", params.token).maybeSingle();
    if (!source?.organization_id) return NextResponse.redirect(`${back}?payment=unavailable`);
    const { data: connection } = await admin.from("integration_connections")
      .select("external_account_id, status, metadata")
      .eq("organization_id", source.organization_id).eq("provider", "stripe").maybeSingle();
    if (!connection?.external_account_id || connection.status !== "connected" || connection.metadata?.charges_enabled !== true) {
      return NextResponse.redirect(`${back}?payment=business-setup-required`);
    }
    const amount = payingDeposit ? deposit : doc.total_minor;
    const label = payingDeposit ? `Deposit — Estimate #${doc.number}` : `Invoice #${doc.number}`;
    const session = await createConnectedCheckout({
      accountId: connection.external_account_id,
      amountMinor: amount,
      currency: doc.currency ?? "USD",
      description: `${doc.org?.name ?? "Service business"} — ${label}`,
      successUrl: `${back}?paid=1`,
      cancelUrl: back,
      metadata: {
        token: params.token,
        kind: payingDeposit ? "deposit" : "invoice",
        servicepro_organization_id: source.organization_id,
      },
    });
    return NextResponse.redirect(session.url);
  } catch {
    return NextResponse.redirect(`${back}?payment=error`);
  }
}
