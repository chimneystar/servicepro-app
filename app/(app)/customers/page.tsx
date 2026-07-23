import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import CustomerForm from "./CustomerForm";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  await requireProfile();
  const locale = getLocale();
  const supabase = createClient();
  const { data: customers, error } = await supabase
    .from("customers")
    .select("id, name, phone, city, email, source")
    .is("deleted_at", null)
    .order("name", { ascending: true });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>{t(locale, "cust.title")}</h1>
          <p style={{ color: "#5c6675", fontSize: 13 }}>{t(locale, "cust.count", { n: customers?.length ?? 0 })}</p>
        </div>
        <CustomerForm locale={locale} />
      </div>

      {error && <div style={{ color: "#dc2626" }}>{error.message}</div>}

      <div className="scroll-x" style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 6px 18px rgba(15,42,94,.06)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 520 }}>
          <thead>
            <tr style={{ color: "#5c6675", fontSize: 12 }}>
              <Th>{t(locale, "cust.col.name")}</Th><Th>{t(locale, "cust.col.phone")}</Th>
              <Th>{t(locale, "cust.col.city")}</Th><Th>{t(locale, "cust.col.source")}</Th>
            </tr>
          </thead>
          <tbody>
            {(customers ?? []).map((c) => (
              <tr key={c.id} style={{ borderTop: "1px solid #eef1f6" }}>
                <Td><b>{c.name}</b><div style={{ color: "#5c6675", fontSize: 12 }}>{c.email}</div></Td>
                <Td>{c.phone}</Td>
                <Td>{c.city || "—"}</Td>
                <Td>{c.source || "—"}</Td>
              </tr>
            ))}
            {(!customers || customers.length === 0) && (
              <tr><Td colSpan={4}><div style={{ textAlign: "center", padding: 40, color: "#5c6675" }}>{t(locale, "cust.empty")}</div></Td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "11px 14px", borderBottom: "2px solid #e2e8f0", fontWeight: 700, textAlign: "start" }}>{children}</th>;
}
function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding: "12px 14px", textAlign: "start" }}>{children}</td>;
}
