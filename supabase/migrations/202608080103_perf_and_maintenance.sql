-- Performance and maintenance improvements for chat workload
-- Safe to run multiple times (uses IF NOT EXISTS / CREATE OR REPLACE)

-- 1) Indexes for history reads and sender/status filters
create index if not exists messages_session_ts_desc_idx
on public.messages (session_id, timestamp desc);

create index if not exists messages_session_sender_ts_desc_idx
on public.messages (session_id, sender, timestamp desc);

create index if not exists messages_session_status_ts_idx
on public.messages (session_id, status, timestamp desc);

-- 2) Optional maintenance function to prune old messages
create or replace function public.prune_old_messages(p_days integer default 60)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with deleted as (
    delete from public.messages
    where timestamp < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*) into v_count from deleted;

  return coalesce(v_count, 0);
end;
$$;

-- 3) Read helper for paginated history (optional)
create or replace function public.get_messages_page(
  p_session_id text,
  p_limit integer default 200,
  p_before timestamptz default null
)
returns setof public.messages
language sql
stable
as $$
  select *
  from public.messages
  where session_id = p_session_id
    and (p_before is null or timestamp < p_before)
  order by timestamp desc
  limit greatest(1, least(p_limit, 500));
$$;
