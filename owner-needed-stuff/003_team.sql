-- =====================================================================
--  ServicePro — Migration 003 (team / invitations)
--  Run once in the Supabase SQL Editor, after 002.
--
--  Lets an owner invite teammates by email. When the invited person signs
--  up (self-serve), this function attaches them to the inviting business
--  with the assigned role — instead of creating a new business.
-- =====================================================================

create or replace function public.accept_invitation()
returns uuid language plpgsql security definer set search_path = public as $$
declare em text; inv record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;

  -- already in an organization? return it (idempotent)
  if exists (select 1 from public.profiles where id = auth.uid() and organization_id is not null) then
    return (select organization_id from public.profiles where id = auth.uid());
  end if;

  select email into em from auth.users where id = auth.uid();
  if em is null then return null; end if;

  select * into inv from public.invitations
    where lower(email) = lower(em) and accepted_at is null and expires_at > now()
    order by created_at desc limit 1;
  if not found then return null; end if;

  insert into public.profiles (id, organization_id, full_name, role)
    values (auth.uid(), inv.organization_id, '', inv.role)
    on conflict (id) do update set organization_id = excluded.organization_id, role = excluded.role;

  update public.invitations set accepted_at = now() where id = inv.id;
  return inv.organization_id;
end $$;

grant execute on function public.accept_invitation() to authenticated;

-- =====================================================================
-- End migration 003.
-- =====================================================================
