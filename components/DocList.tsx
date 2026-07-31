"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { t, type Locale } from "@/lib/i18n";
import { convertEstimateToInvoice, markEstimateSent } from "@/app/(app)/estimates/actions";
import { setInvoicePaid, markInvoiceSent } from "@/app/(app)/invoices/actions";
import ShareDoc, { type ShareTarget } from "@/components/ShareDoc";

export type DocRow = {
  id: string;
  number: number;
  status: string;
  total_minor: number;
  issue_date: string;
  customer_name: string;
  public_token: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  /** Ledger 6a.1 — a voided document keeps its number and stays in the list. */
  voided_at?: string | null;
};

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };
const STATUS_COLOR: Record<string, string> = {
  draft: "#eef1f6|#57606f",
  sent: "#e0ebff|#2563eb",
  approved: "#e6f6ec|#15803d",
  rejected: "#fdeaea|#dc2626",
  unpaid: "#fdf1dc|#b45309",
  paid: "#e6f6ec|#15803d",
  void: "#eef1f6|#57606f",
};

export default function DocList({
  rows,
  locale,
  currency,
  kind,
  emptyKey,
  statusPrefix,
  orgName = "",
}: {
  rows: DocRow[];
  locale: Locale;
  currency: string;
  kind: "estimate" | "invoice";
  emptyKey: string;
  statusPrefix: "dst" | "ist";
  orgName?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [toast, setToast] = useState<{ text: string; href?: string } | null>(null);
  const [q, setQ] = useState("");
  const base = kind === "estimate" ? "/estimates" : "/invoices";
  const cur = SYM[currency] ?? "$";
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [String(r.number), r.customer_name, r.status].some((f) =>
        (f ?? "").toLowerCase().includes(s),
      ),
    );
  }, [q, rows]);
  const m = (v: number) =>
    cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (iso: string) => {
    if (!iso) return "—";
    const x = new Date(iso + "T00:00:00");
    return `${x.getDate()}/${x.getMonth() + 1}/${x.getFullYear()}`;
  };

  // Ledger 6a.5 — putting the public link in front of the customer is what
  // locks the figures. Same rule as components/DocDetailActions.tsx; recording
  // it in only one of the two places would leave the other as a quiet way to
  // send a document and keep editing it.
  function recordSent(r: DocRow) {
    if (r.voided_at) return;
    (kind === "estimate" ? markEstimateSent(r.id) : markInvoiceSent(r.id))
      .then(() => router.refresh())
      .catch(() => {});
  }
  function copyLink(r: DocRow) {
    const url = `${window.location.origin}/p/${r.public_token}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(r.public_token);
    setTimeout(() => setCopied(null), 1600);
    recordSent(r);
  }
  function convert(r: DocRow) {
    start(async () => {
      const res = await convertEstimateToInvoice(r.id);
      if (res.ok) {
        setToast({
          text: `✓ Estimate #${r.number} converted to Invoice #${res.invoiceNumber}`,
          href: "/invoices",
        });
        router.refresh();
      } else setToast({ text: res.error ?? "Could not convert" });
      setTimeout(() => setToast(null), 6000);
    });
  }
  function togglePaid(id: string, paid: boolean) {
    // Marking an invoice paid is a money change. A refused update used to leave
    // the row showing its old status with nothing to say the click had failed.
    start(async () => {
      const res = await setInvoicePaid(id, paid);
      if (!res.ok) {
        setToast({ text: res.error ?? "Could not update this invoice" });
        setTimeout(() => setToast(null), 6000);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rlist">
      {toast && (
        <div
          style={{
            background: toast.text.startsWith("✓") ? "#e6f6ec" : "#fdeaea",
            color: toast.text.startsWith("✓") ? "#15803d" : "#dc2626",
            padding: "12px 14px",
            borderRadius: 12,
            fontWeight: 700,
            fontSize: "0.875rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>{toast.text}</span>
          {toast.href && (
            <a
              href={toast.href}
              style={{
                color: "#15803d",
                fontWeight: 800,
                textDecoration: "underline",
                whiteSpace: "nowrap",
              }}
            >
              View →
            </a>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ position: "relative" }}>
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#94a3b8",
            }}
          >
            🔍
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by number, customer, or status…"
            aria-label="Search by number, customer, or status…"
            style={{
              width: "100%",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "11px 38px",
              fontSize: "1rem",
              outline: "none",
            }}
          />
        </div>
      )}
      {visible.map((r) => {
        const [bg, fg] = (STATUS_COLOR[r.status] ?? "#eef1f6|#57606f").split("|");
        return (
          <div className="ritem" key={r.id} style={{ flexWrap: "wrap" }}>
            <Link
              href={`${base}/${r.id}`}
              style={{
                display: "flex",
                flex: 1,
                gap: 10,
                alignItems: "center",
                minWidth: 0,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div className="rmain">
                <div className="rtitle">
                  #{r.number} · {r.customer_name}
                </div>
                <div className="rsub">{d(r.issue_date)}</div>
              </div>
              <div className="rend">
                <b
                  style={{
                    fontSize: "0.9375rem",
                    textDecoration: r.voided_at ? "line-through" : "none",
                    color: r.voided_at ? "#94a3b8" : undefined,
                  }}
                >
                  {m(r.total_minor)}
                </b>
                {r.voided_at ? (
                  <span className="pill" style={{ background: "#eef1f6", color: "#57606f" }}>
                    {t(locale, "ist.void")}
                  </span>
                ) : (
                  <span className="pill" style={{ background: bg, color: fg }}>
                    {t(locale, `${statusPrefix}.${r.status}`)}
                  </span>
                )}
              </div>
            </Link>
            <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 8, flexWrap: "wrap" }}>
              {!r.voided_at && (
                <button
                  type="button"
                  onClick={() => {
                    setShare({
                      kind,
                      number: r.number,
                      token: r.public_token,
                      customerName: r.customer_name,
                      customerEmail: r.customer_email ?? null,
                      customerPhone: r.customer_phone ?? null,
                      orgName,
                    });
                    recordSent(r);
                  }}
                  style={{ ...actBtn, background: "#2563eb", color: "#fff" }}
                >
                  <span aria-hidden="true">📤</span> Send
                </button>
              )}
              {!r.voided_at && (
                <button type="button" onClick={() => copyLink(r)} style={actBtn}>
                  {copied === r.public_token ? (
                    t(locale, "doc.copied")
                  ) : (
                    <>
                      <span aria-hidden="true">🔗</span> {t(locale, "doc.link")}
                    </>
                  )}
                </button>
              )}
              {kind === "estimate" && !r.voided_at && (
                <button
                  type="button"
                  onClick={() => convert(r)}
                  disabled={pending}
                  style={{ ...actBtn, background: "#e6f6ec", color: "#15803d" }}
                >
                  <span aria-hidden="true">🧾</span> {t(locale, "doc.to_invoice")}
                </button>
              )}
              {kind === "invoice" && r.status === "unpaid" && !r.voided_at && (
                <button
                  type="button"
                  onClick={() => togglePaid(r.id, true)}
                  disabled={pending}
                  style={{ ...actBtn, background: "#e6f6ec", color: "#15803d" }}
                >
                  <span aria-hidden="true">✓</span> Mark paid
                </button>
              )}
              {kind === "invoice" && r.status === "paid" && (
                <button
                  type="button"
                  onClick={() => togglePaid(r.id, false)}
                  disabled={pending}
                  style={actBtn}
                >
                  <span aria-hidden="true">↩</span> Mark due
                </button>
              )}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="rempty">{t(locale, emptyKey)}</div>}
      {rows.length > 0 && visible.length === 0 && (
        <div className="rempty">No matches for “{q}”.</div>
      )}
      {share && <ShareDoc target={share} onClose={() => setShare(null)} />}
    </div>
  );
}

const actBtn: React.CSSProperties = {
  background: "#eef2f8",
  color: "#2563eb",
  border: "none",
  borderRadius: 9,
  padding: "8px 12px",
  fontWeight: 700,
  fontSize: "0.8125rem",
  cursor: "pointer",
};
