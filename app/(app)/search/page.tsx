import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";
import { redirect } from "next/navigation";
import Link from "next/link";
// @ts-ignore — proven both ways in tests/postgrest-filter.test.mjs
import { orIlike, escapeLikePattern, quoteFilterValue } from "@/lib/core/postgrest-filter.mjs";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const search = await searchParams;
  // Global search spans customers, jobs and document numbers, so it is an
  // office-level tool. It previously only authenticated, matching no role at
  // all — and the route was absent from the preservation manifest entirely.
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/tech");
  const q = (search.q ?? "").trim();
  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  let customers: any[] = [],
    jobs: any[] = [],
    invoices: any[] = [],
    estimates: any[] = [];
  const num = parseInt(q.replace(/[^0-9]/g, ""), 10);
  if (q) {
    // The term is escaped before it reaches the filter expression. It used to be
    // interpolated raw, so a comma terminated the condition and injected another
    // — `a,archived.eq.true` defeated this page's own archived/deleted filters,
    // and ordinary punctuation ("Smith, John") produced a 500.
    const orExpr = orIlike(["name", "phone", "email", "city"], q);
    const likePattern = `%${escapeLikePattern(q)}%`;

    const cRes = await supabase
      .from("customers")
      .select("id, name, phone, city")
      .is("deleted_at", null)
      .eq("archived", false)
      .or(orExpr)
      .limit(20);
    customers = cRes.data ?? [];

    // Jobs match on the service text OR on the customer, which is how people
    // actually search ("find the Henderson job"). Matching the service
    // description alone missed that entirely. The customer ids come from the
    // query above, so this costs no extra lookup.
    const matchedCustomerIds = customers.map((c: any) => c.id);
    const jobFilters = [`service.ilike.${quoteFilterValue(likePattern)}`];
    if (matchedCustomerIds.length)
      jobFilters.push(`customer_id.in.(${matchedCustomerIds.join(",")})`);
    const jRes = await supabase
      .from("jobs")
      .select("id, service, stage, scheduled_date, customers!jobs_customer_org_fk(name)")
      .is("deleted_at", null)
      .or(jobFilters.join(","))
      .order("scheduled_date", { ascending: false })
      .limit(20);
    jobs = jRes.data ?? [];
    if (!Number.isNaN(num)) {
      const iRes = await supabase
        .from("invoices")
        .select("id, number, total_minor, status, customers!invoices_customer_org_fk(name)")
        .is("deleted_at", null)
        .eq("number", num)
        .limit(10);
      invoices = iRes.data ?? [];
      const eRes = await supabase
        .from("estimates")
        .select("id, number, total_minor, status, customers!estimates_customer_org_fk(name)")
        .is("deleted_at", null)
        .eq("number", num)
        .limit(10);
      estimates = eRes.data ?? [];
    }
  }
  const total =
    (customers?.length ?? 0) +
    (jobs?.length ?? 0) +
    (invoices?.length ?? 0) +
    (estimates?.length ?? 0);

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 4 }}>Search</h1>
      <p style={{ color: "#5c6675", fontSize: "0.875rem", marginBottom: 16 }}>
        {q
          ? `${total} result${total === 1 ? "" : "s"} for “${q}”`
          : "Type in the top search bar to find anything."}
      </p>

      {(customers?.length ?? 0) > 0 && (
        <Section title="Clients">
          {customers!.map((c) => (
            <Row
              key={c.id}
              href={`/customers/${c.id}`}
              title={c.name}
              sub={[c.phone, c.city].filter(Boolean).join(" · ")}
            />
          ))}
        </Section>
      )}
      {(jobs?.length ?? 0) > 0 && (
        <Section title="Jobs">
          {jobs!.map((j) => (
            <Row
              key={j.id}
              href={`/jobs/${j.id}`}
              title={`${j.customers?.name ?? "—"} · ${j.service}`}
              sub={`${j.stage} · ${j.scheduled_date}`}
            />
          ))}
        </Section>
      )}
      {(invoices?.length ?? 0) > 0 && (
        <Section title="Invoices">
          {invoices!.map((i) => (
            <Row
              key={i.id}
              href={`/invoices/${i.id}`}
              title={`Invoice #${i.number} · ${i.customers?.name ?? "—"}`}
              sub={`${money(i.total_minor, cur)} · ${i.status}`}
            />
          ))}
        </Section>
      )}
      {(estimates?.length ?? 0) > 0 && (
        <Section title="Estimates">
          {estimates!.map((e) => (
            <Row
              key={e.id}
              href={`/estimates/${e.id}`}
              title={`Estimate #${e.number} · ${e.customers?.name ?? "—"}`}
              sub={`${money(e.total_minor, cur)} · ${e.status}`}
            />
          ))}
        </Section>
      )}
      {q && total === 0 && (
        <div className="rempty">No matches. Try a name, phone, service, or document number.</div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontWeight: 800,
          fontSize: "0.875rem",
          color: "#5c6675",
          textTransform: "uppercase",
          letterSpacing: 0.5,
          margin: "0 2px 6px",
        }}
      >
        {title}
      </div>
      <div className="rlist">{children}</div>
    </div>
  );
}
function Row({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link className="ritem" href={href}>
      <div className="rmain">
        <div className="rtitle">{title}</div>
        <div className="rsub">{sub}</div>
      </div>
      <span style={{ color: "#b6bfcc", fontSize: "1.125rem" }}>›</span>
    </Link>
  );
}
