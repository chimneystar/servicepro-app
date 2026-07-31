import { requireProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import ExportClient from "./ExportClient";
import AccountingSync from "./AccountingSync";
// @ts-ignore -- shared JS module, asserted in tests/accounting-sync.test.mjs
import { ACCOUNTING_SYNC_STATUS } from "@/lib/core/accounting.mjs";

export const dynamic = "force-dynamic";

export default async function ExportPage() {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  return (
    <div>
      <Link href="/reports" style={{ color: "#2563eb", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>‹ Reports</Link>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "8px 0 4px" }}>Accounting export</h1>
      <p style={{ color: "#5c6675", fontSize: 13, marginBottom: 16 }}>Download your books for QuickBooks or your accountant.</p>
      <ExportClient />
      {/* Ledger 6c.12 — the mapped, idempotent, reconcilable export. It is
          PARTIAL and the panel says so before it offers anything. */}
      <AccountingSync status={ACCOUNTING_SYNC_STATUS} />
    </div>
  );
}
