-- Deleting a single attachment keeps the message: the file is removed from storage by the app and
-- the row is flagged, so the chat can show an "Attachment deleted" tag in its place.

alter table public.message_attachments add column deleted_at timestamptz;

-- The message author (or a manager of the project) may flag an attachment as deleted, and nothing
-- else about it. The check stops anyone from un-deleting.
create policy "attachments: author or manager flags as deleted" on public.message_attachments for update to authenticated
  using (
    public.can_manage_channel(channel_id)
    or exists (select 1 from public.messages m where m.id = message_id and m.user_id = auth.uid())
  )
  with check (deleted_at is not null);

grant update (deleted_at) on public.message_attachments to authenticated;
