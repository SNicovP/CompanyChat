-- `insert ... returning` re-checks the SELECT policy against the new row, but
-- can_access_channel() looks the channel up by id and cannot see a row inserted in the
-- same statement. Let people who may manage the client read its project channels directly
-- from the row's own columns so project creation can return the new row.

drop policy "channels: visible if accessible" on public.channels;

create policy "channels: visible if accessible" on public.channels for select to authenticated
  using (
    public.can_access_channel(id)
    or (kind = 'project' and public.can_manage_client(client_id))
  );
