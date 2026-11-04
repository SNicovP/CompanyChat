-- @channel: a message containing the token @[channel] mentions everyone who can see the channel
-- (except the author and deactivated users), using the same message_mentions rows as personal mentions,
-- so unread @badges and desktop notifications work unchanged.

create or replace function public.sync_message_mentions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ids uuid[];
begin
  select coalesce(array_agg(distinct m[1]::uuid), '{}') into ids
  from regexp_matches(new.body, '@\[([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]', 'g') as m;

  -- Explicit mentions: real people who can see the channel, never the author, at most 20.
  ids := (
    select coalesce(array_agg(u), '{}') from (
      select u from unnest(ids) as u
      where u is distinct from new.user_id and public.can_user_access_channel(u, new.channel_id)
      limit 20
    ) limited
  );

  if new.body ~* '@\[channel\]' then
    ids := ids || (
      select coalesce(array_agg(p.id), '{}') from public.profiles p
      where p.id is distinct from new.user_id and public.can_user_access_channel(p.id, new.channel_id)
    );
  end if;

  delete from public.message_mentions where message_id = new.id and not (user_id = any (ids));
  insert into public.message_mentions (message_id, user_id, channel_id)
    select new.id, u, new.channel_id from unnest(ids) as u
    on conflict do nothing;
  return null;
end;
$$;
