-- Security hardening: lock search_path on helper functions

create or replace function public.prune_old_messages(p_days integer default 60)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
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

create or replace function public.get_messages_page(
  p_session_id text,
  p_limit integer default 200,
  p_before timestamptz default null
)
returns setof public.messages
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select *
  from public.messages
  where session_id = p_session_id
    and (p_before is null or timestamp < p_before)
  order by timestamp desc
  limit greatest(1, least(p_limit, 500));
$$;
