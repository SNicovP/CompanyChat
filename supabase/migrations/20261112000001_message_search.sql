-- Message search: word-prefix full-text search over messages the caller can already read.

alter table public.messages
  add column body_tsv tsvector generated always as (
    -- @[uuid] mention tokens are not searchable text
    to_tsvector('simple'::regconfig, regexp_replace(body, '@\[[0-9a-fA-F-]{36}\]', ' ', 'g'))
  ) stored;

create index messages_body_tsv_idx on public.messages using gin (body_tsv);

-- SECURITY INVOKER on purpose: the messages select policy (can_access_channel) filters the results,
-- so people never find messages from channels they cannot open.
create or replace function public.search_messages(q text, lim int default 30)
returns table (id uuid, channel_id uuid, user_id uuid, body text, created_at timestamptz)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tsq tsquery;
begin
  select to_tsquery('simple'::regconfig, string_agg(w || ':*', ' & '))
    into tsq
    from unnest(regexp_split_to_array(lower(coalesce(q, '')), '[^[:alnum:]]+')) as w
    where w <> '';

  if tsq is null then
    return;
  end if;

  return query
    select m.id, m.channel_id, m.user_id, m.body, m.created_at
    from public.messages m
    where m.body_tsv @@ tsq
    order by m.created_at desc
    limit least(greatest(coalesce(lim, 30), 1), 100);
end;
$$;

revoke execute on function public.search_messages(text, int) from public, anon;
grant execute on function public.search_messages(text, int) to authenticated;
