import { type NextRequest, NextResponse } from "next/server";
import { createClient, createUntypedClient } from "@/lib/supabase/server";
import { pageThrough } from "@/lib/export";
// @ts-ignore — pure, unit-tested manifest and redaction (tests/business-export.test.mjs)
import {
  EXPORT_TABLES,
  EXCLUDED_TABLES,
  NOT_INCLUDED,
  SECRET_COLUMNS,
  redactDeep,
} from "@/lib/core/export-manifest.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Whole-business data export (ledger 6a.7).
 *
 * The owner could not take their own data out of this product. The only exits
 * were three per-entity accounting CSVs over a date range and a per-customer
 * privacy JSON. Everything else — jobs, photos' metadata, inventory, campaigns,
 * consent history, the audit trail — was reachable only through the UI.
 *
 * Three things this route takes seriously:
 *
 * 1. IT PAGES. Every table is read through `pageThrough`, 1000 rows at a time,
 *    until the source is exhausted. PostgREST silently truncates at 1000 rows,
 *    so an unpaged export of a real business would produce a file that looks
 *    complete and is not. That is worse than no backup at all, because it is
 *    only discovered on the day it is needed.
 *
 * 2. IT CANNOT REACH ANOTHER TENANT. Every query carries an explicit
 *    `.eq(orgKey, organization_id)` from the session profile — never from the
 *    request — on top of row-level security. Two independent barriers, because
 *    an export is the one endpoint where a tenancy bug is maximally damaging.
 *
 * 3. IT SHIPS NO CREDENTIALS. `redactDeep` strips bearer tokens by key name at
 *    every depth, including inside `audit_log`'s jsonb row snapshots. See
 *    lib/core/export-manifest.mjs for the reasoning about what an owner
 *    legitimately owns (costs, margins, commissions: yes) versus what merely
 *    authenticates someone (portal and document tokens: never).
 *
 * The response is STREAMED, and `meta` is written last as a trailer. A reader
 * must check `meta.status`. If the connection drops mid-export the JSON will not
 * parse — deliberately. A backup that fails loudly beats one that ends early and
 * looks fine.
 */
export async function GET(_request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id, role")
    .eq("id", user.id)
    .single();

  // Owner only. This is the whole business — every customer, every message,
  // every wage-adjacent commission percentage — in one file. Deleting a single
  // record is owner/office; leaving with all of it is not.
  if (!profile?.organization_id || profile.role !== "owner") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId: string = profile.organization_id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));
      const rowCounts: Record<string, number> = {};
      const problems: { table: string; error: string }[] = [];

      try {
        write("{\n");
        write(
          `"readme": ${JSON.stringify(
            {
              product: "ServicePro",
              what: "A complete copy of every database table your business owns.",
              howToRead:
                'Each key under "tables" is a database table; the value is the array of your rows.',
              important:
                'Check "meta" at the END of this file. meta.status must be "complete". If this file does not parse as JSON the download was interrupted and the export is not usable.',
              notIncluded: NOT_INCLUDED,
            },
            null,
            1,
          )},\n`,
        );
        write(`"generatedAt": ${JSON.stringify(new Date().toISOString())},\n`);
        write(`"organizationId": ${JSON.stringify(orgId)},\n`);
        write('"tables": {\n');

        // The one place in this codebase that reads a table name from data
        // rather than writing it as a literal, so the one place that uses the
        // deliberately untyped client. See createUntypedClient for why, and
        // what protects this route instead: RLS, the explicit org filter on
        // every query, and tests/business-export.test.mjs checking the
        // manifest against db/*.sql.
        const everyTable = await createUntypedClient();

        let firstTable = true;
        for (const entry of EXPORT_TABLES as { table: string; orgKey: string; order: string }[]) {
          if (!firstTable) write(",\n");
          firstTable = false;
          write(`${JSON.stringify(entry.table)}: [`);

          let count = 0;
          try {
            const pages = pageThrough<Record<string, unknown>>((from, to) =>
              everyTable
                .from(entry.table)
                .select("*")
                .eq(entry.orgKey, orgId)
                .order(entry.order)
                .range(from, to),
            );
            for await (const batch of pages) {
              for (const row of batch) {
                write(`${count ? "," : ""}\n${JSON.stringify(redactDeep(row))}`);
                count++;
              }
            }
          } catch (error: unknown) {
            // One missing or unreadable table must not silently shrink the
            // backup. Record it, keep going, and mark the whole export
            // incomplete in the trailer.
            problems.push({
              table: entry.table,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          write(count ? "\n]" : "]");
          rowCounts[entry.table] = count;
        }

        write("\n},\n");
        write(
          `"meta": ${JSON.stringify(
            {
              status: problems.length ? "incomplete" : "complete",
              statusExplanation: problems.length
                ? "One or more tables could not be read. The rows listed above are real, but this file is NOT a complete backup — see problems."
                : "Every table in the manifest was read to exhaustion.",
              problems,
              tableCount: (EXPORT_TABLES as unknown[]).length,
              rowCounts,
              totalRows: Object.values(rowCounts).reduce((sum, n) => sum + n, 0),
              redactedColumns: [...(SECRET_COLUMNS as Set<string>)].sort(),
              redactedBecause:
                "These columns are bearer credentials. Anyone holding the value can act as that customer or accept that invitation, so they are withheld from every export including this one. Your existing links keep working.",
              excludedTables: EXCLUDED_TABLES,
              notIncluded: NOT_INCLUDED,
            },
            null,
            1,
          )}\n}\n`,
        );
        controller.close();
      } catch (error: unknown) {
        // Abort rather than close: a truncated body must not be mistaken for a
        // finished file. The client sees a failed download.
        console.error("[export/business] failed:", error instanceof Error ? error.message : error);
        controller.error(error);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(stream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="servicepro-full-export-${stamp}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
