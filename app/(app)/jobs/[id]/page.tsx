import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import JobPhotos, { type Photo } from "@/components/JobPhotos";
import JobActions from "@/components/JobActions";
import Tabs from "@/components/Tabs";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const profile = await requireProfile();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, service, status, price_minor, scheduled_date, start_time, end_time, notes, customer_id, customers(name, phone, address, city), profiles!jobs_assigned_to_fkey(full_name)")
    .eq("id", params.id).is("deleted_at", null).maybeSingle();
  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  if (!job) return <div><Link href="/schedule" style={back}>‹ Schedule</Link><div style={{ padding: 40, textAlign: "center", color: "#5c6675" }}>Job not found.</div></div>;

  const [{ data: rows }, { data: invoices }, { data: estimates }] = await Promise.all([
    supabase.from("job_photos").select("id, storage_path, label").eq("job_id", params.id).order("created_at"),
    supabase.from("invoices").select("id, number, total_minor, status, public_token").eq("job_id", params.id).is("deleted_at", null),
    supabase.from("estimates").select("id, number, total_minor, status, public_token").eq("customer_id", job.customer_id).is("deleted_at", null),
  ]);
  const photos: Photo[] = await Promise.all((rows ?? []).map(async (r) => {
    const { data } = await supabase.storage.from("job-photos").createSignedUrl(r.storage_path, 3600);
    return { id: r.id, path: r.storage_path, url: data?.signedUrl ?? null, label: r.label };
  }));

  const c: any = job.customers;
  const techName = (job as any).profiles?.full_name;
  const docCount = (invoices ?? []).length + (estimates ?? []).length;

  const Details = (
    <div>
      <div style={{ display: "flex", gap: 18, justifyContent: "center", margin: "2px 0 16px" }}>
        <a href={"tel:" + (c?.phone ?? "").replace(/[^0-9+]/g, "")} style={clink}>📞 Call</a>
        <a href={"sms:" + (c?.phone ?? "")} style={clink}>💬 Text</a>
        <a href={"https://maps.google.com/?q=" + encodeURIComponent([c?.address, c?.city].filter(Boolean).join(", "))} style={clink}>🧭 Navigate</a>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        <Item label="Client" value={c?.name ?? "—"} />
        <Item label="Technician" value={techName || "Unassigned"} />
        <Item label="When" value={`${fmtDate(job.scheduled_date)} · ${(job.start_time ?? "").slice(0, 5)}–${(job.end_time ?? "").slice(0, 5)}`} />
        <Item label="Price" value={money(job.price_minor, cur)} />
        <Item label="Phone" value={c?.phone || "—"} />
        <Item label="Address" value={[c?.address, c?.city].filter(Boolean).join(", ") || "—"} />
      </div>
      {job.notes && <div style={{ background: "#f4f7fb", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 14 }}><b style={{ fontSize: 12, color: "#5c6675" }}>Notes</b><br />{job.notes}</div>}
      <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 16 }}>
        <JobActions jobId={job.id} status={job.status} canInvoice={profile.role !== "tech"} />
      </div>
    </div>
  );

  const Documents = (
    <div className="rlist">
      {(invoices ?? []).map((d: any) => <DocRow key={"i" + d.id} kind="Invoice" d={d} cur={cur} />)}
      {(estimates ?? []).map((d: any) => <DocRow key={"e" + d.id} kind="Estimate" d={d} cur={cur} />)}
      {docCount === 0 && <div className="rempty">No documents yet. Use “Create invoice from job” in Details.</div>}
    </div>
  );

  const Photos = <JobPhotos jobId={job.id} orgId={profile.organization_id!} photos={photos} />;

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/schedule" style={back}>‹ Schedule</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 2px" }}>{job.service}</h1>
      <p style={{ color: "#5c6675", marginBottom: 14 }}>{c?.name ?? "—"}</p>
      <Tabs tabs={[
        { label: "Details", content: Details },
        { label: "Documents", badge: String(docCount), content: Documents },
        { label: "Photos", badge: String(photos.length), content: Photos },
      ]} />
    </div>
  );
}

function DocRow({ kind, d, cur }: { kind: string; d: any; cur: string }) {
  const colors: Record<string, string> = { draft: "#eef1f6|#57606f", sent: "#e0ebff|#2563eb", approved: "#e6f6ec|#15803d", rejected: "#fdeaea|#dc2626", unpaid: "#fdf1dc|#b45309", paid: "#e6f6ec|#15803d", void: "#eef1f6|#57606f" };
  const [bg, fg] = (colors[d.status] ?? "#eef1f6|#57606f").split("|");
  return (
    <a className="ritem" href={`/p/${d.public_token}`} target="_blank">
      <div className="rmain"><div className="rtitle">{kind} #{d.number}</div><div className="rsub">tap to open client link</div></div>
      <div className="rend"><b style={{ fontSize: 15 }}>{money(d.total_minor, cur)}</b><span className="pill" style={{ background: bg, color: fg }}>{d.status}</span></div>
    </a>
  );
}
function Item({ label, value }: { label: string; value: string }) {
  return <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 14px" }}><div style={{ fontSize: 11.5, color: "#5c6675", fontWeight: 700 }}>{label}</div><div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{value}</div></div>;
}
const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" };
const clink: React.CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 700, fontSize: 13.5 };
