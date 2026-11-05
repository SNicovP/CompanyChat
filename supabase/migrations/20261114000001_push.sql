-- Background (Web Push) notifications. One row per browser/device a person turned push on for.
-- The send-push Edge Function (triggered by a Database Webhook on messages INSERT) asks push_targets()
-- who should be notified, then delivers to those subscriptions.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  show_preview boolean not null default true,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push: see your own" on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy "push: change your own" on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "push: remove your own" on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
create policy "active users only" on public.push_subscriptions as restrictive for all to authenticated
  using (public.is_active_user());

revoke all on public.push_subscriptions from anon, authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant update (show_preview) on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

-- Subscribe this browser. A browser endpoint is unique, so if someone else signed in on the same browser
-- before, the subscription moves to the current user instead of failing.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_preview boolean, p_user_agent text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'not allowed'; end if;
  if length(p_endpoint) > 2000 or p_endpoint !~ '^https://' then raise exception 'invalid endpoint'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, show_preview, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_preview, true), left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
        show_preview = excluded.show_preview, user_agent = excluded.user_agent;
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, boolean, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, boolean, text) to authenticated;

-- Who should be pushed for a new message? Same rules as in-app notifications:
--   DMs always, @mentions (including @channel) always, other project messages only for people watching the channel.
-- Never the author, deactivated users, or people whose status is Do not disturb.
-- Only the server (service_role) may call this.
create or replace function public.push_targets(mid uuid)
returns table (user_id uuid, kind text)
language plpgsql stable security definer set search_path = public as $$
declare
  msg record;
  chan_kind public.channel_kind;
begin
  select m.id, m.channel_id, m.user_id into msg from public.messages m where m.id = mid;
  if not found then return; end if;
  select c.kind into chan_kind from public.channels c where c.id = msg.channel_id;

  return query
  with candidates as (
    select cm.user_id as uid, 'dm'::text as kind from public.channel_members cm
      where chan_kind = 'dm' and cm.channel_id = msg.channel_id
    union all
    select mm.user_id, 'mention' from public.message_mentions mm where mm.message_id = msg.id
    union all
    select w.user_id, 'watch' from public.channel_watches w
      where w.channel_id = msg.channel_id and public.can_user_access_channel(w.user_id, msg.channel_id)
  )
  select c.uid, (array_agg(c.kind order by case c.kind when 'mention' then 1 when 'dm' then 2 else 3 end))[1]
  from candidates c
  join public.profiles p on p.id = c.uid
  where c.uid is distinct from msg.user_id and p.is_active and p.status <> 'dnd'
  group by c.uid;
end;
$$;
revoke execute on function public.push_targets(uuid) from public, anon, authenticated;
grant execute on function public.push_targets(uuid) to service_role;

-- send-push reads these to build the notification text.
grant select on public.messages, public.channels, public.clients to service_role;
