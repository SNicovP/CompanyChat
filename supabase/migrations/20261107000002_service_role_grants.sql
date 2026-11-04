-- The project does not auto-expose new tables, so the server-side service_role (used by the
-- admin-users Edge Function) needs explicit access to what it reads and changes.
grant select, update on public.profiles to service_role;
