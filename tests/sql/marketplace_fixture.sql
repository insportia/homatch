-- rate_limit_events exactly as production defines it (20260828194650_production_hardening_import_diagnostics.sql).
create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  ip_address text,
  operation text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_rate_limit_user_op on public.rate_limit_events(user_id, operation, created_at);
