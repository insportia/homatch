-- Backs the Partners page inquiry form, which previously had no `<form>`,
-- no state, and no submit handler at all — clicking "Send" did nothing,
-- silently, for every visitor. This table captures those submissions;
-- the form itself is wired up in the same change.
create table if not exists public.partner_inquiries (
  id uuid primary key default gen_random_uuid(),
  company text,
  email text not null,
  category text,
  message text,
  status text not null default 'NEW' check (status in ('NEW', 'CONTACTED', 'CLOSED')),
  created_at timestamptz not null default now()
);

alter table public.partner_inquiries enable row level security;

-- Anyone (including anonymous visitors) may submit an inquiry.
create policy "partner_inquiries_insert_public"
  on public.partner_inquiries for insert
  to anon, authenticated
  with check (true);

-- Only admins can read submitted inquiries.
create policy "partner_inquiries_select_admin"
  on public.partner_inquiries for select
  to public
  using (is_admin());

create index if not exists idx_partner_inquiries_created_at on public.partner_inquiries (created_at desc);
