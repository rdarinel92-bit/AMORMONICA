-- User profiles table - store photos and user data in Supabase
-- Each user has their own profile with avatar data

create table if not exists public.user_profiles (
  id bigserial primary key,
  sender text not null unique,
  session_id text not null,
  avatar_data text, -- Base64 encoded image data
  avatar_mime text default 'image/jpeg',
  updated_at timestamp with time zone default now()
);

-- Index for quick lookups
create index if not exists idx_user_profiles_sender 
  on public.user_profiles(sender);

create index if not exists idx_user_profiles_session_sender 
  on public.user_profiles(session_id, sender);

create or replace function public.set_user_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_user_profiles_updated_at();

-- Enable RLS
alter table public.user_profiles enable row level security;

-- Policies: anyone can read/write their own profiles
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_select_app'
  ) then
    execute 'create policy user_profiles_select_app on public.user_profiles for select to anon, authenticated using (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_insert_app'
  ) then
    execute 'create policy user_profiles_insert_app on public.user_profiles for insert to anon, authenticated with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_update_app'
  ) then
    execute 'create policy user_profiles_update_app on public.user_profiles for update to anon, authenticated using (true) with check (true)';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_profiles'
      and policyname = 'user_profiles_delete_app'
  ) then
    execute 'create policy user_profiles_delete_app on public.user_profiles for delete to anon, authenticated using (true)';
  end if;
end
$$;
