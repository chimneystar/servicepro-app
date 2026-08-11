-- =====================================================================
--  ServicePro — Migration 039 (scheduling + sales capabilities)
--  Run once in the Supabase SQL Editor, AFTER 038. Safe to re-run.
--
--  Ledger items 6c.2, 6c.3, 6c.4, 6c.8, 6c.11.
--
--  ADDITIVE ONLY. This file creates tables, columns, indexes and functions.
--  It drops NO table, NO column, NO constraint and NO policy that another
--  migration created — every `drop policy if exists` below names a policy this
--  file itself creates, so a re-run replaces its own work and nothing else.
--  (Migration 023 §4 / plan item 1.18 is the reason that sentence is written
--  out: a drop that names the wrong policy is a silent no-op.)
--
--  THE NO-DOUBLE-BOOK GUARANTEE IS UNTOUCHED. `jobs_no_double_book`
--  (db/schema.sql) and the two triggers from `db/028_crew_double_book.sql` are
--  neither dropped nor weakened, and nothing here writes to `jobs.assigned_to`,
--  `jobs.scheduled_date`, `jobs.start_time`, `jobs.end_time` or
--  `job_assignments`. Time off is an AVAILABILITY FILTER applied before an
--  assignment is attempted; the exclusion constraint remains the last word.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. A composite key on profiles, so the new tenant-scoped tables can carry a
--    composite foreign key instead of trusting the application to fill
--    organization_id correctly. `id` is already the primary key, so this adds
--    no new uniqueness — only the referencable (id, organization_id) pair.
--    profiles.organization_id is nullable, and a composite FK is MATCH SIMPLE,
--    so it is simply not enforced for a profile with no organisation.
-- ---------------------------------------------------------------------
do $$ begin
  alter table public.profiles add constraint profiles_id_org_key unique (id, organization_id);
exception when duplicate_table then null; when duplicate_object then null; end $$;

-- =====================================================================
-- 1. 6c.2 — TRUE JOB COSTING INCLUDING LABOUR.
--
--    Clock in/out has been collected since migration 009 and reached no profit
--    figure anywhere. /reports computes gross profit as revenue ex-tax minus
--    the cost on the invoice lines; materials got there in 5.11, labour never
--    did, so every margin the owner has ever seen counted the technician's time
--    as free.
--
--    WHERE THE WAGE LIVES, AND WHY IT IS NOT ON `profiles`.
--    `profiles` is readable by every member of the organisation — dispatch,
--    the schedule and the job page all need names and colours — so a
--    `cost_rate_minor` column there would hand every technician the whole
--    payroll through PostgREST, whatever the UI showed. Migration 023 §5 had
--    already moved cost and location data out of technicians' reach; a wage is
--    a strict superset of that sensitivity, so it gets its own table, and that
--    table is OWNER ONLY — office staff cannot read it either. Office staff
--    still need job margin, so they read it through `job_labour_cost()`, a
--    security-definer function that returns money for ONE job and never a
--    per-person rate.
--
--    Rates are effective-dated, the same shape as tax_jurisdictions: a rise
--    must not retroactively re-cost last quarter's finished jobs.
-- =====================================================================
create table if not exists public.technician_pay_rates (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  profile_id       uuid not null,
  -- Fully-loaded hourly COST to the business (wage + burden), in minor units.
  -- Not the customer-facing labour rate: this side of the margin is cost.
  cost_rate_minor  bigint not null default 0 check (cost_rate_minor >= 0 and cost_rate_minor <= 100000000),
  effective_from   date not null default current_date,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (profile_id, effective_from),
  foreign key (profile_id, organization_id) references public.profiles(id, organization_id) on delete cascade
);
create index if not exists idx_technician_pay_rates_lookup
  on public.technician_pay_rates (organization_id, profile_id, effective_from desc);

comment on table public.technician_pay_rates is
  'Hourly labour COST per technician, effective-dated. Owner-only by RLS: this is '
  'payroll. Office staff reach the derived job figure through job_labour_cost().';

alter table public.technician_pay_rates enable row level security;
drop policy if exists technician_pay_rates_owner on public.technician_pay_rates;
create policy technician_pay_rates_owner on public.technician_pay_rates for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() = 'owner')
  with check (organization_id = public.current_org_id() and public.current_user_role() = 'owner');

revoke all on public.technician_pay_rates from anon;
grant select, insert, update, delete on public.technician_pay_rates to authenticated;
grant all on public.technician_pay_rates to service_role;

-- The labour snapshot on the job. Derived, but stored: a job costed in March
-- must not silently re-cost itself when the wage changes in June, and the
-- reporting path must not have to re-read timesheets it is not allowed to see.
alter table public.jobs add column if not exists labour_minutes    integer not null default 0 check (labour_minutes >= 0);
alter table public.jobs add column if not exists labour_cost_minor bigint  not null default 0 check (labour_cost_minor >= 0);
alter table public.jobs add column if not exists labour_costed_at  timestamptz;

comment on column public.jobs.labour_cost_minor is
  'Snapshot of the labour this job consumed, in minor units, from closed '
  'job_time_entries priced at each technician''s effective rate. Written by '
  'recomputeJobLabourCost / createInvoiceFromJob. Technicians cannot change it '
  '(guard_job_field_authority).';

-- A technician must not be able to rewrite the labour cost of a job they are
-- assigned to, for the same reason they cannot rewrite its price. This is
-- migration 023 §3's guard, extended — the pre-existing comparisons are
-- reproduced verbatim so nothing 023 protected stops being protected.
create or replace function public.guard_job_field_authority()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if public.current_user_role() in ('owner','office') then return new; end if;

  if new.price_minor        is distinct from old.price_minor
     or new.customer_id     is distinct from old.customer_id
     or new.assigned_to     is distinct from old.assigned_to
     or new.deleted_at      is distinct from old.deleted_at
     or new.organization_id is distinct from old.organization_id
     -- job_expenses_minor is added by migration 012; compare it without
     -- assuming it exists (absent column => null on both sides => no change).
     or (to_jsonb(new) ->> 'job_expenses_minor') is distinct from (to_jsonb(old) ->> 'job_expenses_minor')
     -- Added by migration 039. Same treatment, same reason: this is cost data.
     or (to_jsonb(new) ->> 'labour_cost_minor') is distinct from (to_jsonb(old) ->> 'labour_cost_minor')
     or (to_jsonb(new) ->> 'labour_minutes')    is distinct from (to_jsonb(old) ->> 'labour_minutes')
     or (to_jsonb(new) ->> 'required_skills')   is distinct from (to_jsonb(old) ->> 'required_skills') then
    raise exception 'job_field_change_denied'
      using errcode = 'insufficient_privilege',
            hint = 'Technicians may update job progress, not pricing, assignment or deletion.';
  end if;
  return new;
end $$;
revoke all on function public.guard_job_field_authority() from public, anon, authenticated;

-- The only way office staff (or any code that is not the owner) learns what a
-- job cost in labour. Returns ONE job's aggregate. It never returns a rate, a
-- name or another job, so it cannot be turned into a payroll listing.
--
-- Only CLOSED entries are costed. An open timer has no duration yet; counting
-- "now minus started_at" would make the cost of a job change every time the
-- page was refreshed, and would silently inflate the margin report if somebody
-- forgot to clock out. Open entries are REPORTED so the caller can say so.
create or replace function public.job_labour_cost(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid; v_date date;
  v_minutes bigint := 0; v_cost bigint := 0;
  v_unpriced integer := 0; v_open integer := 0;
  r record; v_rate bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if public.current_user_role() not in ('owner','office') then
    raise exception 'forbidden' using errcode = 'insufficient_privilege';
  end if;

  select j.organization_id, j.scheduled_date into v_org, v_date
    from public.jobs j where j.id = p_job and j.deleted_at is null;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'job_not_found';
  end if;

  select count(*) into v_open from public.job_time_entries e
   where e.job_id = p_job and e.organization_id = v_org and e.ended_at is null;

  for r in
    select e.user_id,
           (sum(extract(epoch from (e.ended_at - e.started_at))) / 60)::bigint as mins
      from public.job_time_entries e
     where e.job_id = p_job
       and e.organization_id = v_org
       and e.ended_at is not null
       and e.ended_at > e.started_at
     group by e.user_id
  loop
    v_minutes := v_minutes + greatest(r.mins, 0);
    select p.cost_rate_minor into v_rate
      from public.technician_pay_rates p
     where p.organization_id = v_org
       and p.profile_id = r.user_id
       and p.effective_from <= coalesce(v_date, current_date)
     order by p.effective_from desc
     limit 1;
    if v_rate is null then
      v_unpriced := v_unpriced + 1;
    else
      -- Integer half-up, minutes at an hourly rate: (mins * rate + 30) / 60.
      v_cost := v_cost + ((greatest(r.mins, 0) * v_rate) + 30) / 60;
    end if;
    v_rate := null;
  end loop;

  return jsonb_build_object(
    'minutes', v_minutes,
    'cost_minor', v_cost,
    'unpriced_technicians', v_unpriced,
    'open_entries', v_open);
end $$;
revoke all on function public.job_labour_cost(uuid) from public, anon;
grant execute on function public.job_labour_cost(uuid) to authenticated, service_role;

-- =====================================================================
-- 2. 6c.3 — TECHNICIAN TIME OFF / NON-WORKING DAYS.
--
--    The only availability inputs were org business hours and existing jobs,
--    so both the public booking calendar and the dispatch board would happily
--    put work on a technician who was on holiday.
--
--    `profile_id IS NULL` means the WHOLE BUSINESS is closed that day — the
--    public holiday case. That is why the column is nullable rather than a
--    separate table: closure and absence are the same question asked of the
--    calendar, and one table means one query on the booking hot path.
-- =====================================================================
create table if not exists public.technician_time_off (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  profile_id       uuid,                        -- null = business closed for everyone
  starts_on        date not null,
  ends_on          date not null,
  -- Both null = all day. Otherwise a partial-day window in the business's own
  -- wall clock, the same clock `jobs.start_time` / `booking_settings.hours_json` use.
  start_time       time,
  end_time         time,
  kind             text not null default 'time_off'
                     check (kind in ('time_off','vacation','sick','personal','training','holiday','other')),
  status           text not null default 'approved'
                     check (status in ('requested','approved','declined')),
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (ends_on >= starts_on),
  check ((start_time is null and end_time is null)
         or (start_time is not null and end_time is not null and end_time > start_time)),
  foreign key (profile_id, organization_id) references public.profiles(id, organization_id) on delete cascade
);
create index if not exists idx_time_off_org_range
  on public.technician_time_off (organization_id, starts_on, ends_on) where status = 'approved';
create index if not exists idx_time_off_profile
  on public.technician_time_off (profile_id, starts_on, ends_on);

comment on table public.technician_time_off is
  'Absence and business closure. Read by the booking slot API and by every '
  'assignment path. It NEVER writes to jobs or job_assignments, so it cannot '
  'create a route around jobs_no_double_book — it only removes availability.';

alter table public.technician_time_off enable row level security;

drop policy if exists technician_time_off_select on public.technician_time_off;
create policy technician_time_off_select on public.technician_time_off for select to authenticated
  using (organization_id = public.current_org_id()
         and (public.current_user_role() in ('owner','office')
              or profile_id = auth.uid()
              or profile_id is null));

drop policy if exists technician_time_off_manage on public.technician_time_off;
create policy technician_time_off_manage on public.technician_time_off for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

-- A technician may ASK for time off. They cannot approve it: the WITH CHECK
-- pins both the subject and the status, so 'requested' is the only thing that
-- can be written this way and it is worth nothing until an owner approves it.
drop policy if exists technician_time_off_request on public.technician_time_off;
create policy technician_time_off_request on public.technician_time_off for insert to authenticated
  with check (organization_id = public.current_org_id()
              and profile_id = auth.uid()
              and status = 'requested');

revoke all on public.technician_time_off from anon;
grant select, insert, update, delete on public.technician_time_off to authenticated;
grant all on public.technician_time_off to service_role;

-- =====================================================================
-- 3. 6c.11 — SKILLS / CERTIFICATIONS + DISPATCH MATCHING.
--
--    Dispatch could not know who is licensed for gas, HVAC or electrical work,
--    which in most jurisdictions is not a preference but a legal condition of
--    doing the job at all.
-- =====================================================================
create table if not exists public.technician_skills (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations(id) on delete cascade,
  profile_id           uuid not null,
  -- Machine key, matched against jobs.required_skills. Constrained so a typo
  -- ('Gas ' vs 'gas') cannot silently produce an unmatchable certification.
  skill_code           text not null check (skill_code ~ '^[a-z0-9_]{2,40}$'),
  label                text,
  certification_number text,
  issued_on            date,
  expires_on           date,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (organization_id, profile_id, skill_code),
  foreign key (profile_id, organization_id) references public.profiles(id, organization_id) on delete cascade
);
create index if not exists idx_technician_skills_code
  on public.technician_skills (organization_id, skill_code);

alter table public.technician_skills enable row level security;

-- certification_number is a licence identifier, so the same rule as the
-- timesheet: management sees the team, a technician sees themselves.
drop policy if exists technician_skills_select on public.technician_skills;
create policy technician_skills_select on public.technician_skills for select to authenticated
  using (organization_id = public.current_org_id()
         and (public.current_user_role() in ('owner','office') or profile_id = auth.uid()));

drop policy if exists technician_skills_manage on public.technician_skills;
create policy technician_skills_manage on public.technician_skills for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

revoke all on public.technician_skills from anon;
grant select, insert, update, delete on public.technician_skills to authenticated;
grant all on public.technician_skills to service_role;

-- What this job needs. Empty (the default, and every existing row) means no
-- restriction, so nothing that works today starts being refused.
alter table public.jobs add column if not exists required_skills text[] not null default '{}';
create index if not exists idx_jobs_required_skills on public.jobs using gin (required_skills);

-- =====================================================================
-- 4. 6c.4 — GOOD / BETTER / BEST ESTIMATE OPTIONS.
--
--    The app could only produce one flat price.
--
--    THE MODEL, AND WHY IT KEEPS DEPOSITS AND CONVERSION INTACT.
--    An option is a NAMED BUNDLE OF LINE ITEMS that is COPIED INTO
--    `estimate_items` when it is chosen. It is deliberately not a parallel
--    document: `estimates.id`, `estimates.public_token` and therefore
--    `payments.estimate_id` never move, so `db/024_deposit_credit.sql`'s link
--    from an invoice to its estimate — and the deposit credit that hangs off
--    it — is untouched, and `convertEstimateToInvoice` still reads
--    `estimate_items` and needs no new branch to convert the RIGHT price.
-- =====================================================================
create table if not exists public.estimate_options (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  estimate_id     uuid not null,
  tier            text not null check (tier in ('good','better','best')),
  title           text not null default '',
  description     text,
  recommended     boolean not null default false,
  deposit_minor   bigint not null default 0 check (deposit_minor >= 0),
  total_minor     bigint not null default 0 check (total_minor >= 0),
  sort            integer not null default 0,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (estimate_id, tier),
  -- Referenced by estimates.selected_option_id as a composite, so an estimate
  -- can never point at another estimate's option.
  unique (id, estimate_id),
  foreign key (estimate_id, organization_id)
    references public.estimates(id, organization_id) on delete cascade
);
create index if not exists idx_estimate_options_parent on public.estimate_options(estimate_id, sort);

create table if not exists public.estimate_option_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  option_id        uuid not null references public.estimate_options(id) on delete cascade,
  title            text,
  description      text not null default '',
  qty_milli        bigint not null default 1000 check (qty_milli >= 0),
  unit_price_minor bigint not null default 0 check (unit_price_minor >= 0),
  cost_minor       bigint not null default 0 check (cost_minor >= 0),
  taxable          boolean not null default true,
  image_path       text,
  sort             integer not null default 0
);
create index if not exists idx_estimate_option_items_parent on public.estimate_option_items(option_id, sort);

alter table public.estimates add column if not exists selected_option_id uuid;
alter table public.estimates add column if not exists option_selected_at timestamptz;
alter table public.estimates add column if not exists option_selected_by text;

do $$ begin
  alter table public.estimates
    add constraint estimates_selected_option_fk
    foreign key (selected_option_id, id)
    references public.estimate_options(id, estimate_id)
    on delete set null;
exception when duplicate_object then null; end $$;

alter table public.estimate_options enable row level security;
alter table public.estimate_option_items enable row level security;

drop policy if exists estimate_options_select on public.estimate_options;
create policy estimate_options_select on public.estimate_options for select to authenticated
  using (organization_id = public.current_org_id());
drop policy if exists estimate_options_manage on public.estimate_options;
create policy estimate_options_manage on public.estimate_options for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

drop policy if exists estimate_option_items_select on public.estimate_option_items;
create policy estimate_option_items_select on public.estimate_option_items for select to authenticated
  using (organization_id = public.current_org_id());
drop policy if exists estimate_option_items_manage on public.estimate_option_items;
create policy estimate_option_items_manage on public.estimate_option_items for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

revoke all on public.estimate_options from anon;
revoke all on public.estimate_option_items from anon;
grant select, insert, update, delete on public.estimate_options to authenticated;
grant select, insert, update, delete on public.estimate_option_items to authenticated;
grant all on public.estimate_options to service_role;
grant all on public.estimate_option_items to service_role;

-- Keep an option's cached total honest. `total_minor` on the option is a
-- display figure for the chooser; it is recomputed from the option's own lines
-- by trigger so a hand-edited number cannot disagree with what the customer is
-- actually shown, exactly as documents recompute their totals server-side.
create or replace function public.refresh_estimate_option_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_option uuid; v_total bigint;
begin
  v_option := coalesce(new.option_id, old.option_id);
  select coalesce(sum(round(i.qty_milli::numeric * i.unit_price_minor / 1000)), 0)::bigint
    into v_total from public.estimate_option_items i where i.option_id = v_option;
  update public.estimate_options set total_minor = v_total where id = v_option;
  return null;
end $$;
revoke all on function public.refresh_estimate_option_total() from public, anon, authenticated;

drop trigger if exists trg_estimate_option_items_total on public.estimate_option_items;
create trigger trg_estimate_option_items_total
after insert or update or delete on public.estimate_option_items
for each row execute function public.refresh_estimate_option_total();

-- The customer's choice, from the public page. Anonymous, token-scoped, and
-- refused once the estimate is signed — approve_document's `signed_at is null`
-- guard exists so a signed document cannot be rewritten, and re-pricing a
-- signed estimate would defeat it just as thoroughly as re-signing it.
create or replace function public.select_estimate_option(p_token uuid, p_option uuid, p_by text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record; opt record;
  v_subtotal bigint; v_taxable bigint; v_discount bigint; v_disc_taxable bigint; v_tax bigint; v_total bigint;
  v_deposit bigint;
begin
  select * into e from public.estimates where public_token = p_token and deleted_at is null;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.signed_at is not null then return jsonb_build_object('ok', false, 'error', 'already_signed'); end if;

  select * into opt from public.estimate_options where id = p_option and estimate_id = e.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_option'); end if;

  delete from public.estimate_items where estimate_id = e.id;
  insert into public.estimate_items
    (organization_id, estimate_id, title, description, qty_milli, unit_price_minor, cost_minor, taxable, image_path, sort)
  select e.organization_id, e.id, i.title, i.description, i.qty_milli, i.unit_price_minor,
         i.cost_minor, i.taxable, i.image_path, i.sort
    from public.estimate_option_items i where i.option_id = opt.id order by i.sort;

  -- The same arithmetic as computeDocument (lib/core/money.mjs): sum the lines,
  -- clamp the discount, allocate it to the taxable share, tax once, half-up.
  select coalesce(sum(round(qty_milli::numeric * unit_price_minor / 1000)), 0)::bigint,
         coalesce(sum(case when taxable then round(qty_milli::numeric * unit_price_minor / 1000) else 0 end), 0)::bigint
    into v_subtotal, v_taxable
    from public.estimate_items where estimate_id = e.id;

  v_discount := least(coalesce(e.discount_minor, 0), v_subtotal);
  v_disc_taxable := case when v_subtotal > 0
                         then round(v_discount::numeric * v_taxable / v_subtotal)::bigint else 0 end;
  v_tax := round((v_taxable - v_disc_taxable)::numeric * coalesce(e.tax_rate_bps, 0) / 10000)::bigint;
  v_total := v_subtotal - v_discount + v_tax;

  -- An option that states its own deposit wins. An option that does not keeps
  -- whatever the estimate already asked for (which may be the organisation
  -- default applied by migration 031), clamped so a cheaper option can never
  -- leave a deposit larger than the job.
  v_deposit := least(case when opt.deposit_minor > 0 then opt.deposit_minor else coalesce(e.deposit_minor, 0) end, v_total);

  update public.estimates
     set selected_option_id = opt.id,
         option_selected_at = now(),
         option_selected_by = left(nullif(trim(coalesce(p_by, '')), ''), 120),
         total_minor = v_total,
         deposit_minor = v_deposit
   where id = e.id;

  insert into public.audit_log (organization_id, table_name, row_id, action, actor, new_data)
  values (e.organization_id, 'estimates', e.id, 'option_selected', null,
          jsonb_build_object('option_id', opt.id, 'tier', opt.tier, 'total_minor', v_total, 'deposit_minor', v_deposit));

  return jsonb_build_object('ok', true, 'tier', opt.tier, 'total_minor', v_total, 'deposit_minor', v_deposit);
end $$;
revoke all on function public.select_estimate_option(uuid, uuid, text) from public;
grant execute on function public.select_estimate_option(uuid, uuid, text) to anon, authenticated, service_role;

-- =====================================================================
-- 5. 6c.8 — APPOINTMENT CONFIRM / DECLINE AND "ON MY WAY" TRACKING.
--
--    Reminders were one-way SMS and the "on my way" text pointed nowhere.
--
--    THE TOKEN FOLLOWS 023 §10's RULES, WHICH THE PORTAL TOKEN HAD TO BE
--    RETROFITTED WITH: it EXPIRES (there is no null-expiry branch here — the
--    column is NOT NULL, so a link cannot be minted without a deadline), it is
--    REVOCABLE (`revoked_at`, checked before anything else), and it exposes
--    ONLY what the arrival page needs. It is not the customer portal token and
--    chains to nothing: no other job, no price, no invoice, no document token,
--    no address, no phone number. A forwarded link shows one appointment.
-- =====================================================================
create table if not exists public.appointment_tokens (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id          uuid not null,
  token           uuid not null default gen_random_uuid(),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (token),
  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade
);
-- One live link per job. Re-issuing revokes the previous one rather than
-- leaving two valid links in two text messages.
create unique index if not exists uq_appointment_tokens_live
  on public.appointment_tokens (job_id) where revoked_at is null;
create index if not exists idx_appointment_tokens_job on public.appointment_tokens (job_id);

alter table public.appointment_tokens enable row level security;
drop policy if exists appointment_tokens_manage on public.appointment_tokens;
create policy appointment_tokens_manage on public.appointment_tokens for all to authenticated
  using (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'))
  with check (organization_id = public.current_org_id() and public.current_user_role() in ('owner','office'));

revoke all on public.appointment_tokens from anon;
grant select, insert, update, delete on public.appointment_tokens to authenticated;
grant all on public.appointment_tokens to service_role;

alter table public.jobs add column if not exists customer_confirmation_status text not null default 'pending';
alter table public.jobs add column if not exists customer_confirmed_at        timestamptz;
alter table public.jobs add column if not exists customer_declined_at         timestamptz;
alter table public.jobs add column if not exists customer_confirmation_note   text;
alter table public.jobs add column if not exists customer_response_count      integer not null default 0;
alter table public.jobs add column if not exists on_my_way_eta_minutes        integer;
alter table public.jobs add column if not exists arrived_at                   timestamptz;

do $$ begin
  alter table public.jobs add constraint jobs_customer_confirmation_status_check
    check (customer_confirmation_status in ('pending','confirmed','declined'));
exception when duplicate_object then null; end $$;

-- Everything the arrival page renders, and nothing else.
create or replace function public.public_appointment(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare tk record; j record; org record; tech text;
begin
  select * into tk from public.appointment_tokens
   where token = p_token and revoked_at is null and expires_at > now();
  if not found then return null; end if;

  select id, service, status, scheduled_date, start_time, end_time,
         on_my_way_at, on_my_way_eta_minutes, arrived_at, completed_at,
         customer_confirmation_status, assigned_to, organization_id, deleted_at
    into j from public.jobs where id = tk.job_id;
  if not found or j.deleted_at is not null then return null; end if;

  select name, tagline, logo_url, accent_color, phone, email into org
    from public.organizations where id = j.organization_id;

  -- First name only. The customer needs to know who is coming, not the roster.
  select split_part(coalesce(p.full_name, ''), ' ', 1) into tech
    from public.profiles p where p.id = j.assigned_to;

  return jsonb_build_object(
    'service', j.service,
    'status', j.status,
    'date', j.scheduled_date,
    'start_time', j.start_time,
    'end_time', j.end_time,
    'confirmation', j.customer_confirmation_status,
    'on_my_way_at', j.on_my_way_at,
    'eta_minutes', j.on_my_way_eta_minutes,
    'arrived_at', j.arrived_at,
    'completed_at', j.completed_at,
    'technician', nullif(tech, ''),
    'expires_at', tk.expires_at,
    'org', jsonb_build_object('name', org.name, 'tagline', org.tagline, 'logo_url', org.logo_url,
                              'accent_color', org.accent_color, 'phone', org.phone, 'email', org.email));
end $$;
revoke all on function public.public_appointment(uuid) from public;
grant execute on function public.public_appointment(uuid) to anon, authenticated, service_role;

-- The customer's answer. Declining does NOT cancel the job: a cancellation is
-- an operational decision with a double-book constraint and a technician's day
-- behind it, so this records the answer loudly and leaves the dispatcher to
-- act. Bounded at 10 responses per job so a leaked link cannot be used to
-- hammer the row.
create or replace function public.respond_to_appointment(p_token uuid, p_response text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tk record; j record;
begin
  if p_response not in ('confirmed','declined') then
    return jsonb_build_object('ok', false, 'error', 'invalid_response');
  end if;

  select * into tk from public.appointment_tokens
   where token = p_token and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'link_expired'); end if;

  select id, status, deleted_at, customer_response_count into j
    from public.jobs where id = tk.job_id;
  if not found or j.deleted_at is not null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if j.status in ('done','cancelled') then
    return jsonb_build_object('ok', false, 'error', 'appointment_closed');
  end if;
  if coalesce(j.customer_response_count, 0) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_responses');
  end if;

  update public.jobs
     set customer_confirmation_status = p_response,
         customer_confirmed_at = case when p_response = 'confirmed' then now() else customer_confirmed_at end,
         customer_declined_at  = case when p_response = 'declined'  then now() else customer_declined_at end,
         customer_confirmation_note = left(nullif(trim(coalesce(p_note, '')), ''), 500),
         customer_response_count = coalesce(customer_response_count, 0) + 1
   where id = j.id;

  insert into public.audit_log (organization_id, table_name, row_id, action, actor, new_data)
  values (tk.organization_id, 'jobs', j.id, 'customer_' || p_response, null,
          jsonb_build_object('response', p_response));

  return jsonb_build_object('ok', true, 'confirmation', p_response);
end $$;
revoke all on function public.respond_to_appointment(uuid, text, text) from public;
grant execute on function public.respond_to_appointment(uuid, text, text) to anon, authenticated, service_role;

-- =====================================================================
-- 6. public_document gains the options, so the customer can choose on /p/<token>.
--
--    Reproduced from db/010_v13.sql with TWO keys added ('options' and
--    'selected_option_id') and every other key byte-identical, because a
--    create-or-replace that quietly drops a key would break the page that
--    reads it.
-- =====================================================================
create or replace function public.public_document(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d record; kind text; org record; cust record; itms jsonb; terms text; dep bigint; opts jsonb; sel uuid;
begin
  select * into d from public.estimates where public_token = p_token and deleted_at is null;
  if found then kind := 'estimate';
  else
    select * into d from public.invoices where public_token = p_token and deleted_at is null;
    if found then kind := 'invoice'; else return null; end if;
  end if;

  select * into org from public.organizations where id = d.organization_id;
  select name, phone, email, address, city, billing_address, billing_city
    into cust from public.customers where id = d.customer_id;

  opts := '[]'::jsonb;
  sel := null;

  if kind = 'estimate' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'description', description, 'qty_milli', qty_milli,
        'unit_price_minor', unit_price_minor, 'taxable', taxable, 'image_path', image_path) order by sort), '[]'::jsonb)
      into itms from public.estimate_items where estimate_id = d.id;
    terms := coalesce(org.estimate_terms, org.terms);
    dep := coalesce(d.deposit_minor, 0);
    sel := d.selected_option_id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'tier', o.tier, 'title', o.title, 'description', o.description,
        'recommended', o.recommended, 'total_minor', o.total_minor, 'deposit_minor', o.deposit_minor,
        'items', (select coalesce(jsonb_agg(jsonb_build_object(
                     'title', i.title, 'description', i.description, 'qty_milli', i.qty_milli,
                     'unit_price_minor', i.unit_price_minor, 'taxable', i.taxable) order by i.sort), '[]'::jsonb)
                   from public.estimate_option_items i where i.option_id = o.id)
      ) order by o.sort, o.tier), '[]'::jsonb)
      into opts from public.estimate_options o where o.estimate_id = d.id;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', title, 'description', description, 'qty_milli', qty_milli,
        'unit_price_minor', unit_price_minor, 'taxable', taxable, 'image_path', image_path) order by sort), '[]'::jsonb)
      into itms from public.invoice_items where invoice_id = d.id;
    terms := coalesce(org.invoice_terms, org.terms);
    dep := 0;
  end if;

  return jsonb_build_object(
    'kind', kind, 'number', d.number, 'status', d.status, 'issue_date', d.issue_date,
    'notes', d.notes, 'discount_minor', d.discount_minor, 'tax_rate_bps', d.tax_rate_bps,
    'total_minor', d.total_minor, 'deposit_minor', dep, 'signer_name', d.signer_name, 'signed_at', d.signed_at,
    'currency', org.currency, 'tax_label', org.tax_label,
    'customer', jsonb_build_object('name', cust.name, 'phone', cust.phone, 'email', cust.email,
                                   'address', cust.address, 'city', cust.city,
                                   'billing_address', cust.billing_address, 'billing_city', cust.billing_city),
    'org', jsonb_build_object('name', org.name, 'tagline', org.tagline, 'logo_url', org.logo_url,
                              'address', org.address, 'city', org.city, 'phone', org.phone, 'email', org.email,
                              'accent_color', org.accent_color, 'terms', terms, 'footer', org.document_footer),
    'items', itms,
    'options', opts,
    'selected_option_id', sel
  );
end $$;
revoke execute on function public.public_document(uuid) from public;
grant execute on function public.public_document(uuid) to anon, authenticated;

-- =====================================================================
-- 7. Report what an operator should know, rather than assuming a clean install.
-- =====================================================================
do $$
declare v_unpriced bigint; v_overlap bigint;
begin
  select count(distinct e.user_id) into v_unpriced
    from public.job_time_entries e
   where e.ended_at is not null
     and not exists (select 1 from public.technician_pay_rates r
                      where r.profile_id = e.user_id and r.organization_id = e.organization_id);
  if v_unpriced > 0 then
    raise notice 'Migration 039: % technician(s) have recorded time but no pay rate. Their labour costs 0 until a rate is entered on /team, and job costing says so rather than pretending it is free.', v_unpriced;
  end if;

  select count(*) into v_overlap from public.estimates where selected_option_id is not null;
  raise notice 'Migration 039: % estimate(s) already carry a selected option.', v_overlap;
exception when others then
  raise notice 'Migration 039: survey skipped: %', sqlerrm;
end $$;

-- =====================================================================
-- End migration 039.
-- =====================================================================
