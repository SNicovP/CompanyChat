-- "Watching" a project channel means desktop notifications for every message in it.
-- Without a watch, projects only notify on @mentions; DMs always notify. Rows are private to the user.

create table public.channel_watches (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.channel_watches enable row level security;

create policy "watches: see your own" on public.channel_watches for select to authenticated
  using (user_id = auth.uid());
create policy "watches: watch channels you can access" on public.channel_watches for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_channel(channel_id));
create policy "watches: stop watching" on public.channel_watches for delete to authenticated
  using (user_id = auth.uid());
create policy "active users only" on public.channel_watches as restrictive for all to authenticated
  using (public.is_active_user());

revoke all on public.channel_watches from anon, authenticated;
grant select, delete on public.channel_watches to authenticated;
grant insert (channel_id) on public.channel_watches to authenticated;
