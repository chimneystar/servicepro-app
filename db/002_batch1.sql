-- =====================================================================
--  ServicePro — Migration 002 (batch 1)
--  Safe to run once in the Supabase SQL Editor AFTER schema.sql.
--  Adds: per-line-item cost + image; price-book cost + image;
--        Storage security policies for the "job-photos" bucket.
-- =====================================================================

-- Per-line-item cost (for profitability) + optional product image path
alter table public.estimate_items add column if not exists cost_minor bigint not null default 0 check (cost_minor >= 0);
alter table public.estimate_items add column if not exists image_path text;
alter table public.invoice_items  add column if not exists cost_minor bigint not null default 0 check (cost_minor >= 0);
alter table public.invoice_items  add column if not exists image_path text;

-- Price book: sell price already exists (price_minor); add cost + image
alter table public.price_book add column if not exists cost_minor bigint not null default 0 check (cost_minor >= 0);
alter table public.price_book add column if not exists image_path text;

-- ---------------------------------------------------------------------
-- Storage policies for the private "job-photos" bucket.
-- Files are stored under a path beginning with the organization id:
--   {organization_id}/{job_id}/{filename}
-- so a member can only read/write files inside their own organization.
-- ---------------------------------------------------------------------
do $$ begin
  -- SELECT (download / signed urls)
  drop policy if exists "job_photos_read" on storage.objects;
  create policy "job_photos_read" on storage.objects for select to authenticated
    using (bucket_id = 'job-photos' and split_part(name, '/', 1) = public.current_org_id()::text);

  -- INSERT (upload)
  drop policy if exists "job_photos_insert" on storage.objects;
  create policy "job_photos_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'job-photos' and split_part(name, '/', 1) = public.current_org_id()::text);

  -- DELETE (remove a photo)
  drop policy if exists "job_photos_delete" on storage.objects;
  create policy "job_photos_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'job-photos' and split_part(name, '/', 1) = public.current_org_id()::text);
exception when insufficient_privilege then
  raise notice 'Could not create storage policies automatically. Create them in Storage > Policies (see DEPLOYMENT notes).';
end $$;

-- =====================================================================
-- End migration 002.
-- =====================================================================
