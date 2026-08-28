alter table public.raw_signals
  add column if not exists property_id uuid references public.properties(id) on delete cascade;

create index if not exists raw_signals_property_status_idx
  on public.raw_signals(property_id, classification_status, discovered_at);
