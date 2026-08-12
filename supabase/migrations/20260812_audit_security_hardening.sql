-- Audit fix: audit-fixes/2026-08-12-RB
-- Block: auth and RLS hardening
-- Ref: audit finding "RLS policies use 'using(true)' for all roles without identity restriction"
-- Scope: replace open anon policies with sender/receiver aware RLS
-- Note: This migration is additive and non-destructive. Old policies are dropped first.
--       Idempotent via IF NOT EXISTS and DO $$ blocks.
--       Validated on staging before PR.

-- ============================================================
-- 1) Drop overly-permissive open policies (replace with scoped)
-- ============================================================

-- messages: restrict reads to own sender/receiver only
drop policy if exists messages_all_app on public.messages;
drop policy if exists messages_select_app on public.messages;
drop policy if exists messages_insert_app on public.messages;
drop policy if exists messages_update_app on public.messages;
drop policy if exists messages_delete_app on public.messages;

-- Replace with scoped policies using profile-based claim.
-- For the current two-profile no-auth model, we encode the profile id in the
-- request header 'x-app-profile-id'. The policies use this value via a helper.
--
-- NOTE: Once Supabase Auth is introduced (phase 2), replace the claim with
-- auth.uid() and a profiles->auth_user_id mapping. The policy structure below
-- already mirrors that final shape for minimal future diff.

create or replace function public.app_profile_id()
returns text
language sql stable parallel safe
as $$
  select coalesce(
    current_setting('request.headers', true)::jsonb->>'x-app-profile-id',
    ''
  )
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select_profile'
  ) then
    execute $p$
      create policy messages_select_profile on public.messages
        for select to anon, authenticated
        using (
          sender = public.app_profile_id()
          or receiver = public.app_profile_id()
        )
    $p$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_insert_profile'
  ) then
    execute $p$
      create policy messages_insert_profile on public.messages
        for insert to anon, authenticated
        with check (
          sender = public.app_profile_id()
          and sender <> receiver
        )
    $p$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_update_profile'
  ) then
    execute $p$
      create policy messages_update_profile on public.messages
        for update to anon, authenticated
        using (
          sender = public.app_profile_id()
          or receiver = public.app_profile_id()
        )
        with check (
          sender = public.app_profile_id()
          or receiver = public.app_profile_id()
        )
    $p$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_delete_profile'
  ) then
    execute $p$
      create policy messages_delete_profile on public.messages
        for delete to anon, authenticated
        using (sender = public.app_profile_id())
    $p$;
  end if;
end $$;

-- ============================================================
-- 2) device_tokens: restrict to own profile
-- ============================================================

drop policy if exists device_tokens_all_app on public.device_tokens;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'device_tokens' and policyname = 'device_tokens_own_profile'
  ) then
    execute $p$
      create policy device_tokens_own_profile on public.device_tokens
        for all to anon, authenticated
        using (profile_id = public.app_profile_id())
        with check (profile_id = public.app_profile_id())
    $p$;
  end if;
end $$;

-- ============================================================
-- 3) notification_queue: app writes only; reads restricted to receiver
-- ============================================================

drop policy if exists notification_queue_all_app on public.notification_queue;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notification_queue' and policyname = 'notification_queue_receiver'
  ) then
    execute $p$
      create policy notification_queue_receiver on public.notification_queue
        for select to anon, authenticated
        using (receiver = public.app_profile_id())
    $p$;
  end if;
end $$;

-- ============================================================
-- 4) Keep profiles and chat_sessions read-open for two-profile app
--    (will be tightened in phase 2 when auth.uid() is available)
-- ============================================================

-- profiles: keep existing open read, restrict self-write only
drop policy if exists profiles_all_app on public.profiles;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_open'
  ) then
    execute 'create policy profiles_select_open on public.profiles for select to anon, authenticated using (true)';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_update_own'
  ) then
    execute $p$
      create policy profiles_update_own on public.profiles
        for update to anon, authenticated
        using (id = public.app_profile_id())
        with check (id = public.app_profile_id())
    $p$;
  end if;
end $$;

-- ============================================================
-- 5) Add last_error column to notification_queue for observability
--    (idempotent: column added only if missing)
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_queue' and column_name = 'last_error'
  ) then
    alter table public.notification_queue add column last_error text;
  end if;
end $$;

-- ============================================================
-- 6) Idempotency index: prevent double-enqueue per message
-- ============================================================

create unique index if not exists notification_queue_message_id_unique
  on public.notification_queue (message_id)
  where message_id is not null and status not in ('sent', 'failed');

-- ============================================================
-- End of migration: 20260812_audit_security_hardening.sql
-- ============================================================
