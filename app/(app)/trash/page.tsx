import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import TrashList, { type TrashRow } from "./TrashList";
// @ts-ignore — pure, unit-tested restore rules, proven both ways (tests/recovery.test.mjs)
import { restoreBlockers } from "@/lib/core/recovery.mjs";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * Trash (ledger 6a.4).
 *
 * `deleted_at` was set by four different code paths and honoured on every read,
 * and no screen in the product could show a single one of those rows, let alone
 * bring one back. This is that screen.
 *
 * NOT the same thing as /archive. Archive is `customers.archived = true`: legacy
 * records imported from an old system, deliberately kept out of the active lists
 * and still fully readable. Trash is `deleted_at is not null`: records someone
 * removed. The two are separate columns, separate screens and separate ideas,
 * and a row in one is not in the other.
 *
 * Owner/office only, because deleting any of these four is owner/office.
 */
export default async function TrashPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await requireProfile();
  if (profile.role === "tech") redirect("/");
  const search = await searchParams;
  const page = Math.max(0, Number.parseInt(search.page ?? "0", 10) || 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();
  const orgId = profile.organization_id!;

  const [customers, jobs, estimates, invoices] = await Promise.all([
    deletedRows(supabase, orgId, "customers", "id, name, phone, email, archived", from, to),
    deletedRows(
      supabase,
      orgId,
      "jobs",
      "id, service, status, scheduled_date, customer_id",
      from,
      to,
    ),
    deletedRows(
      supabase,
      orgId,
      "estimates",
      "id, number, status, issue_date, total_minor, customer_id",
      from,
      to,
    ),
    deletedRows(
      supabase,
      orgId,
      "invoices",
      "id, number, status, issue_date, total_minor, customer_id, job_id, estimate_id",
      from,
      to,
    ),
  ]);

  const children = [...jobs.rows, ...estimates.rows, ...invoices.rows];
  const customerIds = unique(children.map((r) => r.customer_id));
  const jobIds = unique(invoices.rows.map((r) => r.job_id));
  const estimateIds = unique(invoices.rows.map((r) => r.estimate_id));
  const actorIds = unique([...customers.rows, ...children].map((r) => r.deleted_by));
  const deletedCustomerIds = customers.rows.map((r) => String(r.id));

  const [parentCustomers, parentJobs, parentEstimates, actors, erasedIds] = await Promise.all([
    lookup(supabase, "customers", customerIds, "id, name, deleted_at"),
    lookup(supabase, "jobs", jobIds, "id, service, deleted_at"),
    lookup(supabase, "estimates", estimateIds, "id, number, deleted_at"),
    lookup(supabase, "profiles", actorIds, "id, full_name"),
    privacyErasedCustomers(supabase, orgId, deletedCustomerIds),
  ]);

  const actorName = (id: unknown) => {
    const found = actors.get(String(id ?? ""));
    return found ? String(found.full_name ?? "") : null;
  };
  const parent = (map: Map<string, Record<string, unknown>>, id: unknown, labelKey: string) => {
    const found = map.get(String(id ?? ""));
    if (!found) return null;
    return {
      deleted: found.deleted_at != null,
      name: found[labelKey] == null ? null : String(found[labelKey]),
    };
  };

  const rows: TrashRow[] = [
    ...customers.rows.map((r) => {
      const context = { deleted: true, privacyErased: erasedIds.has(String(r.id)) };
      return {
        kind: "customer" as const,
        id: String(r.id),
        title: String(r.name ?? "(no name)"),
        detail:
          [r.phone, r.email].filter(Boolean).join(" · ") ||
          (r.archived ? "archived legacy record" : ""),
        deletedAt: String(r.deleted_at ?? ""),
        deletedAtLabel: stamp(r.deleted_at),
        deletedBy: actorName(r.deleted_by),
        blockers: (restoreBlockers("customer", context) as { message: string }[]).map(
          (b) => b.message,
        ),
      };
    }),
    ...jobs.rows.map((r) => {
      const customer = parent(parentCustomers, r.customer_id, "name");
      return {
        kind: "job" as const,
        id: String(r.id),
        title: String(r.service ?? "Job"),
        detail: [customer?.name, r.scheduled_date, r.status].filter(Boolean).join(" · "),
        deletedAt: String(r.deleted_at ?? ""),
        deletedAtLabel: stamp(r.deleted_at),
        deletedBy: actorName(r.deleted_by),
        blockers: (
          restoreBlockers("job", { deleted: true, customer }) as { message: string }[]
        ).map((b) => b.message),
      };
    }),
    ...estimates.rows.map((r) => {
      const customer = parent(parentCustomers, r.customer_id, "name");
      return {
        kind: "estimate" as const,
        id: String(r.id),
        title: `Estimate #${r.number ?? "—"}`,
        detail: [customer?.name, r.issue_date, r.status, money(r.total_minor)]
          .filter(Boolean)
          .join(" · "),
        deletedAt: String(r.deleted_at ?? ""),
        deletedAtLabel: stamp(r.deleted_at),
        deletedBy: actorName(r.deleted_by),
        blockers: (
          restoreBlockers("estimate", { deleted: true, customer }) as { message: string }[]
        ).map((b) => b.message),
      };
    }),
    ...invoices.rows.map((r) => {
      const customer = parent(parentCustomers, r.customer_id, "name");
      const context: Record<string, unknown> = { deleted: true, customer };
      if (r.job_id) context.job = parent(parentJobs, r.job_id, "service");
      if (r.estimate_id) context.estimate = parent(parentEstimates, r.estimate_id, "number");
      return {
        kind: "invoice" as const,
        id: String(r.id),
        title: `Invoice #${r.number ?? "—"}`,
        detail: [customer?.name, r.issue_date, r.status, money(r.total_minor)]
          .filter(Boolean)
          .join(" · "),
        deletedAt: String(r.deleted_at ?? ""),
        deletedAtLabel: stamp(r.deleted_at),
        deletedBy: actorName(r.deleted_by),
        blockers: (restoreBlockers("invoice", context) as { message: string }[]).map(
          (b) => b.message,
        ),
      };
    }),
  ].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));

  const total = customers.total + jobs.total + estimates.total + invoices.total;
  const hasMore = [customers, jobs, estimates, invoices].some(
    (r) => r.total > (page + 1) * PAGE_SIZE,
  );
  const unreadable = [customers, jobs, estimates, invoices]
    .filter((r) => r.error)
    .map((r) => r.table);

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Trash</h1>
      <p style={{ color: "#5c6675", fontSize: "0.8125rem", marginTop: 4 }}>
        {total} deleted {total === 1 ? "record" : "records"} · customers, jobs, estimates and
        invoices
      </p>

      <div
        style={{
          background: "#eff6ff",
          border: "1px solid #bfdbfe",
          color: "#1e3a8a",
          borderRadius: 12,
          padding: "11px 14px",
          fontSize: "0.8125rem",
          margin: "12px 0 16px",
          lineHeight: 1.55,
        }}
      >
        🗑️ Deleted records are hidden from every list and report but are never destroyed. Restore
        brings one back exactly as it was. A record is restored{" "}
        <b>only when everything it belongs to is back first</b> — an invoice cannot return while its
        customer is still deleted, because it would show up in your ledger attached to a customer no
        screen can open.
        <div style={{ marginTop: 6 }}>
          Looking for old imported clients instead? Those are in{" "}
          <Link href="/archive" style={{ color: "#1d4ed8", fontWeight: 700 }}>
            Archive
          </Link>{" "}
          — a different thing, kept separately.
        </div>
      </div>

      {unreadable.length > 0 && (
        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            borderRadius: 12,
            padding: "11px 14px",
            fontSize: "0.8125rem",
            marginBottom: 14,
          }}
        >
          Could not read deleted {unreadable.join(", ")}. This list is incomplete. If this persists,
          migration
          <code style={{ margin: "0 4px" }}>db/037_recovery.sql</code> may not have been applied
          yet.
        </div>
      )}

      <TrashList rows={rows} />

      {(page > 0 || hasMore) && (
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          {page > 0 && (
            <Link href={`/trash?page=${page - 1}`} style={pageBtn}>
              ‹ Newer
            </Link>
          )}
          {hasMore && (
            <Link href={`/trash?page=${page + 1}`} style={pageBtn}>
              Older ›
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

const pageBtn: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "9px 14px",
  fontWeight: 700,
  fontSize: "0.8125rem",
  color: "#334155",
  textDecoration: "none",
};

/**
 * Formatted HERE, on the server, and passed down as a string.
 *
 * Formatting a timestamp inside the client component would render one way during
 * SSR and another in the browser whenever their locale or timezone differ — a
 * hydration error, and the reason tests/hydration-guard.test.mjs exists. UTC is
 * stated explicitly rather than guessed at, because "deleted at 11:04" is
 * useless if the reader cannot tell whose clock it was.
 */
function stamp(value: unknown) {
  if (!value) return "at an unknown time";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

function money(minor: unknown) {
  const n = Number(minor ?? 0);
  return Number.isFinite(n) ? `$${(n / 100).toFixed(2)}` : "";
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.filter(Boolean).map(String))];
}

/**
 * One page of soft-deleted rows, plus the true total.
 *
 * `deleted_by` is added by migration 037. If that migration has not been applied
 * the select fails as a whole, so the query is retried without it rather than
 * blanking the entire screen — a trash list missing one column still restores
 * records; a 500 does not.
 */
async function deletedRows(
  supabase: Supa,
  orgId: string,
  table: string,
  columns: string,
  from: number,
  to: number,
) {
  const run = (cols: string) =>
    supabase
      .from(table)
      .select(`${cols}, deleted_at`, { count: "exact" })
      .eq("organization_id", orgId)
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false })
      .range(from, to);

  let { data, error, count } = await run(`${columns}, deleted_by`);
  if (error) ({ data, error, count } = await run(columns));
  return {
    table,
    rows: (data ?? []) as unknown as Record<string, unknown>[],
    total: count ?? 0,
    error: error ? String((error as { message?: string }).message ?? error) : null,
  };
}

/** id -> row, for a bounded set of ids (at most one page's worth). */
async function lookup(supabase: Supa, table: string, ids: string[], columns: string) {
  const map = new Map<string, Record<string, unknown>>();
  if (!ids.length) return map;
  const { data } = await supabase.from(table).select(columns).in("id", ids);
  for (const row of (data ?? []) as unknown as Record<string, unknown>[])
    map.set(String(row.id), row);
  return map;
}

/**
 * Customers erased to satisfy a completed privacy DELETION request. Restoring
 * one would undo a legal erasure, so the button is refused rather than shown.
 */
async function privacyErasedCustomers(supabase: Supa, orgId: string, customerIds: string[]) {
  const erased = new Set<string>();
  if (!customerIds.length) return erased;
  const { data } = await supabase
    .from("privacy_requests")
    .select("customer_id")
    .eq("organization_id", orgId)
    .eq("request_type", "deletion")
    .eq("status", "completed")
    .in("customer_id", customerIds);
  for (const row of (data ?? []) as { customer_id: string | null }[])
    if (row.customer_id) erased.add(row.customer_id);
  return erased;
}
