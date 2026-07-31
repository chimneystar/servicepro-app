"use client";

export type TSRow = { tech: string; date: string; service: string; hours: string };

export default function TimesheetExport({ rows, filename }: { rows: TSRow[]; filename: string }) {
  function download() {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csv = ["Technician,Date,Job,Hours", ...rows.map((r) => [r.tech, r.date, r.service, r.hours].map(esc).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
  return <button onClick={download} disabled={rows.length === 0} style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontWeight: 700, fontSize: "0.875rem", cursor: rows.length ? "pointer" : "not-allowed", opacity: rows.length ? 1 : .5 }}>⬇ Export payroll CSV</button>;
}
