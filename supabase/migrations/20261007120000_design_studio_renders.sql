-- HOMATCH DESIGN STUDIO — the designed home, seen: render records, their money, and the design's DNA.
--
--   ds_renders              one picture a customer asked for: a MASTER (dollhouse)
--                           or ROOM view of an approved design version, or an EDIT
--                           of one. The Blender factory draws it (a deterministic
--                           picture plus an object map: id image + legend); an
--                           image model may give it a photoreal finish, which is
--                           checked against the Blender picture and refused when
--                           it moved anything. The row keeps the view, the storage
--                           keys (never shown raw), the finish and its structure
--                           check, the quote it was started under, the billing
--                           state (reserve → settle → release), the measured cost
--                           lines (unknown stays null, never zero) and the timings.
--                           Idempotent per (user_id, idempotency_key): a retried
--                           start returns the same rows and never charges twice.
--   ds_versions.design_dna  PropertyDesignDNA: the customer's choices resolved once
--                           (palette, finishes, lighting, look words), reused by
--                           every render and edit of that version. Written by the
--                           owner's own client (the existing owner UPDATE policy).
--
-- Billable products, REGISTERED AND MEASURED, NOT PRICED (the pattern of
-- 20260930093000): DS_MASTER_RENDER, DS_ROOM_RENDER, DS_RENDER_EDIT. Pricing
-- stays inactive until an owner decision sets it (proposed figures live in
-- supabase/functions/_shared/designStudio/renderPricing.ts, marked PROPOSED).
-- While design_studio_billing_enabled is false every render records its real
-- COGS as an unbilled usage event and charges nothing.
--
-- The owner reads their renders; only the server (service role, in the
-- design-studio-reconstruct edge function) writes them.

CREATE TABLE IF NOT EXISTS public.ds_renders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.ds_projects(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  version_id       uuid NOT NULL REFERENCES public.ds_versions(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('MASTER','ROOM','EDIT')),
  parent_id        uuid REFERENCES public.ds_renders(id) ON DELETE SET NULL,
  view             jsonb NOT NULL CHECK (jsonb_typeof(view) = 'object' AND octet_length(view::text) <= 8192),
  status           text NOT NULL DEFAULT 'QUEUED'
                     CHECK (status IN ('QUOTED','QUEUED','RENDERING','FINISHING','READY','FAILED','CANCELLED')),
  factory_job_id   uuid REFERENCES public.ds_factory_jobs(id) ON DELETE SET NULL,
  base_key         text,
  map_key          text,
  final_key        text,
  legend           jsonb CHECK (legend IS NULL OR (jsonb_typeof(legend) = 'object' AND octet_length(legend::text) <= 262144)),
  finish           jsonb CHECK (finish IS NULL OR (jsonb_typeof(finish) = 'object' AND octet_length(finish::text) <= 8192)),
  edit             jsonb CHECK (edit IS NULL OR (jsonb_typeof(edit) = 'object' AND octet_length(edit::text) <= 8192)),
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  quote            jsonb CHECK (quote IS NULL OR (jsonb_typeof(quote) = 'object' AND octet_length(quote::text) <= 4096)),
  billing          jsonb CHECK (billing IS NULL OR (jsonb_typeof(billing) = 'object' AND octet_length(billing::text) <= 4096)),
  dna_key          text CHECK (dna_key IS NULL OR dna_key ~ '^[0-9a-f]{64}$'),
  cost             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cost) = 'array' AND octet_length(cost::text) <= 16384),
  timings          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(timings) = 'object' AND octet_length(timings::text) <= 16384),
  -- The finishing claim: exactly one poller finishes a render; a claim older than its lease lapses.
  lease_at         timestamptz,
  error            text CHECK (error IS NULL OR char_length(error) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key),
  CHECK ((kind = 'EDIT') = (parent_id IS NOT NULL)),
  CHECK ((kind = 'EDIT') = (edit IS NOT NULL)),
  -- Every picture lives in this customer's own Design Studio folder for this project.
  CHECK (base_key  IS NULL OR base_key  LIKE 'users/' || user_id::text || '/design-studio-%/' || project_id::text || '/%'),
  CHECK (map_key   IS NULL OR map_key   LIKE 'users/' || user_id::text || '/design-studio-%/' || project_id::text || '/%'),
  CHECK (final_key IS NULL OR final_key LIKE 'users/' || user_id::text || '/design-studio-%/' || project_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS idx_ds_renders_project ON public.ds_renders(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ds_renders_version ON public.ds_renders(version_id);
CREATE INDEX IF NOT EXISTS idx_ds_renders_job ON public.ds_renders(factory_job_id) WHERE factory_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ds_renders_parent ON public.ds_renders(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ds_renders_user_recent ON public.ds_renders(user_id, created_at DESC);

COMMENT ON TABLE public.ds_renders IS
  'Design Studio renders (master/room views and appearance edits): Blender picture + object map, optional checked photoreal finish, quote, billing state and measured COGS. Owner reads; server writes.';

ALTER TABLE public.ds_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ds_renders_select ON public.ds_renders;
CREATE POLICY ds_renders_select ON public.ds_renders
  FOR SELECT USING (user_id = public.auth_user_id() OR public.is_admin());
DROP POLICY IF EXISTS ds_renders_service ON public.ds_renders;
CREATE POLICY ds_renders_service ON public.ds_renders
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.ds_renders FROM public, anon, authenticated;
GRANT SELECT ON public.ds_renders TO authenticated;
GRANT ALL ON public.ds_renders TO service_role;

-- ── The design's DNA, kept with the version ───────────────────────────
-- The owner writes it through the existing ds_versions UPDATE policy
-- (user_id = auth_user_id()); the guard trigger leaves identity immutable and
-- only `state` advances the revision, so the DNA never bumps it.
ALTER TABLE public.ds_versions ADD COLUMN IF NOT EXISTS design_dna jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ds_versions_design_dna_check') THEN
    ALTER TABLE public.ds_versions ADD CONSTRAINT ds_versions_design_dna_check CHECK (
      design_dna IS NULL OR (
        jsonb_typeof(design_dna) = 'object'
        AND design_dna->>'version' = 'ds-dna-1'
        AND octet_length(design_dna::text) <= 32768));
  END IF;
END $$;
COMMENT ON COLUMN public.ds_versions.design_dna IS
  'PropertyDesignDNA (ds-dna-1): the customer''s choices resolved once, reused by every render and edit of this version. Look words only, never geometry.';

-- ── Billable products: registered and measured, pricing inactive ────────
insert into public.billable_products (
  code, name, billing_mode, requires_reservation,
  standard_retail_cents, reference_landed_cogs_cents, min_gross_margin_bps,
  estimate_strategy, enabled, pricing_active, min_viable_budget_credits,
  sort_order, config
) values
  ('DS_MASTER_RENDER', 'Design Studio master render', 'VARIABLE', true,
   0, 0, 3000, 'PER_UNIT', true, false, 0, 123,
   jsonb_build_object('estimate_spread_bps', 5000,
     'scope_note', 'Measured before priced. One dollhouse view of the whole designed home: Blender picture + object map, optional checked photoreal finish.')),
  ('DS_ROOM_RENDER', 'Design Studio room render', 'VARIABLE', true,
   0, 0, 3000, 'PER_UNIT', true, false, 0, 124,
   jsonb_build_object('estimate_spread_bps', 5000,
     'scope_note', 'Measured before priced. One eye-level view of one room: Blender picture + object map, optional checked photoreal finish.')),
  ('DS_RENDER_EDIT', 'Design Studio render edit', 'VARIABLE', true,
   0, 0, 3000, 'PER_UNIT', true, false, 0, 125,
   jsonb_build_object('estimate_spread_bps', 5000,
     'scope_note', 'Measured before priced. One appearance edit (colour/material of one target) repainted inside its own mask and checked.'))
on conflict (code) do nothing;

insert into public.product_plan_entitlements (product_code, plan_code, included_per_period, period, quality_tier)
select pc.code, p.code, 0, 'CALENDAR_MONTH', p.quality_tier
from public.billing_plans p
cross join (values ('DS_MASTER_RENDER'), ('DS_ROOM_RENDER'), ('DS_RENDER_EDIT')) as pc(code)
on conflict (product_code, plan_code) do nothing;
