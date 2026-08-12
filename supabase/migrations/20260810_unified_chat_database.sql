-- Unified Chat Database (from scratch) for Supabase
-- Purpose: one single, production-oriented schema for:
-- profiles, chat messages, resumable chunk uploads, file reconstruction,
-- history exports, notifications, and storage buckets.
--
-- Recommended usage:
-- 1) Run in a NEW Supabase project (clean database)
-- 2) If you run this in an existing DB, review object collisions first

-- -----------------------------
-- 1) Extensions
-- -----------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- -----------------------------
-- 2) Core tables
-- -----------------------------

create table if not exists public.chat_sessions (
  id text primary key,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id text primary key,
  name text not null,
  photo_url text,
  status text not null default 'offline',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_status_check
    check (status in ('online', 'offline', 'typing', 'connecting', 'safe_mode'))
);

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null references public.chat_sessions(id) on delete cascade,
  local_id text not null,

  sender text not null references public.profiles(id) on delete restrict,
  receiver text not null references public.profiles(id) on delete restrict,

  type text not null,
  content text not null default '',
  status text not null default 'pending',

  -- media metadata
  media_mime text,
  media_size_bytes bigint,
  media_duration_ms integer,
  media_width integer,
  media_height integer,
  media_storage_path text,
  media_sha256 text,

  -- resumable upload progress
  chunks_total integer not null default 0,
  chunks_sent integer not null default 0,

  -- app-side observability
  retry_count integer not null default 0,
  device_id text,
  metadata jsonb not null default '{}'::jsonb,

  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,

  constraint messages_type_check
    check (type in ('text', 'image', 'audio', 'video')),
  constraint messages_status_check
    check (status in ('pending', 'sent', 'delivered', 'read', 'failed')),
  constraint messages_chunks_non_negative
    check (chunks_total >= 0 and chunks_sent >= 0 and chunks_sent <= greatest(chunks_total, 0)),
  constraint messages_not_self
    check (sender <> receiver)
);

create unique index if not exists messages_local_id_key
  on public.messages(local_id);

create index if not exists messages_session_timestamp_idx
  on public.messages(session_id, timestamp desc);

create index if not exists messages_sender_receiver_idx
  on public.messages(sender, receiver, timestamp desc);

create index if not exists messages_status_idx
  on public.messages(status);

create index if not exists messages_type_idx
  on public.messages(type);

create index if not exists messages_metadata_gin_idx
  on public.messages using gin(metadata);

-- temporary chunks for resumable uploads
create table if not exists public.file_chunks (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null,
  local_id text not null,
  sender text not null references public.profiles(id) on delete restrict,
  chunk_index integer not null,
  chunk_size integer not null,
  chunk_data bytea not null,
  checksum_sha256 text,
  created_at timestamptz not null default now(),
  constraint file_chunks_index_non_negative check (chunk_index >= 0),
  constraint file_chunks_size_non_negative check (chunk_size >= 0),
  unique (session_id, local_id, chunk_index)
);

create index if not exists file_chunks_lookup_idx
  on public.file_chunks(session_id, local_id, chunk_index);

-- final reconstructed media files
create table if not exists public.reconstructed_files (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null,
  local_id text not null,
  file_url text not null,
  file_size_bytes bigint,
  checksum_sha256 text,
  reconstructed_by text references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, local_id)
);

-- exported history audit
create table if not exists public.history_exports (
  id uuid primary key default uuid_generate_v4(),
  session_id text not null references public.chat_sessions(id) on delete cascade,
  requested_by text references public.profiles(id) on delete set null,
  email text,
  file_url text,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint history_exports_status_check
    check (status in ('queued', 'processing', 'done', 'failed'))
);

-- optional push readiness (FCM/APNs token registry)
create table if not exists public.device_tokens (
  id uuid primary key default uuid_generate_v4(),
  profile_id text not null references public.profiles(id) on delete cascade,
  platform text not null,
  token text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_tokens_platform_check
    check (platform in ('android', 'ios', 'web')),
  unique (token)
);

create index if not exists device_tokens_profile_active_idx
  on public.device_tokens(profile_id, active);

-- queue for eventual notifications and delivery retries
create table if not exists public.notification_queue (
  id uuid primary key default uuid_generate_v4(),
  message_id uuid references public.messages(id) on delete cascade,
  receiver text not null references public.profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_queue_status_check
    check (status in ('pending', 'processing', 'sent', 'failed'))
);

create index if not exists notification_queue_status_retry_idx
  on public.notification_queue(status, next_retry_at);

-- -----------------------------
-- 3) Timestamp and state triggers
-- -----------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_chat_sessions_touch on public.chat_sessions;
create trigger trg_chat_sessions_touch
before update on public.chat_sessions
for each row
execute procedure public.touch_updated_at();

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
before update on public.profiles
for each row
execute procedure public.touch_updated_at();

drop trigger if exists trg_messages_touch on public.messages;
create trigger trg_messages_touch
before update on public.messages
for each row
execute procedure public.touch_updated_at();

drop trigger if exists trg_device_tokens_touch on public.device_tokens;
create trigger trg_device_tokens_touch
before update on public.device_tokens
for each row
execute procedure public.touch_updated_at();

drop trigger if exists trg_notification_queue_touch on public.notification_queue;
create trigger trg_notification_queue_touch
before update on public.notification_queue
for each row
execute procedure public.touch_updated_at();

create or replace function public.messages_status_audit()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'delivered' and old.status is distinct from new.status then
    new.delivered_at = coalesce(new.delivered_at, now());
  end if;

  if new.status = 'read' and old.status is distinct from new.status then
    new.read_at = coalesce(new.read_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_messages_status_audit on public.messages;
create trigger trg_messages_status_audit
before update on public.messages
for each row
execute procedure public.messages_status_audit();

-- -----------------------------
-- 4) RPC helpers for mobile app
-- -----------------------------

create or replace function public.get_shared_room_messages(
  p_session_id text default 'shared-room',
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
  limit least(greatest(p_limit, 1), 1000)
$$;

create or replace function public.sync_pending_message_status(
  p_local_id text,
  p_status text,
  p_chunks_sent integer,
  p_chunks_total integer
)
returns void
language plpgsql
security invoker
as $$
begin
  update public.messages
  set
    status = case
      when p_status in ('pending', 'sent', 'delivered', 'read', 'failed') then p_status
      else status
    end,
    chunks_sent = greatest(0, coalesce(p_chunks_sent, chunks_sent)),
    chunks_total = greatest(0, coalesce(p_chunks_total, chunks_total))
  where local_id = p_local_id;
end;
$$;

create or replace function public.append_file_chunk(
  p_session_id text,
  p_local_id text,
  p_sender text,
  p_chunk_index integer,
  p_chunk_data bytea,
  p_checksum_sha256 text default null
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.file_chunks (
    session_id,
    local_id,
    sender,
    chunk_index,
    chunk_size,
    chunk_data,
    checksum_sha256
  )
  values (
    p_session_id,
    p_local_id,
    p_sender,
    p_chunk_index,
    octet_length(p_chunk_data),
    p_chunk_data,
    p_checksum_sha256
  )
  on conflict (session_id, local_id, chunk_index)
  do update set
    chunk_size = excluded.chunk_size,
    chunk_data = excluded.chunk_data,
    checksum_sha256 = excluded.checksum_sha256;
end;
$$;

create or replace function public.get_chunk_resume_state(
  p_session_id text,
  p_local_id text
)
returns table (
  max_chunk_index integer,
  uploaded_chunks integer,
  uploaded_bytes bigint
)
language sql
stable
as $$
  select
    coalesce(max(chunk_index), -1) as max_chunk_index,
    count(*)::integer as uploaded_chunks,
    coalesce(sum(chunk_size), 0)::bigint as uploaded_bytes
  from public.file_chunks
  where session_id = p_session_id
    and local_id = p_local_id
$$;

create or replace function public.finalize_reconstructed_file(
  p_session_id text,
  p_local_id text,
  p_file_url text,
  p_file_size_bytes bigint,
  p_checksum_sha256 text,
  p_reconstructed_by text
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.reconstructed_files (
    session_id,
    local_id,
    file_url,
    file_size_bytes,
    checksum_sha256,
    reconstructed_by
  )
  values (
    p_session_id,
    p_local_id,
    p_file_url,
    p_file_size_bytes,
    p_checksum_sha256,
    p_reconstructed_by
  )
  on conflict (session_id, local_id)
  do update set
    file_url = excluded.file_url,
    file_size_bytes = excluded.file_size_bytes,
    checksum_sha256 = excluded.checksum_sha256,
    reconstructed_by = excluded.reconstructed_by,
    created_at = now();

  delete from public.file_chunks
  where session_id = p_session_id
    and local_id = p_local_id;
end;
$$;

-- -----------------------------
-- 5) Seed data
-- -----------------------------

insert into public.chat_sessions (id, title)
values ('shared-room', 'Chat Privado Roberto y Monica')
on conflict (id) do update set title = excluded.title;

insert into public.profiles (id, name, status)
values
  ('roberto', 'Roberto', 'offline'),
  ('monica', 'Monica', 'offline')
on conflict (id) do update set name = excluded.name;

-- -----------------------------
-- 6) Storage buckets + policies
-- -----------------------------

insert into storage.buckets (id, name, public)
select 'chat-files', 'chat-files', true
where not exists (select 1 from storage.buckets where id = 'chat-files');

insert into storage.buckets (id, name, public)
select 'app-updates', 'app-updates', true
where not exists (select 1 from storage.buckets where id = 'app-updates');

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'storage_select_chat_files'
  ) then
    execute $policy$
      create policy storage_select_chat_files
      on storage.objects
      for select
      to anon, authenticated
      using (bucket_id = 'chat-files')
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'storage_insert_chat_files'
  ) then
    execute $policy$
      create policy storage_insert_chat_files
      on storage.objects
      for insert
      to anon, authenticated
      with check (bucket_id = 'chat-files')
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'storage_update_chat_files'
  ) then
    execute $policy$
      create policy storage_update_chat_files
      on storage.objects
      for update
      to anon, authenticated
      using (bucket_id = 'chat-files')
      with check (bucket_id = 'chat-files')
    $policy$;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'storage_delete_chat_files'
  ) then
    execute $policy$
      create policy storage_delete_chat_files
      on storage.objects
      for delete
      to anon, authenticated
      using (bucket_id = 'chat-files')
    $policy$;
  end if;
end
$$;

-- -----------------------------
-- 7) RLS + app policies
-- -----------------------------

alter table public.chat_sessions enable row level security;
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.file_chunks enable row level security;
alter table public.reconstructed_files enable row level security;
alter table public.history_exports enable row level security;
alter table public.device_tokens enable row level security;
alter table public.notification_queue enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions' and policyname = 'chat_sessions_all_app'
  ) then
    execute 'create policy chat_sessions_all_app on public.chat_sessions for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_all_app'
  ) then
    execute 'create policy profiles_all_app on public.profiles for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_all_app'
  ) then
    execute 'create policy messages_all_app on public.messages for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'file_chunks' and policyname = 'file_chunks_all_app'
  ) then
    execute 'create policy file_chunks_all_app on public.file_chunks for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reconstructed_files' and policyname = 'reconstructed_files_all_app'
  ) then
    execute 'create policy reconstructed_files_all_app on public.reconstructed_files for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'history_exports' and policyname = 'history_exports_all_app'
  ) then
    execute 'create policy history_exports_all_app on public.history_exports for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'device_tokens' and policyname = 'device_tokens_all_app'
  ) then
    execute 'create policy device_tokens_all_app on public.device_tokens for all to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_queue' and policyname = 'notification_queue_all_app'
  ) then
    execute 'create policy notification_queue_all_app on public.notification_queue for all to anon, authenticated using (true) with check (true)';
  end if;
end
$$;

-- -----------------------------
-- 8) Realtime publication
-- -----------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      execute 'alter publication supabase_realtime add table public.profiles';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'file_chunks'
    ) then
      execute 'alter publication supabase_realtime add table public.file_chunks';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reconstructed_files'
    ) then
      execute 'alter publication supabase_realtime add table public.reconstructed_files';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_queue'
    ) then
      execute 'alter publication supabase_realtime add table public.notification_queue';
    end if;
  end if;
end
$$;
