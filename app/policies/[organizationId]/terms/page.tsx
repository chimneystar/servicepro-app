import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function MessagingTermsPage({ params }: { params: { organizationId: string } }) {
  let organization: any = null;
  try {
    const admin = createAdminClient();
    const result = await admin.from("organizations").select("name, email, phone").eq("id", params.organizationId).maybeSingle();
    organization = result.data;
  } catch { /* render a safe generic policy */ }
  const name = organization?.name ?? "This service business";
  return <main style={{ maxWidth: 720, margin: "40px auto", padding: 24, background: "#fff", borderRadius: 16, lineHeight: 1.65 }}>
    <h1>{name} SMS Terms</h1><p style={{ color: "#64748b", fontSize: 13 }}>Last updated July 27, 2026</p>
    <p>By providing a mobile number and consenting to messages from {name}, customers agree to receive service-related texts such as appointment updates, technician arrival notices, estimates, invoices, and replies to customer questions.</p>
    <p>Message frequency varies. Message and data rates may apply. Consent to text messaging is not a condition of purchase. Reply STOP to opt out, START to opt back in, or HELP for help.</p>
    <p>For assistance, contact {organization?.email ?? organization?.phone ?? name}. Carriers are not liable for delayed or undelivered messages.</p>
  </main>;
}
