import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function MessagingPrivacyPage({ params }: { params: { organizationId: string } }) {
  let organization: any = null;
  try {
    const admin = createAdminClient();
    const result = await admin.from("organizations").select("name, email, phone").eq("id", params.organizationId).maybeSingle();
    organization = result.data;
  } catch { /* render a safe generic policy */ }
  const name = organization?.name ?? "This service business";
  return <Policy title={`${name} Messaging Privacy Policy`}>
    <p>{name} uses customer contact information to schedule and provide requested services, send estimates and invoices, answer customer questions, and send service-related updates.</p>
    <p>Mobile information, text-message opt-in records, and consent are not sold or shared with third parties for their own marketing. Service providers may process data only to deliver communications, payments, hosting, and customer support for {name}.</p>
    <p>Customers may reply STOP to opt out of text messages or contact {organization?.email ?? organization?.phone ?? name} to request access, correction, or deletion where applicable. Transactional records may be retained when required for accounting, fraud prevention, or legal compliance.</p>
  </Policy>;
}

function Policy({ title, children }: { title: string; children: React.ReactNode }) {
  return <main style={{ maxWidth: 720, margin: "40px auto", padding: 24, background: "#fff", borderRadius: 16, lineHeight: 1.65 }}><h1>{title}</h1><p style={{ color: "#64748b", fontSize: 13 }}>Last updated July 27, 2026</p>{children}</main>;
}
