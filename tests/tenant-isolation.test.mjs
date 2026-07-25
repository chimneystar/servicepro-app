// Guard that the DB-level cross-tenant isolation constraints are present in the
// migration. If someone removes a composite FK or an org-guard trigger, this
// fails — so two businesses can never be silently linkable again.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "db", "014_tenant_isolation.sql"), "utf8").toLowerCase();

const requiredUnique = ["customers_id_org_key", "jobs_id_org_key", "invoices_id_org_key", "estimates_id_org_key"];
const requiredFks = [
  "jobs_customer_org_fk", "estimates_customer_org_fk", "invoices_customer_org_fk",
  "estimate_items_parent_org_fk", "invoice_items_parent_org_fk",
  "job_photos_job_org_fk", "job_items_job_org_fk", "job_tasks_job_org_fk",
  "job_checklist_job_org_fk", "job_equipment_job_org_fk", "job_time_job_org_fk",
  "recurring_customer_org_fk",
];
const requiredGuards = [
  "invoices_job_org_guard", "payments_invoice_org_guard",
  "messages_customer_org_guard", "messages_job_org_guard",
  "reviews_customer_org_guard", "reviews_job_org_guard", "leads_customer_org_guard",
];

test("parent tables have composite unique (id, organization_id)", () => {
  for (const u of requiredUnique) assert.ok(sql.includes(u), `missing unique constraint ${u}`);
  assert.ok(sql.includes("unique (id, organization_id)"), "missing composite unique definition");
});

test("required relationships use composite tenant FKs", () => {
  for (const fk of requiredFks) assert.ok(sql.includes(fk), `missing composite FK ${fk}`);
  assert.ok(sql.includes("references public.customers(id, organization_id)"), "customers composite reference missing");
  assert.ok(sql.includes("references public.jobs(id, organization_id)"), "jobs composite reference missing");
});

test("optional relationships are guarded by assert_child_org triggers", () => {
  assert.ok(sql.includes("function public.assert_child_org()"), "assert_child_org function missing");
  for (const g of requiredGuards) assert.ok(sql.includes(g), `missing org-guard trigger ${g}`);
});
