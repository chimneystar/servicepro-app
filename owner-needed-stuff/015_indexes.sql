-- =====================================================================
--  ServicePro — Migration 015 (GO-LIVE performance indexes)
--  Run once in the Supabase SQL Editor, AFTER 014. Safe to re-run.
--
--  Adds indexes on the high-volume access paths the app actually queries,
--  so lists, dashboards, and reports stay fast as data grows.
-- =====================================================================

-- Jobs: status tabs, calendar/route, customer history, tech commission.
create index if not exists idx_jobs_org_status    on public.jobs(organization_id, status)          where deleted_at is null;
create index if not exists idx_jobs_org_customer  on public.jobs(organization_id, customer_id)     where deleted_at is null;
create index if not exists idx_jobs_tech_date     on public.jobs(assigned_to, scheduled_date)      where deleted_at is null;

-- Invoices: due/paid lists, aging, customer history.
create index if not exists idx_invoices_org_status   on public.invoices(organization_id, status)      where deleted_at is null;
create index if not exists idx_invoices_org_customer on public.invoices(organization_id, customer_id) where deleted_at is null;
create index if not exists idx_invoices_org_issue    on public.invoices(organization_id, issue_date);

-- Estimates: pipeline + customer history.
create index if not exists idx_estimates_org_status   on public.estimates(organization_id, status)      where deleted_at is null;
create index if not exists idx_estimates_org_customer on public.estimates(organization_id, customer_id) where deleted_at is null;

-- Payments: reconciliation / accounting export.
create index if not exists idx_payments_org_paid on public.payments(organization_id, paid_at);

-- Messaging inbox: conversations keyed by phone + time.
create index if not exists idx_sms_org_to   on public.sms_messages(organization_id, to_phone);
create index if not exists idx_sms_org_from on public.sms_messages(organization_id, from_phone);

-- Timesheets / commission: entries per technician.
create index if not exists idx_job_time_user on public.job_time_entries(user_id);

-- =====================================================================
-- End migration 015.
-- =====================================================================
