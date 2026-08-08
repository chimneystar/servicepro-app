-- =====================================================================
--  ServicePro — Migration 032 (automation + outreach execution)
--  Run once in the Supabase SQL Editor, AFTER 031. Safe to re-run.
--  This migration DROPS NOTHING. Every statement is create-if-not-exists,
--  add-column-if-not-exists, or a policy replaced by its own name.
--
--  THE GAP (ledger 5.8, 5.9, 5.12):
--    * `automation_rules` has stored trigger_type / action_type / action_json
--      since migration 019 and NOTHING HAS EVER EXECUTED A RULE. `automation_runs`
--      has never held a single row. An owner could build an automation on
--      /operations and it would silently never fire.
--    * `campaigns`, `referral_programs`, `referrals` and `estimate_followups`
--      are stored and nothing sends them. A campaign sat at status 'draft' or
--      'scheduled' forever; a follow-up scheduled for Tuesday stayed
--      'scheduled' for ever.
--    * `feature_flags` is written by the admin console and READ BY NOTHING.
--
--  What this migration adds is the execution bookkeeping the senders need:
--    1. an idempotency key on automation_runs, so a re-run cannot double-fire;
--    2. per-recipient delivery records for campaigns, so a campaign that dies
--       half-way through resumes instead of re-texting the first half;
--    3. retry/error columns on estimate_followups, so a failed follow-up is
--       visible and bounded instead of retried for ever or lost;
--    4. the two feature-flag rows that now actually gate something.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Automation idempotency.
--
--    automation_runs is BOTH the audit trail and the claim: the executor
--    inserts the row to claim a (rule, source) pair, and this index is what
--    makes two concurrent cron invocations unable to both win. Failures are
--    updated in place (status='failed', attempts+1) rather than deleted, so a
--    retry re-claims the SAME row by compare-and-set and the failure history
--    survives.
--
--    Nothing has ever inserted into automation_runs, so this index cannot
--    collide with existing data. If it somehow does, the migration fails LOUDLY
--    rather than leaving the executor without its uniqueness guarantee.
-- ---------------------------------------------------------------------
create unique index if not exists uq_automation_runs_rule_source
  on public.automation_runs (rule_id, source_id)
  where source_id is not null;

create index if not exists idx_automation_runs_org_status
  on public.automation_runs (organization_id, status, created_at desc);

-- The executor scans enabled rules for every organisation once a night.
create index if not exists idx_automation_rules_enabled
  on public.automation_rules (enabled, trigger_type)
  where enabled;

-- ---------------------------------------------------------------------
-- 2. Campaign delivery records — one row per (campaign, customer, channel).
--
--    Without this, a campaign is claimed by flipping campaigns.status to
--    'sending'; a crash mid-batch then leaves it stuck there for ever (silent)
--    or, if it were re-run, re-sends to everyone already messaged. The claim
--    has to live at the recipient, which is where the duplicate would be felt.
-- ---------------------------------------------------------------------
create table if not exists public.campaign_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('email','sms')),
  status text not null default 'running' check (status in ('running','sent','failed','skipped')),
  -- 'skipped' carries the consent reason (sms_opt_out, no_email, ...): a
  -- customer who was deliberately not contacted must be as visible as one who
  -- was, or "we never sent it" and "it failed" look identical.
  reason text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (campaign_id, customer_id, channel)
);
create index if not exists idx_campaign_deliveries_campaign
  on public.campaign_deliveries (campaign_id, status);
create index if not exists idx_campaign_deliveries_org
  on public.campaign_deliveries (organization_id, created_at desc);

-- Cross-tenant guard, exactly as migration 019 does for every child table: the
-- parent's organization_id must match the child's.
do $$
declare r record;
begin
  for r in select * from (values
    ('campaign_deliveries','campaign_deliveries_campaign_org_guard','campaigns','campaign_id'),
    ('campaign_deliveries','campaign_deliveries_customer_org_guard','customers','customer_id')
  ) as t(tbl,trg,parent,fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L,%L);',
                   r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

-- RLS: same shape migration 023 §5 settled on for the other growth tables —
-- marketing history is management information, so reads are owner/office, the
-- anon role gets nothing, and the service role (the cron) does the writing.
alter table public.campaign_deliveries enable row level security;
drop policy if exists campaign_deliveries_select on public.campaign_deliveries;
create policy campaign_deliveries_select on public.campaign_deliveries for select to authenticated
  using (organization_id = public.current_org_id()
         and public.current_user_role() in ('owner','office'));
drop policy if exists campaign_deliveries_manage on public.campaign_deliveries;
create policy campaign_deliveries_manage on public.campaign_deliveries for all to authenticated
  using (organization_id = public.current_org_id()
         and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id()
              and public.current_user_role() in ('owner','office'));
grant select, insert, update, delete on public.campaign_deliveries to authenticated;
grant all on public.campaign_deliveries to service_role;
revoke all on public.campaign_deliveries from anon;

-- ---------------------------------------------------------------------
-- 3. Estimate follow-ups: retry bookkeeping.
--
--    The table already allows status 'failed' but had nowhere to say WHY, and
--    no attempt counter — so the only two available behaviours were "retry
--    forever" and "lose it". Both are silent. These columns make the third
--    option possible: bounded retries, then a visible failure with its reason.
-- ---------------------------------------------------------------------
alter table public.estimate_followups add column if not exists attempts integer not null default 0;
alter table public.estimate_followups add column if not exists error_message text;
alter table public.estimate_followups add column if not exists sent_at timestamptz;
create index if not exists idx_estimate_followups_due
  on public.estimate_followups (status, scheduled_at);

-- Campaign scans are due-time ordered too.
create index if not exists idx_campaigns_due on public.campaigns (status, scheduled_at);

-- ---------------------------------------------------------------------
-- 4. Referral codes issued to a customer.
--
--    `referrals` already exists and already has unique (organization_id, code);
--    what it lacked was any way to record that the code was actually delivered.
--    Nothing in the product ever created a referral row, so these columns start
--    empty for everyone.
-- ---------------------------------------------------------------------
alter table public.referrals add column if not exists channel text;
alter table public.referrals add column if not exists sent_at timestamptz;
alter table public.referrals add column if not exists error_message text;
do $$ begin
  alter table public.referrals add constraint referrals_channel_check
    check (channel is null or channel in ('email','sms'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 5. Feature flags that now gate real code (ledger 5.12).
--
--    Seeded ENABLED at 100%. A flag that ships off would reproduce the very
--    defect being fixed — a feature that exists and never runs. What it buys is
--    a kill switch: if the outreach sender misbehaves at 2am, platform staff
--    turn it off from /admin without a deploy, and lib/feature-flags.ts stops
--    the cron from sending. See lib/core/feature-flags.mjs for the evaluation
--    order (blocklist > kill switch > allowlist > rollout).
-- ---------------------------------------------------------------------
insert into public.feature_flags(key, description, enabled, rollout_percent) values
  ('automation_rules','Run automation rules on the daily cron (ledger 5.8)',true,100),
  ('growth_outreach','Send scheduled campaigns, estimate follow-ups (ledger 5.9)',true,100)
on conflict (key) do nothing;
