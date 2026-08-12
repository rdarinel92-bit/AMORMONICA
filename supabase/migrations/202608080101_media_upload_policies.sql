-- Fix upload reliability for images/audio from anon client.
-- Idempotent migration: safe to run multiple times.

-- 1) Optional column used by audio notes.
alter table if exists public.messages
  add column if not exists duration_ms integer;

-- 2) Ensure RLS is enabled on messages.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'messages'
  ) then
    execute 'alter table public.messages enable row level security';
  end if;
end
$$;

-- 3) Minimal app policies for chat messages (anon/authenticated).
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

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages_delete_app'
  ) then
    execute 'create policy messages_delete_app on public.messages for delete to anon, authenticated using (true)';
  end if;
end
$$;

-- 4) Storage policies for upload/download/delete in the app bucket.
-- If you use another bucket, replace chat-files below.
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
