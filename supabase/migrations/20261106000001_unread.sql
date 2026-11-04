-- Per-user read markers, used to compute unread counts per channel.
-- Only reachable through the functions below (no direct table access).

create table public.channel_reads (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.channel_reads enable row level security;
revoke all on public.channel_reads from anon, authenticated;

-- Mark a channel as read up to now.
create or replace function public.mark_channel_read(chid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.can_access_channel(chid) then raise exception 'no access to this channel'; end if;

  insert into public.channel_reads (user_id, channel_id, last_read_at)
  values (auth.uid(), chid, now())
  on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

-- Unread messages (from other people) per accessible channel, only channels with unread > 0.
-- Project channels the user has never had a marker for start as "read now" so joining an old
-- project does not show its whole history as unread. A DM with no marker counts from its start.
create or replace function public.get_unread_counts()
returns table (chan_id uuid, unread bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;

  insert into public.channel_reads (user_id, channel_id, last_read_at)
  select me, c.id, now()
  from public.channels c
  where c.kind = 'project'
    and public.can_access_channel(c.id)
    and not exists (select 1 from public.channel_reads r where r.user_id = me and r.channel_id = c.id);

  return query
  select c.id, count(m.id)
  from public.channels c
  left join public.channel_reads r on r.user_id = me and r.channel_id = c.id
  join public.messages m
    on m.channel_id = c.id
   and m.user_id is distinct from me
   and m.created_at > coalesce(r.last_read_at, c.created_at)
  where public.can_access_channel(c.id)
  group by c.id;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
