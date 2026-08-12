-- Incremental migration: chunked media, reconstruction, exports, and read-status automation.
-- Designed to be compatible with the existing schema in this repository.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Ensure profiles table has updated_at for presence/status freshness.
alter table public.profiles
  add column if not exists updated_at timestamptz default now();

-- Keep updated_at fresh when profile rows are changed.
create or replace function public.touch_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch_updated_at on public.profiles;
create trigger trg_profiles_touch_updated_at
before update on public.profiles
for each row
execute procedure public.touch_profiles_updated_at();

-- Support video messages in existing check constraint.
alter table public.messages
  drop constraint if exists messages_type_check;

alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'image', 'audio', 'video'));

-- Optional fields used by block uploads / local ordering.
alter table public.messages
  add column if not exists created_at timestamptz default now();

-- Keep defaults aligned with app behavior.
alter table public.messages
  alter column chunks_total set default 0,
  alter column chunks_sent set default 0,
  alter column status set default 'pending';

-- Make sure local_id stays unique for sync reconciliation.
create unique index if not exists messages_local_id_idx
  on public.messages (local_id);

-- Table to store temporary chunks before reconstruction.
create table if not exists public.file_chunks (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null,
  chunk_index integer not null,
  chunk_data bytea not null,
  created_at timestamptz default now(),
  unique (session_id, chunk_index)
);

create index if not exists idx_file_chunks_session
  on public.file_chunks(session_id, chunk_index);

-- Table for reconstructed final assets.
create table if not exists public.reconstructed_files (
  session_id text primary key,
  file_url text not null,
  created_at timestamptz default now()
);

-- Table for export tracking.
create table if not exists public.history_exports (
  id uuid primary key default uuid_generate_v4(),
  profile_id text references public.profiles(id) on delete set null,
  file_url text,
  created_at timestamptz default now()
);

-- Auto-transition delivered -> read (kept as requested by product flow).
create or replace function public.update_message_read()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' then
    update public.messages
    set status = 'read'
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_message_read on public.messages;
create trigger trg_message_read
after update on public.messages
for each row
when (new.status = 'delivered')
execute procedure public.update_message_read();

-- RLS enablement for new tables.
alter table public.file_chunks enable row level security;
alter table public.reconstructed_files enable row level security;
alter table public.history_exports enable row level security;

-- Policies for app usage (anon/authenticated) aligned with existing open app policy style.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'file_chunks'
      and policyname = 'file_chunks_all_app'
  ) then
    execute 'create policy file_chunks_all_app on public.file_chunks for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'reconstructed_files'
      and policyname = 'reconstructed_files_all_app'
  ) then
    execute 'create policy reconstructed_files_all_app on public.reconstructed_files for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'history_exports'
      and policyname = 'history_exports_all_app'
  ) then
    execute 'create policy history_exports_all_app on public.history_exports for all to anon, authenticated using (true) with check (true)';
  end if;
end
$$;

-- Realtime publication for new tables when publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'file_chunks'
    ) then
      execute 'alter publication supabase_realtime add table public.file_chunks';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'reconstructed_files'
    ) then
      execute 'alter publication supabase_realtime add table public.reconstructed_files';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'history_exports'
    ) then
      execute 'alter publication supabase_realtime add table public.history_exports';
    end if;
  end if;
end
$$;
