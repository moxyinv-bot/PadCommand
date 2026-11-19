create extension if not exists pgcrypto;

create table if not exists public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  household_id text not null,
  user_id text not null,
  property_id text not null,
  issue text not null,
  date_notified date not null,
  date_repaired date,
  cost numeric(12, 2),
  responsibility text not null default 'owner'
    check (responsibility in ('owner', 'tenant', 'shared', 'other')),
  follow_up_needed boolean not null default false,
  follow_up_details text,
  equipment_tags text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists maintenance_logs_household_idx
  on public.maintenance_logs (household_id);
create index if not exists maintenance_logs_property_idx
  on public.maintenance_logs (property_id, date_notified desc);

alter table public.maintenance_logs enable row level security;
grant select, insert, update, delete on table public.maintenance_logs to authenticated;

drop policy if exists maintenance_logs_select_member on public.maintenance_logs;
create policy maintenance_logs_select_member
on public.maintenance_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id::text = maintenance_logs.household_id
      and hm.user_id::text = auth.uid()::text
  )
);

drop policy if exists maintenance_logs_insert_member on public.maintenance_logs;
create policy maintenance_logs_insert_member
on public.maintenance_logs
for insert
to authenticated
with check (
  user_id = auth.uid()::text
  and exists (
    select 1
    from public.household_members hm
    where hm.household_id::text = maintenance_logs.household_id
      and hm.user_id::text = auth.uid()::text
  )
  and exists (
    select 1
    from public.properties p
    where p.id::text = maintenance_logs.property_id
      and p.household_id::text = maintenance_logs.household_id
  )
);

drop policy if exists maintenance_logs_update_member on public.maintenance_logs;
create policy maintenance_logs_update_member
on public.maintenance_logs
for update
to authenticated
using (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id::text = maintenance_logs.household_id
      and hm.user_id::text = auth.uid()::text
  )
)
with check (
  user_id = auth.uid()::text
  and exists (
    select 1
    from public.household_members hm
    where hm.household_id::text = maintenance_logs.household_id
      and hm.user_id::text = auth.uid()::text
  )
  and exists (
    select 1
    from public.properties p
    where p.id::text = maintenance_logs.property_id
      and p.household_id::text = maintenance_logs.household_id
  )
);

drop policy if exists maintenance_logs_delete_member on public.maintenance_logs;
create policy maintenance_logs_delete_member
on public.maintenance_logs
for delete
to authenticated
using (
  exists (
    select 1
    from public.household_members hm
    where hm.household_id::text = maintenance_logs.household_id
      and hm.user_id::text = auth.uid()::text
  )
);
