create table if not exists public.property_signal_candidates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  signal_id uuid not null references public.raw_signals(id) on delete cascade,
  query_id uuid references public.discovery_query_queue(id) on delete set null,
  acquisition_cost_usd numeric(12,6) not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(property_id, signal_id)
);
create index if not exists property_signal_candidates_property_idx on public.property_signal_candidates(property_id,last_seen_at desc);
create index if not exists property_signal_candidates_signal_idx on public.property_signal_candidates(signal_id);
alter table public.property_signal_candidates enable row level security;

do $$ begin
 if not exists (select 1 from pg_policies where schemaname='public' and tablename='property_signal_candidates' and policyname='Users read own candidate links') then
   create policy "Users read own candidate links" on public.property_signal_candidates for select using (public.user_owns_property(property_id));
 end if;
end $$;

create or replace function public.reject_non_demand_match()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare s record; i record;
begin
  if not exists(select 1 from public.property_signal_candidates c where c.property_id=new.property_id and c.signal_id=new.signal_id) then
    raise exception 'SIGNAL_NOT_SCOPED_TO_PROPERTY';
  end if;
  select classification_status,intent_type,original_text into s from public.raw_signals where id=new.signal_id;
  select intent_type,intent_confidence into i from public.intent_profiles where id=new.intent_profile_id;
  if s.classification_status is distinct from 'CLASSIFIED'
     or coalesce(i.intent_type,'') not in ('BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT')
     or coalesce(i.intent_confidence,0)<0.65
     or coalesce(s.intent_type,'') not in ('BUY','RENT','INVEST','RELOCATE_BUY','RELOCATE_RENT')
     or (coalesce(s.original_text,'') ~* '(apartment|house|villa|land|office|commercial|studio|penthouse).{0,25}for[[:space:]]+(rent|sale)|(^|[^[:alpha:]])(იყიდება|ქირავდება|сда[её]тся|прода[её]тся|kiralık|satılık|للإيجار|للبيع|להשכרה|למכירה)') then
    raise exception 'NON_DEMAND_SIGNAL_REJECTED';
  end if;
  return new;
end $$;

revoke execute on function public.reject_non_demand_match() from anon, authenticated;
