-- Extend the messages.status check constraint to include 'delivered' and 'read'
-- This allows proper two-tick (delivered/read) receipt tracking

-- Drop old constraint
alter table public.messages
  drop constraint if exists messages_status_check;

-- Add updated constraint with all valid statuses
alter table public.messages
  add constraint messages_status_check
  check (status in ('pending', 'sent', 'resumed', 'delivered', 'read', 'error'));
