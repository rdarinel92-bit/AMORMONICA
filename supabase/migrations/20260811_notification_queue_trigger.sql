-- Enqueue push notifications for new chat messages.
-- Safe to run multiple times.

create or replace function public.enqueue_notification_for_message()
returns trigger
language plpgsql
as $$
begin
  if new.sender is not null
     and new.receiver is not null
     and new.status in ('sent', 'delivered', 'read') then
    insert into public.notification_queue (
      message_id,
      receiver,
      payload,
      status,
      retry_count,
      next_retry_at
    )
    values (
      new.id,
      new.receiver,
      jsonb_build_object(
        'message_id', new.id,
        'sender', new.sender,
        'body', left(coalesce(new.content, ''), 500),
        'type', new.type,
        'session_id', new.session_id,
        'local_id', new.local_id
      ),
      'pending',
      0,
      now()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_notification_for_message on public.messages;
create trigger trg_enqueue_notification_for_message
after insert on public.messages
for each row
execute procedure public.enqueue_notification_for_message();