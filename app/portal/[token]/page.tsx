import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

const SC: Record<string, string> = { draft: "#eef1f6|#57606f", sent: "#e0ebff|#2563eb", approved: "#e6f6ec|#15803d", rejected: "#fdeaea|#dc2626", unpaid: "#fdf1dc|#b45309", paid: "#e6f6ec|#15803d", scheduled: "#e0ebff|#2563eb", in_progress: "#fdf1dc|#b45309", done: "#e6f6ec|#15803d", cancelled: "#eef1f6|#57606f" };

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_customer_portal", { p_token: token });
  const d: any = data;
  if (!d) return <Wrap accent="#0f2a5e"><p style={{ color: "#5c6675" }}>This portal link is not valid.</p></Wrap>;

  const accent = d.org?.accent_color || "#2563eb";
  const cur = d.org?.currency ?? "USD";

  return (
    <Wrap accent={accent}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ background: accent, color: "#fff", borderRadius: "18px 18px 0 0", padding: "22px 24px", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: "rgba(255,255,255,.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, overflow: "hidden" }}>
            {d.org?.logo_url ? <img src={d.org.logo_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "❄️"}
          </div>
          <div><div style={{ fontSize: 19, fontWeight: 800 }}>{d.org?.name}</div><div style={{ fontSize: 13, opacity: .9 }}>Welcome back, {String(d.customer?.name ?? "").split(" ")[0]}</div></div>
        </div>
        <div style={{ background: "#fff", borderRadius: "0 0 18px 18px", padding: 20, boxShadow: "0 20px 60px rgba(15,42,94,.15)" }}>
          <Section title="Invoices">
            {(d.invoices ?? []).length === 0 ? <Empty /> : (d.invoices ?? []).map((x: any, i: number) => <Doc key={i} kind="Invoice" x={x} cur={cur} accent={accent} />)}
          </Section>
          <Section title="Estimates">
            {(d.estimates ?? []).length === 0 ? <Empty /> : (d.estimates ?? []).map((x: any, i: number) => <Doc key={i} kind="Estimate" x={x} cur={cur} accent={accent} />)}
          </Section>
          <Section title="Service history">
            {(d.jobs ?? []).length === 0 ? <Empty /> : (d.jobs ?? []).map((j: any, i: number) => (
              <div key={i} style={rowLine}><span style={{ flex: 1 }}>{j.service}</span><Pill s={j.status} /><span style={{ fontSize: 12.5, color: "#5c6675", minWidth: 92, textAlign: "end" }}>{j.date}</span></div>
            ))}
          </Section>
          <p style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, marginTop: 8 }}>Questions? Call {d.org?.phone || d.org?.email}.</p>
        </div>
      </div>
    </Wrap>
  );
}

function Doc({ kind, x, cur, accent }: { kind: string; x: any; cur: string; accent: string }) {
  return (
    <a href={`/p/${x.token}`} target="_blank" style={{ ...rowLine, textDecoration: "none", color: "inherit" }}>
      <span style={{ flex: 1 }}>{kind} #{x.number}</span>
      <b style={{ color: accent }}>{money(x.total_minor, cur)}</b>
      <Pill s={x.status} />
    </a>
  );
}
function Pill({ s }: { s: string }) { const [bg, fg] = (SC[s] ?? "#eef1f6|#57606f").split("|"); return <span style={{ background: bg, color: fg, padding: "3px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 700 }}>{s}</span>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <div style={{ marginBottom: 14 }}><h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{title}</h3>{children}</div>; }
function Empty() { return <div style={{ color: "#94a3b8", fontSize: 13, padding: "6px 0" }}>Nothing here yet.</div>; }
function Wrap({ children, accent }: { children: React.ReactNode; accent: string }) {
  return <div style={{ minHeight: "100vh", background: "#eef3fb", borderTop: `5px solid ${accent}`, display: "flex", justifyContent: "center", padding: "24px 14px" }}>{children}</div>;
}
const rowLine: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid #f1f4f9" };
