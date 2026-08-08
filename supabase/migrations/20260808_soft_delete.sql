-- Add soft-delete support to messages table
-- Images/audio can be marked as deleted without fully removing them

alter table if exists public.messages
  add column if not exists deleted_at timestamp with time zone;

-- Index for faster queries on non-deleted messages
create index if not exists idx_messages_not_deleted 
  on public.messages (session_id, timestamp) 
  where deleted_at is null;
