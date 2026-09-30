-- Design Studio: what an AI job really cost, and whether we know.
--
-- The Design Studio AI handlers priced tokens from two environment rates
-- that were never set, so every job was written as ai_cost_cents = 0 and
-- landed_cogs_cents = 0 — a silent zero indistinguishable from "free".
-- The canonical price book (provider_price_book, via price_per_unit_at)
-- already prices the model; this makes the handlers use it and records
-- the answer's quality explicitly.
--
--  1. usage_events.pricing_state — nullable, same vocabulary as
--     cost_events. NULL means "writer did not say" (every existing writer
--     keeps working unchanged); UNPRICED means the book had no rate, so
--     the zero in the cost columns is NOT a cost.
--  2. ds_ai_cost_evidence() — service-only: prices one AI call from the
--     book and says ESTIMATED (rates found) or UNPRICED (a rate missing).
--  3. Backfill: Design Studio rows written before this, re-priced from the
--     book at their own timestamp, with provenance in metadata.
--  4. finance_design_studio_economics() — admin-only sample statistics
--     for the finance page. It reports COGS; it never proposes a price.

ALTER TABLE public.usage_events ADD COLUMN IF NOT EXISTS pricing_state text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usage_events_pricing_state_check') THEN
    ALTER TABLE public.usage_events ADD CONSTRAINT usage_events_pricing_state_check
      CHECK (pricing_state IS NULL OR pricing_state IN ('ACTUAL', 'ESTIMATED', 'PARTIAL', 'UNPRICED', 'ZERO_REAL'));
  END IF;
END $$;

COMMENT ON COLUMN public.usage_events.pricing_state IS
  'How the cost columns were obtained: ACTUAL (provider-billed), ESTIMATED (tokens x price book), PARTIAL, UNPRICED (no rate: the zero is unknown, not free), ZERO_REAL. NULL = writer did not state it.';

-- ── 2. Price one AI call from the book ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.ds_ai_cost_evidence(
  p_model text,
  p_input_tokens bigint DEFAULT 0,
  p_cached_tokens bigint DEFAULT 0,
  p_output_tokens bigint DEFAULT 0,
  p_at timestamptz DEFAULT now(),
  p_provider text DEFAULT 'OPENAI'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare
  v_in  numeric := public.price_per_unit_at(p_provider, p_model, 'INPUT_TOKEN', p_at);
  v_out numeric := public.price_per_unit_at(p_provider, p_model, 'OUTPUT_TOKEN', p_at);
  v_ai numeric;
begin
  -- Both token rates are required. One missing rate makes the whole call
  -- unpriced: a half-priced number would read as a real (too low) cost.
  if v_in is null or v_out is null then
    return jsonb_build_object('pricing_state', 'UNPRICED', 'ai_cost_cents', null,
      'provider', upper(p_provider), 'model', p_model);
  end if;
  v_ai := public.billing_ai_cost_cents(p_model, p_input_tokens, p_cached_tokens, p_output_tokens, 0, p_at, p_provider);
  return jsonb_build_object('pricing_state', 'ESTIMATED', 'ai_cost_cents', v_ai,
    'landed_cogs_cents', public.billing_landed_cogs_cents(0, v_ai, 0, 0),
    'provider', upper(p_provider), 'model', p_model);
end;
$fn$;

REVOKE ALL ON FUNCTION public.ds_ai_cost_evidence(text, bigint, bigint, bigint, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ds_ai_cost_evidence(text, bigint, bigint, bigint, timestamptz, text) TO service_role;

-- ── 3. Backfill the Design Studio rows written with the silent zero ─────
DO $$
declare r record; v jsonb;
begin
  for r in
    select id, model, provider, input_tokens, cached_tokens, output_tokens, created_at
      from public.usage_events
     where product_code like 'DS\_%' escape '\'
       and pricing_state is null
       and model is not null
  loop
    v := public.ds_ai_cost_evidence(r.model, coalesce(r.input_tokens, 0), coalesce(r.cached_tokens, 0),
                                    coalesce(r.output_tokens, 0), r.created_at, upper(coalesce(r.provider, 'OPENAI')));
    if v->>'pricing_state' = 'ESTIMATED' then
      update public.usage_events
         set ai_cost_cents = (v->>'ai_cost_cents')::numeric,
             landed_cogs_cents = (v->>'landed_cogs_cents')::numeric,
             pricing_state = 'ESTIMATED',
             metadata = metadata || jsonb_build_object('cost_known', true,
               'cost_backfill', jsonb_build_object('migration', '20261001190000', 'source', 'provider_price_book',
                 'previous_ai_cost_cents', 0, 'previous_landed_cogs_cents', 0))
       where id = r.id;
    else
      update public.usage_events
         set pricing_state = 'UNPRICED',
             metadata = metadata || jsonb_build_object('cost_known', false)
       where id = r.id;
    end if;
  end loop;
end $$;

-- ── 4. Admin economics: what a Design Studio AI job costs us ───────────
CREATE OR REPLACE FUNCTION public.finance_design_studio_economics(p_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
declare v_from timestamptz;
begin
  perform public.finance_require_admin();
  v_from := now() - (greatest(coalesce(p_days, 90), 1) || ' days')::interval;

  return jsonb_build_object(
    'window_days', greatest(coalesce(p_days, 90), 1),
    'operations', coalesce((
      select jsonb_agg(o order by o->>'product_code') from (
        select jsonb_build_object(
          'product_code', product_code,
          'samples', count(*),
          'priced', count(*) filter (where pricing_state in ('ACTUAL', 'ESTIMATED', 'ZERO_REAL')),
          'unpriced', count(*) filter (where pricing_state is null or pricing_state in ('UNPRICED', 'PARTIAL')),
          'credits_charged', coalesce(sum(charged_credits), 0),
          -- Every statistic below is over PRICED samples only: an unknown
          -- cost is excluded, never averaged in as zero.
          'avg_input_tokens', round(avg(input_tokens) filter (where p), 0),
          'avg_output_tokens', round(avg(output_tokens) filter (where p), 0),
          'avg_ai_cents', round(avg(ai_cost_cents) filter (where p), 4),
          'avg_landed_cents', round(avg(landed_cogs_cents) filter (where p), 4),
          'median_landed_cents', round((percentile_cont(0.5) within group (order by landed_cogs_cents) filter (where p))::numeric, 4),
          'p90_landed_cents', round((percentile_cont(0.9) within group (order by landed_cogs_cents) filter (where p))::numeric, 4),
          'p95_landed_cents', round((percentile_cont(0.95) within group (order by landed_cogs_cents) filter (where p))::numeric, 4),
          'max_landed_cents', round(max(landed_cogs_cents) filter (where p), 4),
          'by_model', (
            select coalesce(jsonb_agg(jsonb_build_object('model', m.model, 'samples', m.n, 'avg_landed_cents', m.avg_landed)), '[]'::jsonb)
              from (select coalesce(u2.model, '—') model, count(*) n,
                           round(avg(u2.landed_cogs_cents) filter (where u2.pricing_state in ('ACTUAL', 'ESTIMATED', 'ZERO_REAL')), 4) avg_landed
                      from public.usage_events u2
                     where u2.product_code = s.product_code and u2.created_at >= v_from
                     group by 1) m)
        ) o
        from (select u.*, (u.pricing_state in ('ACTUAL', 'ESTIMATED', 'ZERO_REAL')) as p
                from public.usage_events u
               where u.product_code like 'DS\_%' escape '\' and u.created_at >= v_from) s
        group by product_code
      ) t(o)
    ), '[]'::jsonb)
  );
end;
$fn$;

REVOKE ALL ON FUNCTION public.finance_design_studio_economics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_design_studio_economics(integer) TO authenticated, service_role;
