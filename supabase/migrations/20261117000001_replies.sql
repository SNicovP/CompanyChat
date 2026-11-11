-- Replying to a message (like WhatsApp): a message can point at an earlier message in the same channel.
-- If the original is deleted the reply stays, it just loses its quote.

alter table public.messages
  add column reply_to uuid references public.messages (id) on delete set null;

create index messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;

-- Senders may set reply_to on insert only; it cannot be changed afterwards.
grant insert (channel_id, body, reply_to) on public.messages to authenticated;

-- A reply must quote a message in the same channel, otherwise someone could quote text from a
-- channel they can see into one they cannot (or probe for message ids).
create or replace function public.check_reply_channel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to is not null
     and not exists (select 1 from public.messages m where m.id = new.reply_to and m.channel_id = new.channel_id) then
    raise exception 'You can only reply to a message in the same conversation';
  end if;
  return new;
end;
$$;

create trigger messages_check_reply
  before insert on public.messages
  for each row execute function public.check_reply_channel();

-- Only the trigger runs this; nobody needs to call it directly.
revoke execute on function public.check_reply_channel() from public, anon, authenticated;
