"use client";

export default function PrintButton({ label }: { label: string }) {
  return (
    <button onClick={() => window.print()} className="no-print"
      style={{ background: "#fff", color: "#2563eb", border: "1px solid #cdd8ea", borderRadius: 10, padding: "8px 14px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
      🖨️ {label}
    </button>
  );
}
