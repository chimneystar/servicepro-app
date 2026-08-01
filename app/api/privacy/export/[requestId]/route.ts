import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as backendData from "@/lib/data/backend";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const { requestId } = await params,
    supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id,role")
    .eq("id", user.id)
    .single();
  // `organization_id` is nullable in `profiles` — a row exists between signup
  // and onboarding, and it defaults to role 'owner'. Such a user has no
  // organisation and therefore no privacy requests; the query below used to run
  // with a null filter, match nothing, and report the request as missing.
  if (!profile || !profile.organization_id || profile.role !== "owner")
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: privacyRequest } = await supabase
    .from("privacy_requests")
    .select("id,customer_id,request_type,identity_verified_at,status,requester_name,received_at")
    .eq("id", requestId)
    .eq("organization_id", profile.organization_id)
    .single();
  if (
    !privacyRequest ||
    !privacyRequest.customer_id ||
    !["access", "export"].includes(privacyRequest.request_type) ||
    !privacyRequest.identity_verified_at
  )
    return NextResponse.json({ error: "identity_verification_required" }, { status: 409 });
  const customerId = privacyRequest.customer_id;
  // A subject-access export is a legal document: a query error silently
  // treated as "no rows" here would produce an incomplete export with nothing
  // to say so — the exact defect the data layer exists to remove. Every read
  // below now THROWS on a query error instead, so this whole section is
  // wrapped and reported as a real failure rather than a quietly short export.
  let customer, jobs, estimates, invoices, messages, sms, consents, calls, payments;
  try {
    const { data: customerRow } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .single();
    customer = customerRow;
    [jobs, estimates, invoices, messages, sms, consents, calls] = await Promise.all([
      backendData.listAllJobsForCustomerExport(supabase, customerId),
      backendData.listAllEstimatesForCustomerExport(supabase, customerId),
      backendData.listAllInvoicesForCustomerExport(supabase, customerId),
      backendData.listAllMessagesForCustomerExport(supabase, customerId),
      backendData.listSmsForCustomerExport(supabase, customerId),
      backendData.listConsentEventsForCustomerExport(supabase, customerId),
      backendData.listCallEventsForCustomerExport(supabase, customerId),
    ]);
    const invoiceIds = invoices.map((row) => row.id);
    payments = await backendData.listPaymentsForInvoicesExport(supabase, invoiceIds);
  } catch (e: unknown) {
    console.error(
      `[privacy/export] could not assemble the export for request ${requestId}:`,
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    request: {
      id: privacyRequest.id,
      type: privacyRequest.request_type,
      receivedAt: privacyRequest.received_at,
    },
    customer,
    jobs,
    estimates,
    invoices,
    payments,
    messages,
    smsMessages: sms,
    calls,
    consentHistory: consents,
  };
  await supabase
    .from("privacy_requests")
    .update({ status: "ready", export_downloaded_at: new Date().toISOString() })
    .eq("id", requestId);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="servicepro-customer-export-${customerId.slice(0, 8)}.json"`,
      "cache-control": "no-store",
    },
  });
}
