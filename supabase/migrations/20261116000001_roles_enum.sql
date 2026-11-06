-- App roles: super_admin > admin > member > viewer.
-- Kept in its own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.app_role rename value 'owner' to 'super_admin';
alter type public.app_role add value if not exists 'viewer';
