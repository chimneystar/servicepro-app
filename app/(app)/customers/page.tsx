import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/i18n";
import Link from "next/link";
import CustomerForm from "./CustomerForm";
import CustomerList, { type Cust } from "@/components/CustomerList";
import CustomerBulkBar from "./CustomerBulkBar";
import * as customersRepo from "@/lib/data/customers";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const search = await searchParams;
  const profile = await requireProfile();
  const locale = await getLocale();
  const supabase = await createClient();
  const customers = await customersRepo.listActive(supabase);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          gap: 10,
        }}
      >
        <div>
          <h1 className="sp-heading sp-heading--lg">{t(locale, "cust.title")}</h1>
          <p className="sp-text-muted">{t(locale, "cust.count", { n: customers.length })}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            href="/archive"
            style={{
              background: "#fff7ed",
              color: "#9a3412",
              borderRadius: 10,
              padding: "10px 14px",
              fontWeight: 700,
              fontSize: "0.875rem",
              textDecoration: "none",
            }}
          >
            🗄️ Archive
          </Link>
          <Link
            href="/customers/import"
            style={{
              background: "#e2e9f4",
              color: "#2563eb",
              borderRadius: 10,
              padding: "10px 14px",
              fontWeight: 700,
              fontSize: "0.875rem",
              textDecoration: "none",
            }}
          >
            ⬆ Import
          </Link>
          <CustomerForm locale={locale} initialOpen={search.new === "1"} />
        </div>
      </div>

      {/* Ledger 6c.10 + 6c.6 — multi-select, bulk statements and bulk opt-out.
          Owner/office only, matching the actions' own guard. */}
      {profile.role !== "tech" && customers.length > 0 && (
        <CustomerBulkBar rows={customers.map((c) => ({ id: c.id, label: c.name }))} />
      )}

      <CustomerList customers={customers as Cust[]} emptyText={t(locale, "cust.empty")} />
    </div>
  );
}
