-- CONTACT US GETS A REAL BACKEND.
--
-- Same shape as partner_inquiries — the site's existing public-inquiry
-- pattern — with two hardenings that page earned the easy way and this one
-- should not: the write goes through an RPC whose signature carries the
-- validation (no open INSERT policy to outgrow), and each accepted message
-- notifies the admins through the notification centre they already watch.
-- A form that says "sent" is only honest if somebody can actually read the
-- message; this is the row and the doorbell.
--
-- (runs inside the migration runner's own transaction)

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'CONTACT_MESSAGE';

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  topic text not null default 'GENERAL',
  message text not null,
  locale text,
  -- The signed-in sender, when there is one. Never required: Contact is a
  -- public page and a visitor without an account is its main audience.
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'NEW',
  created_at timestamptz not null default now(),

  constraint contact_messages_topic_check
    check (topic in ('GENERAL', 'SUPPORT', 'BROKER', 'B2B', 'PARTNERSHIP')),
  constraint contact_messages_status_check
    check (status in ('NEW', 'READ', 'CLOSED'))
);

comment on table public.contact_messages is
  'Messages from the public /contact page. Written only by contact_submit, '
  'which validates and rate-limits; read by admins.';

create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

drop policy if exists contact_messages_admin_reads on public.contact_messages;
create policy contact_messages_admin_reads
  on public.contact_messages for select
  to public
  using (public.is_admin());
-- No INSERT policy on purpose: the RPC below is the only door in, so the
-- length and rate rules cannot be bypassed by a direct table write.

create or replace function public.contact_submit(
  p_name text,
  p_email text,
  p_topic text default 'GENERAL',
  p_message text default null,
  p_locale text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_message text := btrim(coalesce(p_message, ''));
  v_topic text := upper(btrim(coalesce(p_topic, 'GENERAL')));
  v_id uuid;
  v_admin record;
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  -- The pragmatic shape check: something@something.something. Real
  -- verification is replying to it, which is the whole product here.
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 200 then
    raise exception 'INVALID_EMAIL';
  end if;
  if length(v_message) < 10 or length(v_message) > 4000 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if v_topic not in ('GENERAL', 'SUPPORT', 'BROKER', 'B2B', 'PARTNERSHIP') then
    v_topic := 'GENERAL';
  end if;

  -- Abuse guard in the same transaction as the write: a sender gets three
  -- messages an hour. A fourth is refused, not silently dropped.
  if (select count(*) from public.contact_messages m
       where m.email = v_email and m.created_at > now() - interval '1 hour') >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  insert into public.contact_messages (name, email, topic, message, locale, user_id)
  values (v_name, v_email, v_topic, left(v_message, 4000),
          nullif(left(btrim(coalesce(p_locale, '')), 8), ''), auth.uid())
  returning id into v_id;

  -- The doorbell: every admin sees the message where they already look.
  for v_admin in select u.id from public.users u where u.is_admin loop
    perform public.notify_emit(
      v_admin.id,
      'CONTACT_MESSAGE'::public.notification_type,
      'Contact: ' || v_name || ' (' || v_topic || ')',
      left(v_message, 280),
      'NORMAL',
      '/admin',
      'contact_messages',
      v_id,
      'contact-message:' || v_id::text
    );
  end loop;

  return v_id;
end $$;

comment on function public.contact_submit(text, text, text, text, text) is
  'The one write path into contact_messages: validated, rate-limited per '
  'sender, and admin-notified in the same transaction.';

revoke all on function public.contact_submit(text, text, text, text, text) from public;
grant execute on function public.contact_submit(text, text, text, text, text) to anon, authenticated;

/* Admin triage, for whatever surface later wants to render the inbox. */
create or replace function public.admin_set_contact_message_status(
  p_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('NEW', 'READ', 'CLOSED') then raise exception 'INVALID_STATUS'; end if;
  update public.contact_messages set status = p_status where id = p_id;
  return found;
end $$;

revoke all on function public.admin_set_contact_message_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_contact_message_status(uuid, text) to authenticated;

-- (committed by the migration runner)
