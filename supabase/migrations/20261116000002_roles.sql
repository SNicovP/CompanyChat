-- Roles
--   super_admin  everything; the only one who can promote/demote admins and deactivate them. The first user.
--   admin        full access: clients, projects, who is in them, users.
--   member       read and write in the clients/projects they were added to, and DMs. Cannot create or change
--                clients or projects.
--   viewer       read only in the clients/projects they were added to, but can still DM (to ask about what they read).
-- Client/project "managers" are retired: only admins manage clients, projects and their members. The
-- membership role columns stay (unused) so they can come back if clients ever get access to the app.

create or replace function public.is_app_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and app_role in ('super_admin', 'admin'));
$$;

create or replace function public.is_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and app_role = 'viewer');
$$;

create or replace function public.can_manage_client(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin();
$$;

create or replace function public.can_manage_channel(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin() and exists (select 1 from public.channels c where c.id = chid and c.kind = 'project');
$$;

-- Who can see a channel: its members, admins, and (unless it is private) members of its client.
-- Archived projects/clients are invisible to everyone.
create or replace function public.can_user_access_channel(uid uuid, chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active from public.profiles p where p.id = uid), false)
    and exists (
      select 1 from public.channels c
      where c.id = chid
        and c.archived_at is null
        and (c.client_id is null or exists (select 1 from public.clients cl where cl.id = c.client_id and cl.archived_at is null))
        and (
          exists (select 1 from public.channel_members m where m.channel_id = c.id and m.user_id = uid)
          or (c.kind = 'project' and (
            exists (select 1 from public.profiles p where p.id = uid and p.app_role in ('super_admin', 'admin'))
            or (not c.is_private and exists (select 1 from public.client_members cm where cm.client_id = c.client_id and cm.user_id = uid))
          ))
        )
    );
$$;
revoke execute on function public.can_user_access_channel(uuid, uuid) from public, anon, authenticated;

-- Viewers can only write in DMs.
create or replace function public.can_post_in_channel(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_access_channel(chid)
    and (
      not public.is_viewer()
      or exists (select 1 from public.channels c where c.id = chid and c.kind = 'dm')
    );
$$;

drop policy "messages: post as yourself in accessible channels" on public.messages;
create policy "messages: post as yourself in accessible channels" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_post_in_channel(channel_id));

drop policy "messages: authors edit their own" on public.messages;
create policy "messages: authors edit their own" on public.messages for update to authenticated
  using (user_id = auth.uid() and public.can_post_in_channel(channel_id))
  with check (user_id = auth.uid());

-- The first user is the super admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, app_role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'member'::public.app_role
         else 'super_admin'::public.app_role end
  );
  return new;
end;
$$;

-- Changing roles. The super admin sets any role except super_admin. Admins may switch people between
-- member and viewer. Nobody changes a super admin, and nobody changes their own role.
create or replace function public.set_app_role(target uuid, new_role public.app_role)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor public.app_role;
  cur_role public.app_role;
begin
  select app_role into actor from public.profiles where id = auth.uid() and is_active;
  if actor is null or actor not in ('super_admin', 'admin') then raise exception 'only admins can change roles'; end if;
  if new_role = 'super_admin' then raise exception 'the super admin role cannot be assigned'; end if;
  if target = auth.uid() then raise exception 'you cannot change your own role'; end if;

  select app_role into cur_role from public.profiles where id = target;
  if cur_role is null or cur_role = 'super_admin' then raise exception 'cannot change the role of this user'; end if;
  if actor = 'admin' and (cur_role = 'admin' or new_role = 'admin') then
    raise exception 'only the super admin can promote or demote admins';
  end if;

  update public.profiles set app_role = new_role where id = target;
end;
$$;

revoke execute on function public.is_viewer(), public.can_post_in_channel(uuid) from public, anon;
grant execute on function public.is_viewer(), public.can_post_in_channel(uuid) to authenticated;
