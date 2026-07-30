import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import ReviewForm from "@/components/ReviewForm";
import CustomerEditForm from "@/components/CustomerEditForm";
import CopyLinkButton from "@/components/CopyLinkButton";
import DocForm from "@/components/DocForm";
import { createEstimate } from "@/app/(app)/estimates/actions";
import { createInvoice } from "@/app/(app)/invoices/actions";
import ActivityTimeline from "@/components/ActivityTimeline";
import { loadActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
const tel = (p?: string | null) => "tel:" + (p ?? "").replace(/[^0-9+]/g, "");

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const locale = (await getLocale());
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  if (!c) return <div><Link href="/customers" style={back}>‹ Customers</Link><div style={{ padding: 40, textAlign: "center", color: "#5c6675" }}>Customer not found.</div></div>;
  const activity = await loadActivity("customers", id);

  const [{ data: jobs }, { data: invoices }, { data: estimates }, { data: reviews }, { data: catalog }] = await Promise.all([
    supabase.from("jobs").select("id, service, scheduled_date, price_minor, status").eq("customer_id", id).is("deleted_at", null).order("scheduled_date", { ascending: false }),
    supabase.from("invoices").select("total_minor, status").eq("customer_id", id).is("deleted_at", null),
    supabase.from("estimates").select("id").eq("customer_id", id).is("deleted_at", null),
    supabase.from("reviews").select("id, rating, body, review_date").eq("customer_id", id).order("review_date", { ascending: false }),
    supabase.from("price_book").select("id, name, description, price_minor, cost_minor, taxable, image_path").order("name"),
  ]);
  const custOpt = [{ id: c.id, label: c.name }];

  const revenue = (invoices ?? []).filter((i) => i.status === "paid").reduce((s, i) => s + i.total_minor, 0);
  const revs = reviews ?? [];
  const avg = revs.length ? revs.reduce((s, r) => s + r.rating, 0) / revs.length : 0;
  const stars = (n: number) => "★".repeat(Math.round(n)) + "☆".repeat(5 - Math.round(n));

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/customers" style={back}>‹ Customers</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, margin: "8px 0 2px" }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{c.name}</h1>
        <CustomerEditForm customer={c as any} />
      </div>
      <p style={{ color: "#5c6675", marginBottom: 14 }}>{[c.city, c.source].filter(Boolean).join(" · ")}</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <DocForm locale={locale} customers={custOpt} action={createEstimate} newKey="est.new" catalog={catalog ?? []} orgId={profile.organization_id!} />
        <DocForm locale={locale} customers={custOpt} action={createInvoice} newKey="inv.new" catalog={catalog ?? []} orgId={profile.organization_id!} />
        {c.portal_token && <CopyLinkButton path={`/portal/${c.portal_token}`} label="🔗 Portal link" />}
      </div>

      <div style={{ display: "flex", gap: 18, justifyContent: "center", margin: "10px 0 18px" }}>
        <Action href={tel(c.phone)} icon="📞" label="Call" />
        <Action href={"sms:" + (c.phone ?? "")} icon="💬" label="Text" />
        <Action href={"https://maps.google.com/?q=" + encodeURIComponent([c.address, c.city].filter(Boolean).join(", "))} icon="🧭" label="Navigate" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 18 }}>
        <Kpi value={String((jobs ?? []).length)} label="Jobs" />
        <Kpi value={money(revenue, cur)} label="Revenue" tone="#15803d" />
        <Kpi value={avg ? avg.toFixed(1) : "—"} label={`${revs.length} reviews`} tone="#eab308" />
      </div>

      {(c.email || c.address || c.phone || c.billing_address) && (
        <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 14, display: "grid", gap: 4 }}>
          {c.phone && <div>📞 {c.phone}</div>}
          {c.email && <div>✉️ {c.email}</div>}
          {(c.address || c.city) && <div>📍 <b style={{ fontWeight: 700 }}>Service:</b> {[c.address, c.city].filter(Boolean).join(", ")}</div>}
          {(c.billing_address || c.billing_city)
            ? <div>🧾 <b style={{ fontWeight: 700 }}>Billing:</b> {[c.billing_address, c.billing_city].filter(Boolean).join(", ")}</div>
            : (c.address || c.city) && <div style={{ color: "#5c6675" }}>🧾 <b style={{ fontWeight: 700 }}>Billing:</b> same as service</div>}
          {c.notes && <div style={{ color: "#5c6675", marginTop: 6 }}>{c.notes}</div>}
        </div>
      )}

      <h3 style={h3}>Job history ({(jobs ?? []).length})</h3>
      <div className="rlist">
        {(jobs ?? []).map((j) => (
          <Link key={j.id} href={`/jobs/${j.id}`} className="ritem">
            <div className="rmain"><div className="rtitle">{j.service}</div><div className="rsub">{fmtDate(j.scheduled_date)} · {j.status}</div></div>
            <div className="rend"><b>{money(j.price_minor, cur)}</b></div>
          </Link>
        ))}
        {(jobs ?? []).length === 0 && <div className="rempty">No jobs yet</div>}
      </div>

      <h3 style={h3}>Reviews {avg ? <span style={{ color: "#eab308" }}>{stars(avg)}</span> : null}</h3>
      <ReviewForm customerId={id} />
      {revs.map((r) => (
        <div key={r.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginBottom: 8 }}>
          <div style={{ color: "#eab308" }}>{stars(r.rating)}</div>
          {r.body && <div style={{ fontSize: 14, marginTop: 3 }}>{r.body}</div>}
          <div style={{ fontSize: 14, color: "#5c6675", marginTop: 3 }}>{fmtDate(r.review_date)}</div>
        </div>
      ))}
      <ActivityTimeline entries={activity} locale={locale} />
    </div>
  );
}

function Action({ href, icon, label }: { href: string; icon: string; label: string }) {
  return <a href={href} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, color: "#2563eb", textDecoration: "none", fontSize: 14, fontWeight: 600 }}><span style={{ width: 48, height: 48, borderRadius: "50%", background: "#e0ebff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{icon}</span>{label}</a>;
}
function Kpi({ value, label, tone }: { value: string; label: string; tone?: string }) {
  return <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}><div style={{ fontSize: 20, fontWeight: 800, color: tone ?? "#0b1524" }}>{value}</div><div style={{ fontSize: 14, color: "#5c6675", fontWeight: 600 }}>{label}</div></div>;
}
const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" };
const h3: React.CSSProperties = { fontSize: 16, fontWeight: 800, margin: "18px 0 8px" };
