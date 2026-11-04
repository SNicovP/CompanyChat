-- Messages in project channels and DMs. Access follows can_access_channel().

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  body text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index messages_channel_created_idx on public.messages (channel_id, created_at desc);

alter table public.messages enable row level security;

create policy "messages: readable if the channel is accessible" on public.messages for select to authenticated
  using (public.can_access_channel(channel_id));

create policy "messages: post as yourself in accessible channels" on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_channel(channel_id));

create policy "messages: authors edit their own" on public.messages for update to authenticated
  using (user_id = auth.uid() and public.can_access_channel(channel_id))
  with check (user_id = auth.uid());

-- Authors delete their own; project managers can moderate.
create policy "messages: authors and managers delete" on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.can_manage_channel(channel_id));

revoke all on public.messages from anon, authenticated;
grant select, delete on public.messages to authenticated;
grant insert (channel_id, body) on public.messages to authenticated;
grant update (body) on public.messages to authenticated;

create or replace function public.touch_message_edited()
returns trigger language plpgsql as $$
begin
  if new.body is distinct from old.body then new.edited_at := now(); end if;
  return new;
end;
$$;

create trigger messages_touch_edited
  before update on public.messages
  for each row execute function public.touch_message_edited();

-- Realtime: Supabase applies the select policy above to change events.
alter publication supabase_realtime add table public.messages;

-- Keep function privileges tight for anything added in this migration.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
