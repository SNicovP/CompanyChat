-- Profiles: one row per auth user, holds display info, app-level role and manual status.

create type public.app_role as enum ('owner', 'admin', 'member');
create type public.user_status as enum ('online', 'away', 'busy', 'dnd');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  app_role public.app_role not null default 'member',
  status public.user_status not null default 'online',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper for later policies: is the current user an owner/admin?
create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and app_role in ('owner', 'admin')
  );
$$;

-- Everyone signed in can see everyone (small office directory).
create policy "profiles are visible to signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

-- Users edit only their own row, and only these columns (never app_role).
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Explicit grants (the project does not auto-expose new tables to the Data API).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, status) on public.profiles to authenticated;

-- Create a profile on signup/invite. The very first user becomes the owner.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, app_role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'member'::public.app_role
         else 'owner'::public.app_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
