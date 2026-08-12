-- Audit fix: audit-fixes/2026-08-12-RB
-- Block: notification queue improvements for WhatsApp-style delivery
-- Ref: audit findings "duplicate enqueue on retries", "missing TTL", "no delivery evidence"

-- ============================================================
-- 1) Add TTL and delivery tracking to notification_queue
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_queue' and column_name = 'ttl_expires_at'
  ) then
    alter table public.notification_queue add column ttl_expires_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_queue' and column_name = 'dispatched_at'
  ) then
    alter table public.notification_queue add column dispatched_at timestamptz;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_queue' and column_name = 'token_count'
  ) then
    alter table public.notification_queue add column token_count integer;
  end if;
end $$;

-- ============================================================
-- 2) Auto-populate TTL on insert (24 hours by default)
-- ============================================================

create or replace function public.set_notification_ttl()
returns trigger language plpgsql as $$
begin
  if new.ttl_expires_at is null then
    new.ttl_expires_at := now() + interval '24 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notification_ttl on public.notification_queue;
create trigger trg_notification_ttl
before insert on public.notification_queue
for each row
execute procedure public.set_notification_ttl();

-- ============================================================
-- 3) Idempotent enqueue function replacing the plain trigger
--    (Avoids re-enqueueing if a pending/processing entry already exists)
-- ============================================================

create or replace function public.enqueue_notification_for_message()
returns trigger language plpgsql as $$
begin
  if new.sender is null or new.receiver is null then
    return new;
  end if;

  if new.status not in ('sent', 'delivered', 'read') then
    return new;
  end if;

  -- Idempotent: skip if already queued and not yet terminal
  if exists (
    select 1 from public.notification_queue
    where message_id = new.id
      and status not in ('sent', 'failed')
  ) then
    return new;
  end if;

  insert into public.notification_queue (
    message_id,
    receiver,
    payload,
    status,
    retry_count,
    next_retry_at,
    ttl_expires_at
  )
  values (
    new.id,
    new.receiver,
    jsonb_build_object(
      'message_id', new.id,
      'sender',     new.sender,
      'body',       left(coalesce(new.content, ''), 500),
      'type',       new.type,
      'session_id', new.session_id,
      'local_id',   new.local_id
    ),
    'pending',
    0,
    now(),
    now() + interval '24 hours'
  )
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_notification_for_message on public.messages;
create trigger trg_enqueue_notification_for_message
after insert on public.messages
for each row
execute procedure public.enqueue_notification_for_message();

-- ============================================================
-- 4) Clean up expired queue entries (safe to run as cron or on-demand)
-- ============================================================

create or replace function public.purge_expired_notifications(p_days integer default 3)
returns integer language plpgsql security definer as $$
declare
  deleted_count integer;
begin
  delete from public.notification_queue
  where status in ('sent', 'failed')
    and updated_at < now() - (p_days || ' days')::interval;

  get diagnostics deleted_count = row_count;

  delete from public.notification_queue
  where ttl_expires_at is not null and ttl_expires_at < now()
    and status not in ('processing');

  return deleted_count;
end;
$$;

-- ============================================================
-- 5) Index on TTL for efficient cleanup queries
-- ============================================================

create index if not exists notification_queue_ttl_idx
  on public.notification_queue (ttl_expires_at)
  where ttl_expires_at is not null;

-- ============================================================
-- End of migration: 20260812_notification_improvements.sql
-- ============================================================
