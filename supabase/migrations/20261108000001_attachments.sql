-- File and image attachments on messages.
-- Files live in the private "attachments" storage bucket at  <channel_id>/<message_id>/<file name>
-- and are referenced from message_attachments. Access follows the channel the message is in.

-- A message may now be attachment-only, so the body can be empty (the UI still requires text or a file).
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_length check (length(body) <= 4000);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  path text not null unique,
  file_name text not null check (length(file_name) between 1 and 255),
  mime_type text,
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  created_at timestamptz not null default now(),
  constraint message_attachments_path_check check (path like channel_id::text || '/' || message_id::text || '/%')
);
create index message_attachments_message_idx on public.message_attachments (message_id);

alter table public.message_attachments enable row level security;

create policy "attachments: readable with the channel" on public.message_attachments for select to authenticated
  using (public.can_access_channel(channel_id));

-- Only the author of a message can attach files to it (and only within its own channel).
create policy "attachments: authors attach to their own messages" on public.message_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id and m.user_id = auth.uid() and m.channel_id = message_attachments.channel_id
    )
  );

create policy "active users only" on public.message_attachments as restrictive for all to authenticated
  using (public.is_active_user());

revoke all on public.message_attachments from anon, authenticated;
grant select on public.message_attachments to authenticated;
grant insert (message_id, channel_id, path, file_name, mime_type, size_bytes) on public.message_attachments to authenticated;

alter publication supabase_realtime add table public.message_attachments;

-- Storage: private bucket, 10 MB per file.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;

-- Read: anyone who can access the channel (first folder in the path).
create policy "attachments: read in accessible channels" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_access_channel(((storage.foldername(name))[1])::uuid)
  );

-- Upload: only into the folder of a message you wrote, in the channel it belongs to.
create policy "attachments: upload to your own message" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.messages m
      where m.id = ((storage.foldername(name))[2])::uuid
        and m.channel_id = ((storage.foldername(name))[1])::uuid
        and m.user_id = auth.uid()
    )
  );

-- Delete: the uploader, or a manager of the project.
create policy "attachments: uploader or manager deletes" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (owner = auth.uid() or public.can_manage_channel(((storage.foldername(name))[1])::uuid))
  );

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
