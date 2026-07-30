import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const search = await searchParams;
  await requireProfile();
  const q = (search.q ?? "").trim();
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  let customers: any[] = [], jobs: any[] = [], invoices: any[] = [], estimates: any[] = [];
  const num = parseInt(q.replace(/[^0-9]/g, ""), 10);
  if (q) {
    const like = `%${q}%`;
    const cRes = await supabase.from("customers").select("id, name, phone, city").is("deleted_at", null).eq("archived", false).or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like},city.ilike.${like}`).limit(20);
    customers = cRes.data ?? [];
    const jRes = await supabase.from("jobs").select("id, service, stage, scheduled_date, customers(name)").is("deleted_at", null).ilike("service", like).limit(20);
    jobs = jRes.data ?? [];
    if (!Number.isNaN(num)) {
      const iRes = await supabase.from("invoices").select("id, number, total_minor, status, customers(name)").is("deleted_at", null).eq("number", num).limit(10);
      invoices = iRes.data ?? [];
      const eRes = await supabase.from("estimates").select("id, number, total_minor, status, customers(name)").is("deleted_at", null).eq("number", num).limit(10);
      estimates = eRes.data ?? [];
    }
  }
  const total = (customers?.length ?? 0) + (jobs?.length ?? 0) + (invoices?.length ?? 0) + (estimates?.length ?? 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Search</h1>
      <p style={{ color: "#5c6675", fontSize: 14, marginBottom: 16 }}>{q ? `${total} result${total === 1 ? "" : "s"} for “${q}”` : "Type in the top search bar to find anything."}</p>

      {(customers?.length ?? 0) > 0 && <Section title="Clients">
        {customers!.map((c) => <Row key={c.id} href={`/customers/${c.id}`} title={c.name} sub={[c.phone, c.city].filter(Boolean).join(" · ")} />)}
      </Section>}
      {(jobs?.length ?? 0) > 0 && <Section title="Jobs">
        {jobs!.map((j) => <Row key={j.id} href={`/jobs/${j.id}`} title={`${j.customers?.name ?? "—"} · ${j.service}`} sub={`${j.stage} · ${j.scheduled_date}`} />)}
      </Section>}
      {(invoices?.length ?? 0) > 0 && <Section title="Invoices">
        {invoices!.map((i) => <Row key={i.id} href={`/invoices/${i.id}`} title={`Invoice #${i.number} · ${i.customers?.name ?? "—"}`} sub={`${money(i.total_minor, cur)} · ${i.status}`} />)}
      </Section>}
      {(estimates?.length ?? 0) > 0 && <Section title="Estimates">
        {estimates!.map((e) => <Row key={e.id} href={`/estimates/${e.id}`} title={`Estimate #${e.number} · ${e.customers?.name ?? "—"}`} sub={`${money(e.total_minor, cur)} · ${e.status}`} />)}
      </Section>}
      {q && total === 0 && <div className="rempty">No matches. Try a name, phone, service, or document number.</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 16 }}><div style={{ fontWeight: 800, fontSize: 14, color: "#5c6675", textTransform: "uppercase", letterSpacing: .5, margin: "0 2px 6px" }}>{title}</div><div className="rlist">{children}</div></div>;
}
function Row({ href, title, sub }: { href: string; title: string; sub: string }) {
  return <Link className="ritem" href={href}><div className="rmain"><div className="rtitle">{title}</div><div className="rsub">{sub}</div></div><span style={{ color: "#b6bfcc", fontSize: 18 }}>›</span></Link>;
}
