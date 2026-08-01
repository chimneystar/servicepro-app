import { redirect } from "next/navigation";
import { assertCapability, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getLocale } from "@/lib/locale-server";
import FinanceCenter from "./FinanceCenter";
// @ts-ignore — integer-safe money engine (JS module, unit-tested in tests/money.test.mjs)
import { resolveTaxJurisdictions } from "@/lib/core/money.mjs";
import * as profilesRepo from "@/lib/data/profiles";
import * as reporting from "@/lib/data/reporting";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const profile = await requireProfile();
  try {
    await assertCapability(profile, "payments.manage");
  } catch {
    redirect(profile.role === "tech" ? "/tech" : profile.role === "office" ? "/dispatch" : "/");
  }
  const locale = await getLocale(),
    he = locale === "he",
    supabase = await createClient();
  const [{ data: org }, taxRules, filings, settlements, disputes, payments, members] =
    await Promise.all([
      // `tax_mode` arrives with migration 035; fall back so the screen still renders before it is applied.
      supabase
        .from("organizations")
        .select("currency,tax_mode")
        .single()
        .then((r: any) =>
          r.error ? supabase.from("organizations").select("currency").single() : r,
        ),
      reporting.listTaxJurisdictions(supabase),
      reporting.listTaxFilings(supabase),
      reporting.listSettlementBatches(supabase),
      reporting.listPaymentDisputes(supabase),
      reporting.listRecentPaymentsForFinance(supabase, 100),
      profilesRepo.listActive(supabase),
    ]);

  // Resolve today's effective rate on the SERVER: the client must not decide
  // what "today" is (hydration), and the arithmetic belongs to the tested engine.
  const today = new Date().toISOString().slice(0, 10);
  const resolved = resolveTaxJurisdictions(taxRules, { onDate: today });
  const taxSetup = {
    mode: ((org as any)?.tax_mode === "jurisdictions" ? "jurisdictions" : "flat") as
      "flat" | "jurisdictions",
    today,
    effectiveBps: resolved.effectiveBps as number,
    appliedCount: resolved.applied.length as number,
    skipped: (
      resolved.skipped as {
        rule: { id: string | null; name: string; rateBps: number };
        reason: string;
      }[]
    ).map((s) => ({ id: s.rule.id, name: s.rule.name, rateBps: s.rule.rateBps, reason: s.reason })),
  };

  return (
    <div className="ops-page">
      <header className="ops-heading">
        <div>
          <span>{he ? "שליטה בכסף" : "Money operations"}</span>
          <h1>{he ? "כספים, מסים והתאמות" : "Finance, tax & reconciliation"}</h1>
          <p>
            {he
              ? "יודעים מה נגבה, מה הופקד, מה דורש התאמה ואיפה צריך לענות למחלוקת."
              : "Know what was collected, what reached the bank, what needs reconciliation, and which disputes need a response."}
          </p>
        </div>
        <div className="ops-heading-mark" aria-hidden="true">
          $
        </div>
      </header>
      <FinanceCenter
        locale={locale}
        currency={org?.currency ?? "USD"}
        taxRules={taxRules}
        taxSetup={taxSetup}
        filings={filings}
        settlements={settlements}
        disputes={disputes as any}
        payments={payments}
        members={members}
      />
    </div>
  );
}
