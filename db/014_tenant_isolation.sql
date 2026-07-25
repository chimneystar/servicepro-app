-- =====================================================================
--  ServicePro — Migration 014 (GO-LIVE tenant isolation)
--  Run once in the Supabase SQL Editor, AFTER 013. Safe to re-run.
--
--  Guarantees at the DATABASE level that records from two businesses can
--  never be linked. RLS controls what a user can SEE; these constraints
--  control what can be WRITTEN, so a bug or a forged request cannot attach
--  (say) Org A's job to Org B's customer.
--
--    * Parents get UNIQUE (id, organization_id).
--    * Required child links use composite FKs (child.parent_id + org must
--      match parent.id + org).
--    * Optional/nullable links use a validation trigger that preserves the
--      existing delete behaviour while blocking cross-tenant references.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Composite unique keys on the parent tables.
-- ---------------------------------------------------------------------
do $$ begin alter table public.customers add constraint customers_id_org_key unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin alter table public.jobs      add constraint jobs_id_org_key      unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin alter table public.invoices  add constraint invoices_id_org_key  unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;
do $$ begin alter table public.estimates add constraint estimates_id_org_key unique (id, organization_id); exception when duplicate_table then null; when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Composite FKs for required (NOT NULL) relationships.
-- ---------------------------------------------------------------------
do $$ begin alter table public.jobs      add constraint jobs_customer_org_fk      foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict; exception when duplicate_object then null; end $$;
do $$ begin alter table public.estimates add constraint estimates_customer_org_fk foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoices  add constraint invoices_customer_org_fk  foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete restrict; exception when duplicate_object then null; end $$;
do $$ begin alter table public.estimate_items add constraint estimate_items_parent_org_fk foreign key (estimate_id, organization_id) references public.estimates(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.invoice_items  add constraint invoice_items_parent_org_fk  foreign key (invoice_id, organization_id)  references public.invoices(id, organization_id)  on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_photos          add constraint job_photos_job_org_fk     foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_items           add constraint job_items_job_org_fk      foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_tasks           add constraint job_tasks_job_org_fk      foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_checklist_items add constraint job_checklist_job_org_fk  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_equipment       add constraint job_equipment_job_org_fk  foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.job_time_entries    add constraint job_time_job_org_fk       foreign key (job_id, organization_id) references public.jobs(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;
do $$ begin alter table public.recurring_plans     add constraint recurring_customer_org_fk foreign key (customer_id, organization_id) references public.customers(id, organization_id) on delete cascade; exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Validation trigger for optional/nullable relationships.
--    Blocks cross-tenant writes without changing delete behaviour.
-- ---------------------------------------------------------------------
create or replace function public.assert_child_org()
returns trigger language plpgsql security definer set search_path = public as $$
declare parent text := tg_argv[0]; fkcol text := tg_argv[1]; fk uuid; porg uuid;
begin
  execute format('select ($1).%I', fkcol) into fk using new;
  if fk is null then return new; end if;
  execute format('select organization_id from public.%I where id = $1', parent) into porg using fk;
  if porg is not null and porg <> new.organization_id then
    raise exception 'cross-tenant reference blocked: %.% -> %', tg_table_name, fkcol, parent using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.assert_child_org() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in (values
    ('invoices','invoices_job_org_guard','jobs','job_id'),
    ('payments','payments_invoice_org_guard','invoices','invoice_id'),
    ('messages','messages_customer_org_guard','customers','customer_id'),
    ('messages','messages_job_org_guard','jobs','job_id'),
    ('reviews','reviews_customer_org_guard','customers','customer_id'),
    ('reviews','reviews_job_org_guard','jobs','job_id'),
    ('leads','leads_customer_org_guard','customers','converted_customer_id')
  ) as t(tbl, trg, parent, fkcol) loop
    execute format('drop trigger if exists %I on public.%I;', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.assert_child_org(%L, %L);', r.trg, r.tbl, r.parent, r.fkcol);
  end loop;
end $$;

-- =====================================================================
-- End migration 014.
-- =====================================================================
