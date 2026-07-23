import { t, type Locale } from "@/lib/i18n";

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

export function fmtMoney(minor: number, currency: string) {
  const sym = SYM[currency] ?? "$";
  return sym + ((minor ?? 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string) { if (!iso) return "—"; const d = new Date(iso + "T00:00:00"); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; }

const STATUS_COLOR: Record<string, string> = {
  draft: "#eef1f6|#57606f", sent: "#e0ebff|#2563eb", approved: "#e6f6ec|#15803d", rejected: "#fdeaea|#dc2626",
  unpaid: "#fdf1dc|#b45309", paid: "#e6f6ec|#15803d", void: "#eef1f6|#57606f",
};

export function DocTable({ rows, locale, currency, emptyKey, statusPrefix }: {
  rows: any[]; locale: Locale; currency: string; emptyKey: string; statusPrefix: "dst" | "ist";
}) {
  return (
    <div className="scroll-x" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 480 }}>
        <thead>
          <tr style={{ color: "#5c6675", fontSize: 12 }}>
            <Th>{t(locale, "doc.number")}</Th><Th>{t(locale, "doc.customer")}</Th>
            <Th>{t(locale, "doc.date")}</Th><Th>{t(locale, "doc.total")}</Th><Th>{t(locale, "doc.status")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [bg, fg] = (STATUS_COLOR[r.status] ?? "#eef1f6|#57606f").split("|");
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #eef1f6" }}>
                <Td><b>#{r.number}</b></Td>
                <Td>{r.customers?.name ?? "—"}</Td>
                <Td>{fmtDate(r.issue_date)}</Td>
                <Td><b>{fmtMoney(r.total_minor, currency)}</b></Td>
                <Td><span style={{ background: bg, color: fg, padding: "4px 11px", borderRadius: 20, fontSize: 12, fontWeight: 700 }}>{t(locale, `${statusPrefix}.${r.status}`)}</span></Td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><Td colSpan={5}><div style={{ textAlign: "center", padding: 40, color: "#5c6675" }}>{t(locale, emptyKey)}</div></Td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "11px 14px", borderBottom: "2px solid #e2e8f0", fontWeight: 700, textAlign: "start" }}>{children}</th>;
}
function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding: "12px 14px", textAlign: "start" }}>{children}</td>;
}
