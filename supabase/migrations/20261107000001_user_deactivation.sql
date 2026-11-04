-- Deactivating a user: the admin-users Edge Function bans the auth user (no new sign-ins or token
-- refreshes) and sets profiles.is_active = false. These rules cut off a still-valid session too.

alter table public.profiles add column is_active boolean not null default true;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

-- Restrictive policies are ANDed with every other policy: a deactivated user sees and changes nothing.
create policy "active users only" on public.profiles as restrictive for all to authenticated using (public.is_active_user());
create policy "active users only" on public.clients as restrictive for all to authenticated using (public.is_active_user());
create policy "active users only" on public.client_members as restrictive for all to authenticated using (public.is_active_user());
create policy "active users only" on public.channels as restrictive for all to authenticated using (public.is_active_user());
create policy "active users only" on public.channel_members as restrictive for all to authenticated using (public.is_active_user());
create policy "active users only" on public.messages as restrictive for all to authenticated using (public.is_active_user());

-- Functions that bypass RLS (security definer) check it explicitly.
create or replace function public.can_access_channel(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
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
  if not public.is_active_user() then raise exception 'account is deactivated'; end if;
  if other_user = me then raise exception 'cannot start a DM with yourself'; end if;
  if not exists (select 1 from public.profiles where id = other_user and is_active) then
    raise exception 'unknown user';
  end if;

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

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
