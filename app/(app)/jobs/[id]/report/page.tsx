import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { money, fmtDate } from "@/lib/format";
import Link from "next/link";
import PrintButton from "@/components/PrintButton";
import * as jobsData from "@/lib/data/jobs";

export const dynamic = "force-dynamic";

export default async function JobReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select(
      "id, service, scheduled_date, price_minor, notes, on_my_way_at, started_at, completed_at, completion_signature, completion_signed_by, customers!jobs_customer_id_fkey(name, phone, address, city), profiles!jobs_assigned_to_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  const { data: org } = await supabase
    .from("organizations")
    .select("name, logo_url, accent_color, phone, email, currency, document_footer")
    .single();
  if (!job) return <div style={{ padding: 40 }}>Job not found.</div>;

  // customer_visible is honoured here. The column has existed since migration
  // 019 with a default of true, was selected on the job page, passed into the
  // component — and used by nothing. This report is the CUSTOMER-facing artifact
  // (it is printed and handed over), so an internal photo taken as evidence or a
  // note to the office was shown to them regardless.
  const rows = await jobsData.listCustomerVisiblePhotos(supabase, id);
  const photos = await Promise.all(
    rows.map(async (r) => {
      const { data } = await supabase.storage
        .from("job-photos")
        .createSignedUrl(r.storage_path, 3600);
      return { url: data?.signedUrl ?? null, label: r.label };
    }),
  );

  const c: any = job.customers;
  const accent = org?.accent_color || "#2563eb";
  const t = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div style={{ minHeight: "100vh", background: "#eef3fb", padding: "18px 14px" }}>
      <div
        className="no-print"
        style={{
          maxWidth: 720,
          margin: "0 auto 10px",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <Link href={`/jobs/${id}`} className="sp-link">
          ‹ Back to job
        </Link>
        <PrintButton label="Save as PDF" />
      </div>

      <div
        className="print-card"
        style={{
          maxWidth: 720,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(15,42,94,.14)",
        }}
      >
        <div
          style={{
            background: accent,
            color: "#fff",
            padding: "22px 26px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "rgba(255,255,255,.18)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.5rem",
                overflow: "hidden",
              }}
            >
              {org?.logo_url ? (
                <img
                  src={org.logo_url}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                "❄️"
              )}
            </div>
            <div>
              <div style={{ fontSize: "1.125rem", fontWeight: 800 }}>{org?.name}</div>
              <div style={{ fontSize: "0.8125rem", opacity: 0.9 }}>
                {[org?.phone, org?.email].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "end" }}>
            <div style={{ fontSize: "1.25rem", fontWeight: 800 }}>JOB REPORT</div>
          </div>
        </div>

        <div style={{ padding: "22px 26px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div>
              <div style={cap}>Customer</div>
              <div style={{ fontSize: "1rem", fontWeight: 800 }}>{c?.name}</div>
              <div className="sp-text-muted">
                {[c?.address, c?.city].filter(Boolean).join(", ")}
              </div>
              <div className="sp-text-muted">{c?.phone}</div>
            </div>
            <div style={{ textAlign: "end" }}>
              <div style={cap}>Service</div>
              <div style={{ fontSize: "1rem", fontWeight: 800 }}>{job.service}</div>
              <div className="sp-text-muted">{fmtDate(job.scheduled_date)}</div>
              <div className="sp-text-muted">Tech: {(job as any).profiles?.full_name || "—"}</div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <Kv label="On the way" value={t(job.on_my_way_at)} />
            <Kv label="Started" value={t(job.started_at)} />
            <Kv label="Completed" value={t(job.completed_at)} />
            <Kv label="Price" value={money(job.price_minor, org?.currency ?? "USD")} />
          </div>

          {job.notes && (
            <div
              style={{
                background: "#f8fafc",
                borderRadius: 10,
                padding: 12,
                fontSize: "0.8125rem",
                marginBottom: 16,
              }}
            >
              <b>Notes</b>
              <br />
              {job.notes}
            </div>
          )}

          {photos.length > 0 && (
            <>
              <div style={cap}>Photos</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))",
                  gap: 8,
                  margin: "6px 0 16px",
                }}
              >
                {photos.map(
                  (p, i) =>
                    p.url && (
                      <img
                        key={i}
                        src={p.url}
                        alt=""
                        style={{
                          width: "100%",
                          aspectRatio: "1",
                          objectFit: "cover",
                          borderRadius: 10,
                          border: "1px solid #e2e8f0",
                        }}
                      />
                    ),
                )}
              </div>
            </>
          )}

          <div style={{ borderTop: "1px solid #eef1f6", paddingTop: 14, marginTop: 6 }}>
            <div style={cap}>Customer approval</div>
            {job.completion_signature ? (
              <div>
                <img
                  src={job.completion_signature}
                  alt="signature"
                  style={{ height: 80, marginTop: 6 }}
                />
                <div style={{ fontSize: "0.8125rem", color: "#0b1524", fontWeight: 700 }}>
                  {job.completion_signed_by || "Signed"}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: "0.8125rem", color: "#94a3b8", marginTop: 6 }}>
                Not signed yet.
              </div>
            )}
          </div>
        </div>
        <div
          style={{
            background: "#f8fafc",
            borderTop: "1px solid #eef1f6",
            padding: "12px 26px",
            textAlign: "center",
            fontSize: "0.75rem",
            color: "#94a3b8",
          }}
        >
          {org?.document_footer || `${org?.name} · Thank you for your business!`}
        </div>
      </div>
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "9px 12px" }}>
      <div style={cap}>{label}</div>
      <div style={{ fontSize: "0.875rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
const cap: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#94a3b8",
  fontWeight: 800,
  letterSpacing: 0.5,
  textTransform: "uppercase",
};
