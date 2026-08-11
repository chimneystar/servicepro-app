-- =====================================================================
--  ServicePro — Migration 027 (missing hot-path indexes)
--  Run once in the Supabase SQL Editor, AFTER 026. Safe to re-run.
--
--  CONTEXT: 015_indexes.sql was the deliberate indexing pass, but waves 017-022
--  added 53 more tables and hand-rolled their own indexes piecemeal. Several
--  paths the application hits on EVERY request were left unindexed. Each one
--  below was verified absent across all of db/*.sql before being added here.
--
--  Every index is created CONCURRENTLY-safe (IF NOT EXISTS) and none changes
--  behaviour — only the cost of the queries the app already makes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Customer lookup by phone and email.
--
--    Hit by: inbound SMS webhook, inbound call webhook, manual call logging,
--    online booking (matching an existing customer), and global search. Some of
--    these run on every inbound message from every customer.
--
--    Partial on deleted_at because every one of those lookups excludes
--    soft-deleted rows, which keeps the index smaller and matches the predicate.
-- ---------------------------------------------------------------------
create index if not exists idx_customers_org_phone
  on public.customers (organization_id, phone) where deleted_at is null;
create index if not exists idx_customers_org_email
  on public.customers (organization_id, email) where deleted_at is null;

-- ---------------------------------------------------------------------
-- 2. Invitation lookup on sign-in.
--
--    accept_invitation() runs `where lower(email) = lower(:email)` for EVERY
--    first sign-in. Without a matching expression index this is a sequential
--    scan; the existing idx_invitations_org does not help because the predicate
--    is on the lowered email, not the organisation.
-- ---------------------------------------------------------------------
create index if not exists idx_invitations_email_lower
  on public.invitations (lower(email)) where accepted_at is null;

-- ---------------------------------------------------------------------
-- 3. The anonymous booking rate limiter.
--
--    submit_booking counts leads created in the last minute on every public
--    submission (013_security_hardening.sql). That count is on the hot path of
--    an endpoint reachable by anyone on the internet.
-- ---------------------------------------------------------------------
create index if not exists idx_leads_org_created
  on public.leads (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Commission and job-to-invoice joins.
--
--    The commission report resolves job -> invoice -> settled payments. Without
--    this, every commission run sequentially scans invoices.
-- ---------------------------------------------------------------------
create index if not exists idx_invoices_job
  on public.invoices (job_id) where job_id is not null and deleted_at is null;

-- ---------------------------------------------------------------------
-- 5. Payments by period — the reporting hot path.
--
--    Revenue, the accounting export and reconciliation all filter payments by
--    paid_at within a range, restricted to settled statuses.
-- ---------------------------------------------------------------------
create index if not exists idx_payments_org_paid_at
  on public.payments (organization_id, paid_at desc);
create index if not exists idx_payments_estimate
  on public.payments (estimate_id) where estimate_id is not null;

-- ---------------------------------------------------------------------
-- 6. Child tables whose RLS policies filter on organization_id.
--
--    THIS IS THE SUBTLE ONE. Every policy on these tables is
--    `using (organization_id = public.current_org_id())`, so organization_id is
--    evaluated on EVERY row access — but the tables were indexed only by their
--    parent id. The RLS predicate itself had no index behind it.
-- ---------------------------------------------------------------------
create index if not exists idx_job_items_org on public.job_items (organization_id);
create index if not exists idx_job_tasks_org on public.job_tasks (organization_id);
create index if not exists idx_job_checklist_items_org on public.job_checklist_items (organization_id);
create index if not exists idx_job_equipment_org on public.job_equipment (organization_id);
create index if not exists idx_job_photos_org on public.job_photos (organization_id);
create index if not exists idx_invoice_items_org on public.invoice_items (organization_id);
create index if not exists idx_estimate_items_org on public.estimate_items (organization_id);

-- ---------------------------------------------------------------------
-- 7. Audit-log lookup by record.
--
--    lib/activity.ts reads the timeline for one record with
--    `where table_name = ? and row_id = ?`. The only existing index is
--    (organization_id, at), which does not serve that predicate.
-- ---------------------------------------------------------------------
create index if not exists idx_audit_log_record
  on public.audit_log (table_name, row_id, at desc);

-- ---------------------------------------------------------------------
-- 8. Message threads.
--
--    /messages groups the whole SMS table by counterparty phone.
-- ---------------------------------------------------------------------
create index if not exists idx_sms_messages_org_created
  on public.sms_messages (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- 9. Redundant prefix indexes.
--
--    idx_jobs_org (organization_id) is a strict prefix of
--    idx_jobs_org_status (organization_id, status), so it can never be chosen
--    over it and only costs write throughput. Dropping an index is reversible
--    and loses no data.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_jobs_org')
     and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_jobs_org_status') then
    execute 'drop index if exists public.idx_jobs_org';
    raise notice 'dropped redundant index idx_jobs_org (prefix of idx_jobs_org_status)';
  end if;
end $$;

-- =====================================================================
-- End migration 027.
-- =====================================================================
