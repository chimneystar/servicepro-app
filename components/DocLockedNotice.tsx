import Link from "next/link";

/**
 * Shown instead of the editor when a document's figures are locked (6a.5).
 *
 * The point is that it names the remedy. A lock the user cannot get past, with
 * no stated way forward, is how people end up editing rows in the database by
 * hand — which is the outcome this whole item exists to prevent.
 */
export default function DocLockedNotice({ kind, id, number, reason }: {
  kind: "estimate" | "invoice"; id: string; number: number; reason: string;
}) {
  const base = kind === "estimate" ? "/estimates" : "/invoices";
  const label = kind === "estimate" ? "Estimate" : "Invoice";
  return (
    <div style={{ maxWidth: 640 }}>
      <Link href={`${base}/${id}`} style={{ color: "#2563eb", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}>‹ Back</Link>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "8px 0 14px" }}>{label} #{number} is locked</h1>
      <div style={{ background: "#fdf1dc", border: "1px solid #f5d99b", borderRadius: 12, padding: "14px 16px", color: "#7c4a03", fontSize: "0.875rem", lineHeight: 1.6 }}>
        {reason}
      </div>
      <p style={{ fontSize: "0.8125rem", color: "#5c6675", marginTop: 12, lineHeight: 1.6 }}>
        The figures the customer was shown stay exactly as they were shown. That is
        the point: a correction is its own record, not a quiet rewrite of the old one.
      </p>
      <Link href={`${base}/${id}`} style={{ display: "inline-block", marginTop: 14, background: "#2563eb", color: "#fff", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: "0.875rem", textDecoration: "none" }}>
        Open {label.toLowerCase()} #{number}
      </Link>
    </div>
  );
}
