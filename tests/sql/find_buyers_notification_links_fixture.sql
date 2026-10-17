-- Fixture for 20261112090000_find_buyers_notification_links.sql: the notification
-- stub gains the columns production has (deep_link, entity, property_id).
alter table public.notifications add column if not exists deep_link text;
alter table public.notifications add column if not exists entity_type text;
alter table public.notifications add column if not exists entity_id uuid;
alter table public.notifications add column if not exists property_id uuid;
create or replace function public.notify_emit(p_user_id uuid, p_type public.notification_type, p_title text, p_body text,
  p_priority text default 'NORMAL', p_deep_link text default null, p_entity_type text default null, p_entity_id uuid default null,
  p_dedupe_key text default null, p_group_key text default null, p_group_window interval default null,
  p_group_title_template text default null, p_metadata jsonb default '{}') returns uuid language sql as $$
  insert into public.notifications (user_id, type, title, body, dedupe_key, deep_link, entity_type, entity_id)
  values (p_user_id, p_type, p_title, p_body, p_dedupe_key, p_deep_link, p_entity_type, p_entity_id)
  on conflict (dedupe_key) do nothing returning id $$;
