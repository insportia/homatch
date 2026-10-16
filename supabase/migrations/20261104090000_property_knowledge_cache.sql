-- Find Property 2.0 — Property Knowledge Engine, exact cache.
--
-- One validated extraction per (normalized description hash, schema version).
-- A repeated description anywhere in any later search costs zero model calls.
-- Rollback: bump KNOWLEDGE_SCHEMA_VERSION (old rows stop matching) or set
-- invalidated_at. Rows hold facts with short verbatim spans of public listing
-- text (phone-like digit runs redacted, max 200 chars) and are service-role only.

create table if not exists public.property_knowledge_cache (
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  schema_version integer not null check (schema_version >= 1),
  extraction jsonb not null check (jsonb_typeof(extraction) = 'object'),
  source text not null check (source in ('DETERMINISTIC', 'MODEL')),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd is null or cost_usd >= 0),
  hit_count integer not null default 0 check (hit_count >= 0),
  created_at timestamptz not null default now(),
  last_hit_at timestamptz,
  invalidated_at timestamptz,
  primary key (content_hash, schema_version),
  check (source = 'DETERMINISTIC' or model is not null)
);

comment on table public.property_knowledge_cache is
  'Find Property Knowledge Engine exact cache: validated description extraction keyed on sha256 of the normalized text and the schema version. Service role only.';

create index if not exists property_knowledge_cache_created_idx on public.property_knowledge_cache (created_at desc);

alter table public.property_knowledge_cache enable row level security;
revoke all on public.property_knowledge_cache from public, anon, authenticated;
grant select, insert, update on public.property_knowledge_cache to service_role;
