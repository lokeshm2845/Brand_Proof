-- BrandProof team workspaces — run this once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: everything is created with IF NOT EXISTS / OR REPLACE.

create extension if not exists pgcrypto;

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('creator', 'brand', 'legal', 'admin')),
  display_name text not null check (char_length(display_name) between 1 and 60),
  email text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);

create table if not exists public.brand_kits (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  version int not null default 1,
  data jsonb not null,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.content_items (
  id text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  data jsonb not null,
  status text not null,
  rev int not null default 1,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists content_items_org_idx on public.content_items(org_id, updated_at desc);

create table if not exists public.invites (
  token text primary key default encode(gen_random_bytes(12), 'hex'),
  org_id uuid not null references public.organizations(id) on delete cascade,
  role text not null check (role in ('creator', 'brand', 'legal', 'admin')),
  created_by uuid default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text,
  text text not null check (char_length(text) <= 300),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- ───────────────────── helper functions ─────────────────────
-- SECURITY DEFINER so policies can check membership without recursive RLS.
create or replace function public.is_member(o uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from memberships where org_id = o and user_id = auth.uid());
$$;

create or replace function public.member_role(o uuid) returns text
language sql security definer stable set search_path = public as $$
  select role from memberships where org_id = o and user_id = auth.uid();
$$;

-- Create an organisation: caller becomes Admin, and the starter Brand Kit is stored.
create or replace function public.create_org(org_name text, my_name text, kit jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; my_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select email into my_email from auth.users where id = auth.uid();
  insert into organizations(name, created_by) values (trim(org_name), auth.uid()) returning id into new_id;
  insert into memberships(org_id, user_id, role, display_name, email) values (new_id, auth.uid(), 'admin', trim(my_name), my_email);
  insert into brand_kits(org_id, version, data, history, updated_by)
    values (new_id, 1, kit, jsonb_build_array(jsonb_build_object('version', 1, 'at', now(), 'by', trim(my_name), 'change', 'Workspace created with the PayNova starter kit')), auth.uid());
  return new_id;
end $$;

-- Join with an invite link. Re-using a link only updates your role/name.
create or replace function public.accept_invite(tok text, my_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites; my_email text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from invites where token = tok;
  if inv is null then raise exception 'invite not found'; end if;
  if inv.expires_at < now() then raise exception 'invite expired'; end if;
  select email into my_email from auth.users where id = auth.uid();
  insert into memberships(org_id, user_id, role, display_name, email)
    values (inv.org_id, auth.uid(), inv.role, trim(my_name), my_email)
    on conflict (org_id, user_id) do update set role = excluded.role, display_name = excluded.display_name;
  return inv.org_id;
end $$;

-- Lets someone see which workspace and role an invite is for before joining.
create or replace function public.invite_info(tok text)
returns table(org_name text, role text, expired boolean)
language sql security definer stable set search_path = public as $$
  select o.name, i.role, i.expires_at < now() from invites i join organizations o on o.id = i.org_id where i.token = tok;
$$;

-- ───────────────────── row-level security ─────────────────────
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.brand_kits enable row level security;
alter table public.content_items enable row level security;
alter table public.invites enable row level security;
alter table public.notifications enable row level security;

drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations for select using (public.is_member(id));

drop policy if exists mem_select on public.memberships;
create policy mem_select on public.memberships for select using (public.is_member(org_id));
drop policy if exists mem_admin_update on public.memberships;
create policy mem_admin_update on public.memberships for update using (public.member_role(org_id) = 'admin');
drop policy if exists mem_admin_delete on public.memberships;
create policy mem_admin_delete on public.memberships for delete using (public.member_role(org_id) = 'admin' or user_id = auth.uid());

drop policy if exists kit_select on public.brand_kits;
create policy kit_select on public.brand_kits for select using (public.is_member(org_id));
drop policy if exists kit_admin_update on public.brand_kits;
create policy kit_admin_update on public.brand_kits for update using (public.member_role(org_id) = 'admin');

drop policy if exists item_select on public.content_items;
create policy item_select on public.content_items for select using (public.is_member(org_id));
drop policy if exists item_insert on public.content_items;
create policy item_insert on public.content_items for insert with check (public.is_member(org_id));
drop policy if exists item_update on public.content_items;
create policy item_update on public.content_items for update using (public.is_member(org_id)) with check (public.is_member(org_id));
drop policy if exists item_delete on public.content_items;
create policy item_delete on public.content_items for delete using (public.member_role(org_id) = 'admin' or created_by = auth.uid());

drop policy if exists inv_admin_all on public.invites;
create policy inv_admin_all on public.invites for all using (public.member_role(org_id) = 'admin') with check (public.member_role(org_id) = 'admin');

drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update using (user_id = auth.uid());
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert with check (
  public.is_member(org_id) and exists (select 1 from public.memberships m where m.org_id = notifications.org_id and m.user_id = notifications.user_id)
);

-- ───────────────────── realtime ─────────────────────
do $$ begin
  begin alter publication supabase_realtime add table public.content_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.brand_kits; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.memberships; exception when duplicate_object then null; end;
end $$;
