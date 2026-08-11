import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { money, fmtDate } from "@/lib/format";
import { loadStatement } from "@/lib/statements";
import StatementActions from "./StatementActions";
// @ts-ignore -- shared JS module, proven both ways in tests/statements.test.mjs
import { AGING_BUCKETS } from "@/lib/core/statements.mjs";

/**
 * The customer statement (ledger 6c.6).
 *
 * The document that did not exist: "here is everything you owe", printable and
 * sendable. Every figure comes from `buildStatement`, which nets payments with
 * the SAME `collectedMinor` rule the revenue report uses — so a statement can
 * never disagree with /reports about what a customer has paid.
 */
export const dynamic = "force-dynamic";

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ asOf?: string; since?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const profile = await requireProfile();
  // A statement is a receivables document. RLS would return an empty set for a
  // technician anyway; refusing here means they get a redirect, not a page of
  // zeroes that looks like "this customer owes nothing".
  if (profile.role === "tech") redirect(`/customers/${id}`);

  const bundle = await loadStatement(id, { asOf: search.asOf, since: search.since ?? null });
  if (!bundle) {
    return (
      <div>
        <Link href="/customers" style={back}>
          ‹ Customers
        </Link>
        <div className="sp-empty">Customer not found.</div>
      </div>
    );
  }

  const { statement, customer, org } = bundle;
  const cur = org.currency || "USD";
  const billTo = [
    customer.billing_address ?? customer.address,
    customer.billing_city ?? customer.city,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href={`/customers/${id}`} className="no-print" style={back}>
        ‹ {customer.name}
      </Link>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          margin: "8px 0 14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="sp-heading sp-heading--lg">Statement of account</h1>
          <p className="sp-text-muted">
            As of {fmtDate(statement.asOf)}
            {statement.since ? ` · activity since ${fmtDate(statement.since)}` : ""}
          </p>
        </div>
        <div style={{ textAlign: "end", fontSize: "0.875rem", color: "#5c6675" }}>
          <div style={{ fontWeight: 800, fontSize: "0.9375rem", color: "#0b1524" }}>{org.name}</div>
          {[org.address, org.city].filter(Boolean).join(", ") && (
            <div>{[org.address, org.city].filter(Boolean).join(", ")}</div>
          )}
          {org.phone && <div>{org.phone}</div>}
          {org.email && <div>{org.email}</div>}
        </div>
      </div>

      <StatementActions customerId={id} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <Kpi label="Opening balance" value={money(statement.openingMinor, cur)} />
        <Kpi label="Charges" value={money(statement.chargesMinor, cur)} />
        <Kpi label="Payments" value={money(statement.paymentsMinor, cur)} tone="#15803d" />
        <Kpi
          label="Balance due"
          value={money(statement.balanceMinor, cur)}
          tone={statement.balanceMinor > 0 ? "#b45309" : "#15803d"}
        />
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 14,
          marginBottom: 16,
          fontSize: "0.875rem",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 4 }}>{customer.name}</div>
        {billTo && <div style={{ color: "#5c6675" }}>{billTo}</div>}
        {customer.email && <div style={{ color: "#5c6675" }}>{customer.email}</div>}
        {customer.phone && <div style={{ color: "#5c6675" }}>{customer.phone}</div>}
        {/* Consent is shown, because whoever is about to press Send should know
            before they press it, not afterwards from a skip reason. */}
        <div style={{ marginTop: 6, fontSize: "0.875rem", color: "#5c6675" }}>
          SMS:{" "}
          {customer.sms_opt_in === false
            ? "opted OUT"
            : customer.sms_opt_in === true
              ? "opted in"
              : "unknown"}
          {" · "}
          Email:{" "}
          {customer.email_opt_in === false
            ? "unsubscribed"
            : customer.email_opt_in === true
              ? "opted in"
              : "unknown"}
        </div>
      </div>

      <h3 style={h3}>Activity</h3>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem", minWidth: 520 }}
        >
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th right>Charge</Th>
              <Th right>Payment</Th>
              <Th right>Balance</Th>
            </tr>
          </thead>
          <tbody>
            {statement.openingMinor !== 0 && (
              <tr>
                <Td>—</Td>
                <Td>
                  <i>Opening balance</i>
                </Td>
                <Td right>—</Td>
                <Td right>—</Td>
                <Td right>
                  <b>{money(statement.openingMinor, cur)}</b>
                </Td>
              </tr>
            )}
            {statement.lines.map((line, index) => (
              <tr key={`${line.kind}-${line.invoiceId ?? index}-${line.date}`}>
                <Td>{fmtDate(line.date)}</Td>
                <Td>
                  {line.invoiceId && line.kind === "invoice" ? (
                    <Link
                      href={`/invoices/${line.invoiceId}`}
                      style={{ color: "#2563eb", textDecoration: "none" }}
                    >
                      {line.description}
                    </Link>
                  ) : (
                    line.description
                  )}
                  {line.reference && line.kind === "payment" ? ` · ${line.reference}` : ""}
                </Td>
                <Td right>{line.chargeMinor ? money(line.chargeMinor, cur) : "—"}</Td>
                <Td right>{line.creditMinor ? money(line.creditMinor, cur) : "—"}</Td>
                <Td right>
                  <b>{money(line.balanceMinor, cur)}</b>
                </Td>
              </tr>
            ))}
            {statement.lines.length === 0 && (
              <tr>
                <Td>—</Td>
                <Td>No activity in this period.</Td>
                <Td right>—</Td>
                <Td right>—</Td>
                <Td right>—</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 style={h3}>Aging</h3>
      <div className="rlist">
        {AGING_BUCKETS.map((bucket: { key: string; label: string }) => (
          <div className="ritem" key={bucket.key}>
            <div className="rmain">
              <div className="rtitle">{bucket.label}</div>
            </div>
            <div className="rend">
              <b
                style={{
                  fontSize: "0.9375rem",
                  color:
                    bucket.key === "d90_plus" && statement.aging[bucket.key] > 0
                      ? "#dc2626"
                      : "#0b1524",
                }}
              >
                {money(statement.aging[bucket.key] ?? 0, cur)}
              </b>
            </div>
          </div>
        ))}
      </div>

      {statement.openInvoices.length > 0 && (
        <>
          <h3 style={h3}>Open invoices ({statement.openInvoices.length})</h3>
          <div className="rlist">
            {statement.openInvoices.map((row) => (
              <Link key={row.invoiceId} href={`/invoices/${row.invoiceId}`} className="ritem">
                <div className="rmain">
                  <div className="rtitle">#{row.number ?? "—"}</div>
                  <div className="rsub">
                    {fmtDate(row.issueDate)} · {row.ageDays} days old
                  </div>
                </div>
                <div className="rend">
                  <b>{money(row.outstandingMinor, cur)}</b>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <div
        style={{
          marginTop: 18,
          padding: "12px 14px",
          background: "#f5f7fb",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          fontSize: "0.875rem",
          color: "#5c6675",
        }}
      >
        Payments are counted when they <b>settle</b>, net of refunds — the same rule the revenue
        report uses, so this statement and /reports can never disagree. Draft and voided invoices
        are not billed here.
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: "1.25rem", fontWeight: 800, color: tone ?? "#0b1524" }}>{value}</div>
      <div style={{ fontSize: "0.875rem", color: "#5c6675", fontWeight: 600 }}>{label}</div>
    </div>
  );
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        padding: "10px 8px",
        borderBottom: "2px solid #e2e8f0",
        fontWeight: 700,
        textAlign: right ? "end" : "start",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td
      style={{
        padding: "10px 8px",
        borderBottom: "1px solid #eef1f6",
        textAlign: right ? "end" : "start",
      }}
    >
      {children}
    </td>
  );
}
const back: React.CSSProperties = {
  color: "#2563eb",
  fontWeight: 700,
  fontSize: "0.875rem",
  textDecoration: "none",
};
const h3: React.CSSProperties = { fontSize: "1rem", fontWeight: 800, margin: "18px 0 8px" };
