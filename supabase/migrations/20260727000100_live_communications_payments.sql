-- Live communications and connected payments foundation.
-- Additive migration for the feature/live-communications-payments pilot.
-- Rollback order (pilot only): provider_webhook_events, communication_attachments,
-- communications, conversations, integration_connections.

create extension if not exists pgcrypto;

create table if not exists public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'twilio', 'stripe')),
  status text not null default 'not_connected'
    check (status in ('not_connected', 'action_required', 'pending', 'connected', 'error')),
  external_account_id text,
  encrypted_credentials text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  contact_key text not null,
  provider_thread_id text,
  subject text,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, channel, contact_key)
);

create table if not exists public.communications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null default 'pending'
    check (status in ('pending', 'queued', 'sent', 'delivered', 'received', 'failed', 'bounced')),
  from_address text,
  to_address text,
  subject text,
  body text not null default '',
  provider text not null check (provider in ('gmail', 'twilio')),
  provider_message_id text,
  provider_thread_id text,
  business_event_key text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.communication_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  communication_id uuid not null references public.communications(id) on delete cascade,
  provider_attachment_id text,
  storage_path text,
  filename text not null,
  content_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'twilio', 'stripe')),
  provider_event_id text not null,
  event_type text,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create index if not exists integration_connections_org_status_idx
  on public.integration_connections (organization_id, status);
create index if not exists conversations_org_recent_idx
  on public.conversations (organization_id, last_message_at desc);
create index if not exists conversations_provider_thread_idx
  on public.conversations (organization_id, provider_thread_id)
  where provider_thread_id is not null;
create index if not exists communications_conversation_created_idx
  on public.communications (conversation_id, created_at);
create index if not exists communications_org_channel_created_idx
  on public.communications (organization_id, channel, created_at desc);
create unique index if not exists communications_provider_message_unique
  on public.communications (organization_id, provider, provider_message_id)
  where provider_message_id is not null;
create index if not exists communication_attachments_communication_idx
  on public.communication_attachments (communication_id);

alter table public.integration_connections enable row level security;
alter table public.conversations enable row level security;
alter table public.communications enable row level security;
alter table public.communication_attachments enable row level security;
alter table public.provider_webhook_events enable row level security;

grant select, insert, update, delete on public.integration_connections to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.communications to authenticated;
grant select, insert, update, delete on public.communication_attachments to authenticated;
grant select, insert, update, delete on public.provider_webhook_events to service_role;

drop policy if exists "organization members read integration connections" on public.integration_connections;
create policy "organization members read integration connections"
on public.integration_connections for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = integration_connections.organization_id
));

drop policy if exists "organization owners manage integration connections" on public.integration_connections;
create policy "organization owners manage integration connections"
on public.integration_connections for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = integration_connections.organization_id and p.role = 'owner'
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = integration_connections.organization_id and p.role = 'owner'
));

drop policy if exists "organization members manage conversations" on public.conversations;
create policy "organization members manage conversations"
on public.conversations for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = conversations.organization_id
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = conversations.organization_id
));

drop policy if exists "organization members manage communications" on public.communications;
create policy "organization members manage communications"
on public.communications for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = communications.organization_id
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = communications.organization_id
));

drop policy if exists "organization members manage communication attachments" on public.communication_attachments;
create policy "organization members manage communication attachments"
on public.communication_attachments for all to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = communication_attachments.organization_id
))
with check (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.organization_id = communication_attachments.organization_id
));

-- Webhook events are intentionally service-role only. Public provider routes
-- validate signatures before using the server-only admin client.
revoke all on public.provider_webhook_events from anon, authenticated;

-- Realtime publication is safe because table RLS still filters each subscriber.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'communications'
  ) then
    alter publication supabase_realtime add table public.communications;
  end if;
end $$;
