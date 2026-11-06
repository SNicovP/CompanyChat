-- Soft delete ("archive") for clients and projects.
-- Archived projects (and every project of an archived client) become inaccessible: their messages,
-- search results, unread counts and notifications disappear for everyone. Admins and client managers can
-- still see the archived rows (to restore them); nothing is deleted.

alter table public.clients add column archived_at timestamptz;
alter table public.channels add column archived_at timestamptz;

-- One definition of who may see a channel: now also requires the project and its client to be active.
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
            exists (select 1 from public.profiles p where p.id = uid and p.app_role in ('owner', 'admin'))
            or exists (select 1 from public.client_members cm where cm.client_id = c.client_id and cm.user_id = uid and cm.role = 'manager')
            or (not c.is_private and exists (select 1 from public.client_members cm where cm.client_id = c.client_id and cm.user_id = uid))
          ))
        )
    );
$$;

-- Members no longer see an archived client; admins and its managers still do (to restore it).
drop policy "clients: visible to admins and members" on public.clients;
create policy "clients: visible to admins and members" on public.clients for select to authenticated
  using (
    public.can_manage_client(id)
    or (public.is_client_member(id) and archived_at is null)
  );

-- Archive / restore. Clients: admins only. Projects: anyone who can manage the project.
create or replace function public.set_client_archived(cid uuid, archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() or not public.is_app_admin() then raise exception 'only admins can archive clients'; end if;
  update public.clients set archived_at = case when archived then now() else null end where id = cid;
  if not found then raise exception 'client not found'; end if;
end;
$$;

create or replace function public.set_channel_archived(chid uuid, archived boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() or not public.can_manage_channel(chid) then raise exception 'not allowed to archive this project'; end if;
  update public.channels set archived_at = case when archived then now() else null end where id = chid;
end;
$$;

-- Archiving replaces deleting: take hard deletes away from the app (cascades stay as a safety net).
revoke delete on public.clients, public.channels from authenticated;
drop policy "clients: admins delete" on public.clients;
drop policy "channels: managers delete projects" on public.channels;

revoke execute on function public.set_client_archived(uuid, boolean), public.set_channel_archived(uuid, boolean) from public, anon;
grant execute on function public.set_client_archived(uuid, boolean), public.set_channel_archived(uuid, boolean) to authenticated;
