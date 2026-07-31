import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import ExportClient from "./ExportClient";
// @ts-ignore — pure, unit-tested manifest (tests/business-export.test.mjs)
import { exportContract } from "@/lib/core/export-manifest.mjs";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const contract = exportContract() as {
    tableCount: number;
    excluded: { table: string; reason: string }[];
    notIncluded: string[];
    redactedColumns: string[];
  };

  return (
    <div>
      <Link href="/reports" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Reports</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 4px" }}>Export your data</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 16 }}>Download your books for QuickBooks or your accountant — or take a complete copy of the whole business.</p>

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "18px 0 8px", color: "#0f2a5e" }}>Accounting export</h2>
      <ExportClient />

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: "26px 0 8px", color: "#0f2a5e" }}>Whole-business export</h2>
      {profile.role !== "owner" ? (
        <div style={{ maxWidth: 560, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, color: "#5c6675", fontSize: 13 }}>
          A complete copy of the business — every customer, message, payment and audit entry in one file — can only be
          downloaded by the owner.
        </div>
      ) : (
        <div style={{ maxWidth: 560, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
          <p style={{ fontSize: 13, color: "#334155", marginBottom: 12, lineHeight: 1.55 }}>
            One JSON file containing <b>every one of the {contract.tableCount} database tables your business owns</b> — customers,
            jobs, estimates, invoices, line items, payments, refunds, expenses, inventory, purchase orders, messages, calls,
            consent history, settings and the full audit trail. It is <b>paginated</b>, so it does not stop at 1,000 rows the way
            an ordinary query does.
          </p>

          <a
            href="/api/export/business"
            download
            style={{ display: "block", textAlign: "center", background: "#2563eb", color: "#fff", borderRadius: 10, padding: "12px 16px", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
          >
            ⬇ Download everything (.json)
          </a>

          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#7c2d12", borderRadius: 12, padding: "11px 14px", fontSize: 12.5, marginTop: 14, lineHeight: 1.55 }}>
            <b>What this file does NOT include</b>
            <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
              {contract.notIncluded.map((line) => (<li key={line} style={{ marginBottom: 4 }}>{line}</li>))}
            </ul>
          </div>

          <div style={{ color: "#5c6675", fontSize: 12.5, marginTop: 12, lineHeight: 1.55 }}>
            <b>Tables left out on purpose:</b>{" "}
            {contract.excluded.map((entry) => `${entry.table} — ${entry.reason}`).join(" ")}
          </div>

          <div style={{ color: "#5c6675", fontSize: 12.5, marginTop: 10, lineHeight: 1.55 }}>
            The export can be large and may take a few minutes. When it finishes, open the file and check that{" "}
            <code style={{ background: "#f1f5f9", borderRadius: 4, padding: "1px 5px" }}>meta.status</code>{" "}
            at the end reads <b>complete</b>. If the file will not open as JSON the download was interrupted — start it again.
          </div>
        </div>
      )}
    </div>
  );
}
