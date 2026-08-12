-- Core chat schema for two local profiles (roberto/monica)
-- Idempotent migration: safe to run multiple times.

create extension if not exists "uuid-ossp";

create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  sender text,
  receiver text,
  type text,
  content text,
  timestamp timestamptz default now(),
  status text,
  chunks_total integer,
  chunks_sent integer,
  session_id text,
  local_id text
);

alter table public.messages
  add column if not exists sender text,
  add column if not exists receiver text,
  add column if not exists type text,
  add column if not exists content text,
  add column if not exists timestamp timestamptz default now(),
  add column if not exists status text,
  add column if not exists chunks_total integer,
  add column if not exists chunks_sent integer,
  add column if not exists session_id text,
  add column if not exists local_id text;

update public.messages
set
  sender = coalesce(sender, ''),
  receiver = coalesce(receiver, ''),
  type = coalesce(type, 'text'),
  content = coalesce(content, ''),
  status = coalesce(status, 'pending'),
  chunks_total = coalesce(chunks_total, 1),
  chunks_sent = coalesce(chunks_sent, 0),
  session_id = coalesce(session_id, 'shared-room'),
  local_id = coalesce(local_id, id::text)
where
  sender is null
  or receiver is null
  or type is null
  or content is null
  or status is null
  or chunks_total is null
  or chunks_sent is null
  or session_id is null
  or local_id is null;

alter table public.messages
  alter column sender set not null,
  alter column receiver set not null,
  alter column type set not null,
  alter column content set not null,
  alter column timestamp set not null,
  alter column status set not null,
  alter column chunks_total set not null,
  alter column chunks_sent set not null,
  alter column session_id set not null,
  alter column local_id set not null;

alter table public.messages
  alter column type set default 'text',
  alter column status set default 'pending',
  alter column chunks_total set default 1,
  alter column chunks_sent set default 0,
  alter column session_id set default 'shared-room';

alter table public.messages
  drop constraint if exists messages_type_check;

alter table public.messages
  add constraint messages_type_check
  check (type in ('text', 'image', 'audio'));

alter table public.messages
  drop constraint if exists messages_status_check;

alter table public.messages
  add constraint messages_status_check
  check (status in ('pending', 'sent', 'delivered', 'read'));

create index if not exists messages_session_ts_idx
  on public.messages (session_id, timestamp asc);

create index if not exists messages_sender_receiver_ts_idx
  on public.messages (sender, receiver, timestamp desc);

create index if not exists messages_status_idx
  on public.messages (status);

create unique index if not exists messages_local_id_idx
  on public.messages (local_id);

create table if not exists public.profiles (
  id text primary key,
  name text,
  photo_url text,
  status text
);

alter table public.profiles
  add column if not exists name text,
  add column if not exists photo_url text,
  add column if not exists status text;

update public.profiles
set
  name = coalesce(name, initcap(id)),
  status = coalesce(status, 'offline')
where name is null or status is null;

alter table public.profiles
  alter column id set not null,
  alter column name set not null,
  alter column status set not null;

alter table public.profiles
  alter column status set default 'offline';

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('online', 'offline', 'typing', 'connecting', 'safe_mode'));

insert into public.profiles (id, name, photo_url, status)
values
  ('roberto', 'Roberto', null, 'offline'),
  ('monica', 'Monica', null, 'offline')
on conflict (id) do update set
  name = excluded.name;

alter table public.messages enable row level security;
alter table public.profiles enable row level security;

-- messages policies

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages_select_app'
  ) then
    execute 'create policy messages_select_app on public.messages for select to anon, authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages_insert_app'
  ) then
    execute 'create policy messages_insert_app on public.messages for insert to anon, authenticated with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages_update_app'
  ) then
    execute 'create policy messages_update_app on public.messages for update to anon, authenticated using (true) with check (true)';
  end if;
end
$$;

-- profiles policies

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_select_app'
  ) then
    execute 'create policy profiles_select_app on public.profiles for select to anon, authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_insert_app'
  ) then
    execute 'create policy profiles_insert_app on public.profiles for insert to anon, authenticated with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'profiles_update_app'
  ) then
    execute 'create policy profiles_update_app on public.profiles for update to anon, authenticated using (true) with check (true)';
  end if;
end
$$;

insert into storage.buckets (id, name, public)
select 'chat-files', 'chat-files', true
where not exists (
  select 1 from storage.buckets where id = 'chat-files'
);

-- storage policies for chat-files bucket

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

-- Realtime publication for shared channel usage in clients

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messages'
    ) then
      execute 'alter publication supabase_realtime add table public.messages';
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'profiles'
    ) then
      execute 'alter publication supabase_realtime add table public.profiles';
    end if;
  end if;
end
$$;

-- Helper RPCs used by mobile app for low-bandwidth sync and upload resume.
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
    status = p_status,
    chunks_sent = greatest(0, coalesce(p_chunks_sent, chunks_sent)),
    chunks_total = greatest(1, coalesce(p_chunks_total, chunks_total))
  where local_id = p_local_id;
end;
$$;

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
