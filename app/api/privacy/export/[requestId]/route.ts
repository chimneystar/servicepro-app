import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  if (!profile || profile.role !== "owner")
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
  const [
    { data: customer },
    { data: jobs },
    { data: estimates },
    { data: invoices },
    { data: messages },
    { data: sms },
    { data: consents },
    { data: calls },
  ] = await Promise.all([
    supabase.from("customers").select("*").eq("id", customerId).single(),
    supabase.from("jobs").select("*").eq("customer_id", customerId),
    supabase
      .from("estimates")
      .select("*,estimate_items!estimate_items_estimate_id_fkey(*)")
      .eq("customer_id", customerId),
    supabase
      .from("invoices")
      .select("*,invoice_items!invoice_items_invoice_id_fkey(*)")
      .eq("customer_id", customerId),
    supabase.from("messages").select("*").eq("customer_id", customerId),
    supabase
      .from("sms_messages")
      .select("id,to_phone,body,status,created_at,sent_at")
      .eq("customer_id", customerId),
    supabase
      .from("consent_events")
      .select("channel,purpose,granted,source,policy_version,proof,recorded_at")
      .eq("customer_id", customerId)
      .order("recorded_at"),
    supabase
      .from("call_events")
      .select(
        "direction,status,from_number,to_number,reason,outcome,notes,recording_consent,started_at,answered_at,ended_at,duration_seconds",
      )
      .eq("customer_id", customerId)
      .order("started_at"),
  ]);
  const invoiceIds = (invoices ?? []).map((row) => row.id);
  const { data: payments } = invoiceIds.length
    ? await supabase
        .from("payments")
        .select(
          "id,invoice_id,amount_minor,currency,status,provider,normalized_status,refunded_minor,paid_at,settled_at,created_at",
        )
        .in("invoice_id", invoiceIds)
    : { data: [] };
  const payload = {
    exportedAt: new Date().toISOString(),
    request: {
      id: privacyRequest.id,
      type: privacyRequest.request_type,
      receivedAt: privacyRequest.received_at,
    },
    customer,
    jobs: jobs ?? [],
    estimates: estimates ?? [],
    invoices: invoices ?? [],
    payments: payments ?? [],
    messages: messages ?? [],
    smsMessages: sms ?? [],
    calls: calls ?? [],
    consentHistory: consents ?? [],
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
