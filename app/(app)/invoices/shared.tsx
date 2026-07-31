import { t, type Locale } from "@/lib/i18n";

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
export function fmtMoney(minor: number, currency: string) {
  const sym = SYM[currency] ?? "$";
  return (
    sym +
    ((minor ?? 0) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

const STATUS_COLOR: Record<string, string> = {
  draft: "#eef1f6|#57606f",
  sent: "#e0ebff|#2563eb",
  approved: "#e6f6ec|#15803d",
  rejected: "#fdeaea|#dc2626",
  unpaid: "#fdf1dc|#b45309",
  paid: "#e6f6ec|#15803d",
  void: "#eef1f6|#57606f",
};

export function DocTable({
  rows,
  locale,
  currency,
  emptyKey,
  statusPrefix,
}: {
  rows: any[];
  locale: Locale;
  currency: string;
  emptyKey: string;
  statusPrefix: "dst" | "ist";
}) {
  return (
    <div className="rlist">
      {rows.map((r) => {
        const [bg, fg] = (STATUS_COLOR[r.status] ?? "#eef1f6|#57606f").split("|");
        return (
          <div className="ritem" key={r.id}>
            <div className="rmain">
              <div className="rtitle">
                #{r.number} · {r.customers?.name ?? "—"}
              </div>
              <div className="rsub">{fmtDate(r.issue_date)}</div>
            </div>
            <div className="rend">
              <b style={{ fontSize: "0.9375rem" }}>{fmtMoney(r.total_minor, currency)}</b>
              <span className="pill" style={{ background: bg, color: fg }}>
                {t(locale, `${statusPrefix}.${r.status}`)}
              </span>
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="rempty">{t(locale, emptyKey)}</div>}
    </div>
  );
}
