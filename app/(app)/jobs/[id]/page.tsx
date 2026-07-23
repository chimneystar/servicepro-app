import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import JobPhotos, { type Photo } from "@/components/JobPhotos";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const profile = await requireProfile();
  getLocale();
  const supabase = createClient();

  const { data: job } = await supabase
    .from("jobs")
    .select("id, service, status, price_minor, scheduled_date, start_time, end_time, notes, customers(name, phone, address, city), profiles!jobs_assigned_to_fkey(full_name)")
    .eq("id", params.id).is("deleted_at", null).maybeSingle();

  const { data: org } = await supabase.from("organizations").select("currency").single();
  const cur = org?.currency ?? "USD";

  if (!job) {
    return <div><Link href="/schedule" style={back}>‹ Schedule</Link><div style={{ padding: 40, textAlign: "center", color: "#5c6675" }}>Job not found.</div></div>;
  }

  const { data: rows } = await supabase.from("job_photos").select("id, storage_path, label").eq("job_id", params.id).order("created_at", { ascending: true });
  const photos: Photo[] = await Promise.all((rows ?? []).map(async (r) => {
    const { data } = await supabase.storage.from("job-photos").createSignedUrl(r.storage_path, 3600);
    return { id: r.id, path: r.storage_path, url: data?.signedUrl ?? null, label: r.label };
  }));

  const c: any = job.customers;
  const techName = (job as any).profiles?.full_name;

  return (
    <div style={{ maxWidth: 760 }}>
      <Link href="/schedule" style={back}>‹ Schedule</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 2px" }}>{job.service}</h1>
      <p style={{ color: "#5c6675", marginBottom: 16 }}>{c?.name ?? "—"}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 18 }}>
        <Item label="Date" value={`${fmtDate(job.scheduled_date)} · ${(job.start_time ?? "").slice(0, 5)}–${(job.end_time ?? "").slice(0, 5)}`} />
        <Item label="Technician" value={techName || "Unassigned"} />
        <Item label="Price" value={money(job.price_minor, cur)} />
        <Item label="Status" value={job.status} />
        <Item label="Phone" value={c?.phone || "—"} />
        <Item label="Address" value={[c?.address, c?.city].filter(Boolean).join(", ") || "—"} />
      </div>
      {job.notes && <div style={{ background: "#f4f7fb", borderRadius: 12, padding: "12px 14px", marginBottom: 18, fontSize: 14 }}><b style={{ fontSize: 12, color: "#5c6675" }}>Notes</b><br />{job.notes}</div>}

      <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>📷 Photos</h3>
      <JobPhotos jobId={job.id} orgId={profile.organization_id!} photos={photos} />
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 14px" }}>
      <div style={{ fontSize: 11.5, color: "#5c6675", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}
const back: React.CSSProperties = { color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" };
