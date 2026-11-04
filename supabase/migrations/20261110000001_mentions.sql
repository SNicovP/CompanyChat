-- @mentions. The app stores a mention in the message body as @[<user uuid>] (so renames never break
-- it) and the database derives message_mentions from the body, so it cannot be faked from the client.

-- Access check for an arbitrary user (used to avoid "mentioning" people who cannot see the channel).
-- can_access_channel() now delegates to it so there is one definition of who may see a channel.
create or replace function public.can_user_access_channel(uid uuid, chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_active from public.profiles p where p.id = uid), false)
    and exists (
      select 1 from public.channels c
      where c.id = chid
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

create or replace function public.can_access_channel(chid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_user_access_channel(auth.uid(), chid);
$$;

revoke execute on function public.can_user_access_channel(uuid, uuid) from public, anon, authenticated;

create table public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index message_mentions_user_channel_idx on public.message_mentions (user_id, channel_id);

alter table public.message_mentions enable row level security;

-- You only ever see mentions of yourself.
create policy "mentions: see your own" on public.message_mentions for select to authenticated
  using (user_id = auth.uid());
create policy "active users only" on public.message_mentions as restrictive for all to authenticated
  using (public.is_active_user());

revoke all on public.message_mentions from anon, authenticated;
grant select on public.message_mentions to authenticated;

alter publication supabase_realtime add table public.message_mentions;

-- Keep message_mentions in step with the body: only real, active people who can see the channel,
-- never the author, at most 20 per message.
create or replace function public.sync_message_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(distinct m[1]::uuid), '{}') into ids
  from regexp_matches(new.body, '@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]', 'g') as m;

  ids := (
    select coalesce(array_agg(u), '{}') from (
      select u from unnest(ids) as u
      where u is distinct from new.user_id and public.can_user_access_channel(u, new.channel_id)
      limit 20
    ) limited
  );

  delete from public.message_mentions where message_id = new.id and not (user_id = any (ids));
  insert into public.message_mentions (message_id, user_id, channel_id)
    select new.id, u, new.channel_id from unnest(ids) as u
    on conflict do nothing;
  return null;
end;
$$;

create trigger messages_sync_mentions
  after insert or update of body on public.messages
  for each row execute function public.sync_message_mentions();

-- Unread mentions per channel, using the same read markers as get_unread_counts().
create or replace function public.get_unread_mention_counts()
returns table (chan_id uuid, mentions bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  return query
  select mm.channel_id, count(*)
  from public.message_mentions mm
  join public.messages m on m.id = mm.message_id
  join public.channels c on c.id = mm.channel_id
  left join public.channel_reads r on r.user_id = me and r.channel_id = mm.channel_id
  where mm.user_id = me
    and public.can_access_channel(mm.channel_id)
    and m.created_at > coalesce(r.last_read_at, c.created_at)
  group by mm.channel_id;
end;
$$;

grant execute on function public.get_unread_mention_counts() to authenticated;
revoke execute on function public.get_unread_mention_counts() from public, anon;
