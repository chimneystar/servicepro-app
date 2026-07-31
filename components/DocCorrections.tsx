"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionError, useActionStatus } from "@/components/ActionStatus";
import { voidInvoice, createCreditNote, voidCreditNote } from "@/app/(app)/invoices/actions";
import { voidEstimate, reopenEstimate } from "@/app/(app)/estimates/actions";
// @ts-ignore -- document integrity rules (JS module, unit-tested)
import { MIN_REASON_LENGTH } from "@/lib/core/documents.mjs";

export type CreditNoteRow = {
  id: string; number: number; amount_minor: number; reason: string;
  status: string; issue_date: string; cancel_reason: string | null;
};

const SYM: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€" };

/**
 * Correcting an issued document (ledger 6a.1).
 *
 * Before this, an issued invoice could only be edited in place — which rewrites
 * a document the customer already holds — or soft-deleted, which takes its
 * number out of the sequence. Neither is something an accountant can sign off.
 *
 * Two instruments, and the choice between them is not cosmetic:
 *
 *   VOID  cancels a document that should never have gone out. It is only
 *         offered while NOTHING has been collected. The document, its figures
 *         and its NUMBER all stay exactly where they are — so the sequence has
 *         no unexplained hole, it has a cancelled entry.
 *
 *   CREDIT NOTE reduces what the customer owes on an invoice that was correct
 *         enough to send but wrong in amount. It is its own dated, numbered,
 *         reasoned document; the invoice is not touched at all. This is the only
 *         correct instrument once money has changed hands.
 *
 * A credit note records a reduction in the debt. It does NOT move money — if
 * the customer already paid and it is going back, record the refund as well.
 */
export default function DocCorrections({
  kind, id, number, currency, totalMinor, creditedMinor, collectedMinor,
  voidedAt, voidReason, locked, lockReason, reopenable, creditNotes = [],
}: {
  kind: "estimate" | "invoice";
  id: string; number: number; currency: string;
  totalMinor: number; creditedMinor: number; collectedMinor: number;
  voidedAt: string | null; voidReason: string | null;
  locked: boolean; lockReason: string | null; reopenable: boolean;
  creditNotes?: CreditNoteRow[];
}) {
  const router = useRouter();
  const { pending, error, run } = useActionStatus();
  const [open, setOpen] = useState<"void" | "credit" | "reopen" | null>(null);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const cur = SYM[currency] ?? "$";
  const m = (v: number) => cur + (v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const billed = Math.max(0, totalMinor - creditedMinor);
  const remainingCreditable = billed;
  const shortReason = reason.trim().length < MIN_REASON_LENGTH;

  function close() { setOpen(null); setReason(""); setAmount(""); }
  function done() { close(); router.refresh(); }

  function doVoid() {
    run(() => (kind === "invoice" ? voidInvoice(id, reason) : voidEstimate(id, reason)), done);
  }
  function doCredit() {
    run(() => createCreditNote(id, amount, reason), done);
  }
  function doReopen() {
    run(() => reopenEstimate(id, reason), done);
  }
  function doCancelNote(noteId: string) {
    const why = window.prompt(`Why is credit note being cancelled? (at least ${MIN_REASON_LENGTH} characters)`);
    if (why === null) return;
    run(() => voidCreditNote(noteId, id, why), () => router.refresh());
  }

  if (voidedAt) {
    return (
      <div style={panel}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...pill, background: "#eef1f6", color: "#57606f" }}>VOID</span>
          <b style={{ fontSize: 14 }}>
            {/* ISO slice, not toLocaleDateString: a locale-less Intl call in a
                client component renders differently on the server and in the
                browser, which tests/hydration-guard.test.mjs exists to stop. */}
            {kind === "invoice" ? "Invoice" : "Estimate"} #{number} was voided on {String(voidedAt).slice(0, 10)}
          </b>
        </div>
        {voidReason && <div style={{ fontSize: 13, color: "#5c6675", marginTop: 6 }}>Reason: {voidReason}</div>}
        <div style={{ fontSize: 12.5, color: "#5c6675", marginTop: 8, lineHeight: 1.6 }}>
          The document and its number are kept on purpose, so the numbering has a
          cancelled entry rather than an unexplained gap. It can no longer be
          signed or paid. Duplicate it if a replacement is needed.
        </div>
        {creditNotes.length > 0 && <CreditList notes={creditNotes} m={m} onCancel={doCancelNote} pending={pending} />}
        <ActionError error={error} />
      </div>
    );
  }

  const canVoid = collectedMinor === 0;

  return (
    <div style={panel}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#334155", marginBottom: 8 }}>Corrections</div>

      {locked && lockReason && (
        <div style={{ background: "#fdf1dc", border: "1px solid #f5d99b", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, color: "#7c4a03", lineHeight: 1.6, marginBottom: 10 }}>
          {lockReason}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canVoid && (
          <button type="button" onClick={() => setOpen(open === "void" ? null : "void")} disabled={pending} style={{ ...btn, background: "#fdeaea", color: "#dc2626" }}>
            <span aria-hidden="true">⃠</span> Void {kind}
          </button>
        )}
        {kind === "invoice" && remainingCreditable > 0 && (
          <button type="button" onClick={() => setOpen(open === "credit" ? null : "credit")} disabled={pending} style={{ ...btn, background: "#e0ebff", color: "#2563eb" }}>
            <span aria-hidden="true">↩</span> Credit note
          </button>
        )}
        {kind === "estimate" && reopenable && (
          <button type="button" onClick={() => setOpen(open === "reopen" ? null : "reopen")} disabled={pending} style={btn}>
            <span aria-hidden="true">✎</span> Reopen for re-quoting
          </button>
        )}
      </div>

      {!canVoid && (
        <div style={{ fontSize: 12, color: "#5c6675", marginTop: 8, lineHeight: 1.6 }}>
          {m(collectedMinor)} has been collected against this document, so it cannot
          be voided — voiding says the sale never happened.{" "}
          {kind === "invoice" ? "Issue a credit note instead, and refund the money separately if it is going back." : "Refund the deposit first if the work is not going ahead."}
        </div>
      )}

      {open === "void" && (
        <Panel title={`Void ${kind} #${number}`} onCancel={close}>
          <p style={hint}>
            The document, its figures and its number are kept exactly as they are.
            It can no longer be signed or paid. This cannot be undone.
          </p>
          <Reason value={reason} onChange={setReason} />
          <button type="button" onClick={doVoid} disabled={pending || shortReason} style={{ ...btn, background: "#dc2626", color: "#fff", opacity: shortReason ? 0.5 : 1 }}>
            {pending ? "Voiding…" : "Void it"}
          </button>
        </Panel>
      )}

      {open === "credit" && (
        <Panel title={`Credit note against invoice #${number}`} onCancel={close}>
          <p style={hint}>
            Invoice {m(totalMinor)}{creditedMinor > 0 ? `, already credited ${m(creditedMinor)}` : ""} —{" "}
            up to <b>{m(remainingCreditable)}</b> can still be credited. The invoice
            itself is not changed; the credit note is its own numbered document.
          </p>
          <label style={{ display: "block" }}>
            <span style={lbl}>Amount to credit</span>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" style={inp} placeholder="0.00" />
          </label>
          <Reason value={reason} onChange={setReason} />
          <button type="button" onClick={doCredit} disabled={pending || shortReason || !amount} style={{ ...btn, background: "#2563eb", color: "#fff", opacity: shortReason || !amount ? 0.5 : 1 }}>
            {pending ? "Issuing…" : "Issue credit note"}
          </button>
        </Panel>
      )}

      {open === "reopen" && (
        <Panel title={`Reopen estimate #${number}`} onCancel={close}>
          <p style={hint}>
            This takes the estimate back to draft so it can be re-quoted. Who
            reopened it, when, and why are recorded on the estimate.
          </p>
          <Reason value={reason} onChange={setReason} />
          <button type="button" onClick={doReopen} disabled={pending || shortReason} style={{ ...btn, background: "#2563eb", color: "#fff", opacity: shortReason ? 0.5 : 1 }}>
            {pending ? "Reopening…" : "Reopen it"}
          </button>
        </Panel>
      )}

      {kind === "invoice" && creditNotes.length > 0 && (
        <CreditList notes={creditNotes} m={m} onCancel={doCancelNote} pending={pending} />
      )}

      <ActionError error={error} />
    </div>
  );
}

function CreditList({ notes, m, onCancel, pending }: {
  notes: CreditNoteRow[]; m: (v: number) => string; onCancel: (id: string) => void; pending: boolean;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#334155", marginBottom: 6 }}>Credit notes</div>
      {notes.map((n) => {
        const cancelled = n.status !== "issued";
        return (
          <div key={n.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, borderTop: "1px solid #eef2f8", padding: "8px 0" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, textDecoration: cancelled ? "line-through" : "none", color: cancelled ? "#94a3b8" : "#0b1524" }}>
                CN #{n.number} · {m(n.amount_minor)}
              </div>
              <div style={{ fontSize: 12, color: "#5c6675" }}>{n.issue_date} · {n.reason}</div>
              {cancelled && <div style={{ fontSize: 12, color: "#b45309" }}>Cancelled: {n.cancel_reason ?? "—"}</div>}
            </div>
            {!cancelled && (
              <button type="button" onClick={() => onCancel(n.id)} disabled={pending} style={{ ...btn, background: "#eef2f8", color: "#5c6675", padding: "6px 10px", fontSize: 12 }}>
                Cancel
              </button>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
        A credit note is never deleted. Cancelling one records the cancellation and
        its reason, so the credit-note sequence has no gaps either.
      </div>
    </div>
  );
}

function Panel({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: "#f8fbff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 12, marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <b style={{ fontSize: 13.5 }}>{title}</b>
        <button type="button" onClick={onCancel} aria-label="Close" style={{ ...btn, background: "transparent", color: "#5c6675", padding: "4px 6px" }}>✕</button>
      </div>
      {children}
    </div>
  );
}

function Reason({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span style={lbl}>Reason (kept on the record permanently)</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} style={inp}
        placeholder={`At least ${MIN_REASON_LENGTH} characters — e.g. "duplicate of #1043"`} />
    </label>
  );
}

const panel: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, marginBottom: 14 };
const btn: React.CSSProperties = { background: "#eef2f8", color: "#2563eb", border: "none", borderRadius: 9, padding: "9px 13px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#334155", display: "block", margin: "8px 0 4px" };
const inp: React.CSSProperties = { width: "100%", border: "1px solid #e2e8f0", borderRadius: 10, padding: "9px 11px", fontSize: 15, outline: "none" };
const hint: React.CSSProperties = { fontSize: 12.5, color: "#5c6675", lineHeight: 1.6, margin: "0 0 4px" };
const pill: React.CSSProperties = { borderRadius: 999, padding: "3px 10px", fontWeight: 800, fontSize: 11.5, letterSpacing: 0.4 };
