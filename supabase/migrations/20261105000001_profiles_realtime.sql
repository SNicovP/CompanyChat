-- Broadcast profile changes (manual status, name, role) so other users see them live.
-- Supabase applies the profiles select policy (all signed-in users) to these events.
alter publication supabase_realtime add table public.profiles;
