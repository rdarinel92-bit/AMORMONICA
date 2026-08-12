-- Typing status table for real-time "is typing" indicators
-- Similar to WhatsApp/Telegram typing notifications

create table if not exists public.typing_status (
  id bigserial primary key,
  sender text not null,
  session_id text not null,
  is_typing boolean default true,
  updated_at timestamp with time zone default now()
);

-- Index for quick queries
create index if not exists idx_typing_status_session_sender 
  on public.typing_status(session_id, sender);

-- Enable RLS
alter table public.typing_status enable row level security;

-- Minimal policy: anyone can read/write
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'typing_status'
      and policyname = 'typing_status_select_app'
  ) then
    execute 'create policy typing_status_select_app on public.typing_status for select to anon, authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'typing_status'
      and policyname = 'typing_status_insert_app'
  ) then
    execute 'create policy typing_status_insert_app on public.typing_status for insert to anon, authenticated with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'typing_status'
      and policyname = 'typing_status_delete_app'
  ) then
    execute 'create policy typing_status_delete_app on public.typing_status for delete to anon, authenticated using (true)';
  end if;
end
$$;
