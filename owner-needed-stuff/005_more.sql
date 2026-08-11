-- =====================================================================
--  ServicePro — Migration 005 (customizable job types)
--  Run once in the Supabase SQL Editor, after 004.
-- =====================================================================

alter table public.organizations
  add column if not exists job_types text[] not null
  default array['AC Cleaning','AC Install','AC Repair','Annual Maintenance','Plumbing','Electrical','Renovation','Other']::text[];

-- =====================================================================
-- End migration 005.
-- =====================================================================
