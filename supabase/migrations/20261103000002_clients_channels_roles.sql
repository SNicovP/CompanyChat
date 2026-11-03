-- Clients (level 1), project channels (level 2) and DMs, with memberships and role-based RLS.
--
-- App roles (profiles.app_role):  owner > admin > member
--   owner/admin: manage every client, project and membership.
-- Membership roles (client_members.role, channel_members.role): manager > member
--   client manager: manages that client's members and projects.
--   channel manager: manages that project's members.
-- Messages come in the next stage.

create type public.membership_role as enum ('manager', 'member');
create type public.channel_kind as enum ('project', 'dm');

-- ---------------------------------------------------------------- tables

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.client_members (
  client_id uuid not null references public.clients (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index client_members_user_idx on public.client_members (user_id);

-- A channel is either a project under a client, or a direct message.
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  kind public.channel_kind not null,
  client_id uuid references public.clients (id) on delete cascade,
  name text,
  is_private boolean not null default false,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint channels_shape check (
    (kind = 'project' and client_id is not null and name is not null and length(trim(name)) > 0)
    or (kind = 'dm' and client_id is null and is_private)
  )
);
create unique index channels_client_name_key on public.channels (client_id, lower(name)) where kind = 'project';

create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.membership_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);
create index channel_members_user_idx on public.channel_members (user_id);

alter table public.clients enable row level security;
alter table public.client_members enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;

-- --------------------------------------------------------------- helpers
-- security definer so policies can consult membership tables without recursing into RLS.

create or replace function public.is_client_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.client_members where client_id = cid and user_id = auth.uid());
$$;

create or replace function public.can_manage_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin()
    or exists (
      select 1 from public.client_members
      where client_id = cid and user_id = auth.uid() and role = 'manager'
    );
$$;

create or replace function public.is_channel_member(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.channel_members where channel_id = chid and user_id = auth.uid());
$$;

-- Project channels: app admins, the client's managers, client members (unless the channel is
-- private) and explicit channel members. DMs: participants only (admins included).
create or replace function public.can_access_channel(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channels c
    where c.id = chid
      and (
        public.is_channel_member(c.id)
        or (c.kind = 'project' and (
          public.can_manage_client(c.client_id)
          or (not c.is_private and public.is_client_member(c.client_id))
        ))
      )
  );
$$;

-- Only project channels can be managed; a manager is an admin, the client's manager,
-- or a manager of that channel.
create or replace function public.can_manage_channel(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.channels c
    where c.id = chid
      and c.kind = 'project'
      and (
        public.can_manage_client(c.client_id)
        or exists (
          select 1 from public.channel_members m
          where m.channel_id = c.id and m.user_id = auth.uid() and m.role = 'manager'
        )
      )
  );
$$;

-- --------------------------------------------------------------- policies

-- clients
create policy "clients: visible to admins and members" on public.clients for select to authenticated
  using (public.is_app_admin() or public.is_client_member(id));
create policy "clients: admins create" on public.clients for insert to authenticated
  with check (public.is_app_admin());
create policy "clients: managers update" on public.clients for update to authenticated
  using (public.can_manage_client(id)) with check (public.can_manage_client(id));
create policy "clients: admins delete" on public.clients for delete to authenticated
  using (public.is_app_admin());

-- client_members
create policy "client_members: visible within the client" on public.client_members for select to authenticated
  using (public.is_app_admin() or public.is_client_member(client_id));
create policy "client_members: managers add" on public.client_members for insert to authenticated
  with check (public.can_manage_client(client_id));
create policy "client_members: managers change role" on public.client_members for update to authenticated
  using (public.can_manage_client(client_id)) with check (public.can_manage_client(client_id));
create policy "client_members: managers remove" on public.client_members for delete to authenticated
  using (public.can_manage_client(client_id));

-- channels (DMs are created only through get_or_create_dm)
create policy "channels: visible if accessible" on public.channels for select to authenticated
  using (public.can_access_channel(id));
create policy "channels: client managers create projects" on public.channels for insert to authenticated
  with check (kind = 'project' and public.can_manage_client(client_id));
create policy "channels: managers update projects" on public.channels for update to authenticated
  using (public.can_manage_channel(id)) with check (kind = 'project');
create policy "channels: managers delete projects" on public.channels for delete to authenticated
  using (public.can_manage_channel(id));

-- channel_members
create policy "channel_members: visible with the channel" on public.channel_members for select to authenticated
  using (public.can_access_channel(channel_id));
create policy "channel_members: managers add" on public.channel_members for insert to authenticated
  with check (public.can_manage_channel(channel_id));
create policy "channel_members: managers change role" on public.channel_members for update to authenticated
  using (public.can_manage_channel(channel_id)) with check (public.can_manage_channel(channel_id));
create policy "channel_members: managers remove" on public.channel_members for delete to authenticated
  using (public.can_manage_channel(channel_id));

-- ----------------------------------------------------------------- grants
-- New tables are not auto-exposed, so grant explicitly and as narrowly as possible.

revoke all on public.clients, public.client_members, public.channels, public.channel_members from anon, authenticated;

grant select, insert, delete on public.clients to authenticated;
grant update (name) on public.clients to authenticated;

grant select, insert, delete on public.client_members to authenticated;
grant update (role) on public.client_members to authenticated;

grant select, insert, delete on public.channels to authenticated;
grant update (name, is_private) on public.channels to authenticated;

grant select, insert, delete on public.channel_members to authenticated;
grant update (role) on public.channel_members to authenticated;

-- ------------------------------------------------------------------- RPCs

-- Find or create the 1:1 DM between the caller and another user.
create or replace function public.get_or_create_dm(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  found_id uuid;
  new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if other_user = me then raise exception 'cannot start a DM with yourself'; end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'unknown user';
  end if;

  -- serialise concurrent calls for the same pair so we never create duplicates
  perform pg_advisory_xact_lock(hashtext(least(me, other_user)::text || greatest(me, other_user)::text));

  select c.id into found_id
  from public.channels c
  where c.kind = 'dm'
    and (select count(*) from public.channel_members m where m.channel_id = c.id) = 2
    and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = me)
    and exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = other_user)
  limit 1;

  if found_id is not null then return found_id; end if;

  insert into public.channels (kind, is_private, created_by) values ('dm', true, me) returning id into new_id;
  insert into public.channel_members (channel_id, user_id) values (new_id, me), (new_id, other_user);
  return new_id;
end;
$$;

-- Owner promotes/demotes between admin and member. Ownership transfer is out of scope for now.
create or replace function public.set_app_role(target uuid, new_role public.app_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and app_role = 'owner') then
    raise exception 'only the owner can change roles';
  end if;
  if new_role = 'owner' then raise exception 'ownership transfer is not supported'; end if;

  update public.profiles set app_role = new_role where id = target and app_role <> 'owner';
  if not found then raise exception 'cannot change the role of this user'; end if;
end;
$$;

-- Functions default to executable by everyone; restrict to signed-in users.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
