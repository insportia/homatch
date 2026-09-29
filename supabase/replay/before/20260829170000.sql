-- Needed by 20260829170000_controlled_external_consumer.sql, which reads and
-- writes these discovery_query_queue columns. They were added in production by
-- hand and no earlier migration declares them. Types are production's own
-- (information_schema, 2026-09-29). 20260930130000 now declares them for the
-- repository too (add column if not exists -- a no-op in production).
alter table public.discovery_query_queue
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_token uuid,
  add column if not exists estimated_cost_usd numeric,
  add column if not exists finished_at timestamptz,
  add column if not exists actual_cost_usd numeric;
