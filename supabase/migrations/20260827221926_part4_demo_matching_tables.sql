
-- ============================================================
-- HOMATCH Part 4 — Demo/Mock Matching tables
-- ============================================================

-- 1. Add mock_mode to raw_signals if not present
ALTER TABLE raw_signals ADD COLUMN IF NOT EXISTS mock_mode BOOLEAN NOT NULL DEFAULT false;

-- 2. Add mock_mode + preview columns to matches if not present
ALTER TABLE matches ADD COLUMN IF NOT EXISTS mock_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_platform TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_language TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_city TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_budget_min NUMERIC;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_budget_max NUMERIC;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_currency TEXT DEFAULT '$';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_bedrooms INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_recency TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS preview_excerpt TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_reasons TEXT[] DEFAULT '{}';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS signal_strength TEXT DEFAULT 'POTENTIAL';
ALTER TABLE matches ADD COLUMN IF NOT EXISTS intent_confidence NUMERIC DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS signal_id UUID REFERENCES raw_signals(id);

-- 3. match_unlocks_pending — server-side only, seed-demo-matches writes here,
--    atomic-unlock reads and consumes the row on unlock.
CREATE TABLE IF NOT EXISTS match_unlocks_pending (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id          UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  property_id       UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  full_signal_text  TEXT,
  full_source_url   TEXT,
  full_profile_url  TEXT,
  full_intent_json  JSONB,
  mock_mode         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_match_unlocks_pending_match_id ON match_unlocks_pending(match_id);
-- RLS enabled but no auth-role policies — only service_role can access
ALTER TABLE match_unlocks_pending ENABLE ROW LEVEL SECURITY;

-- 4. Add media columns to property_facts if not present
ALTER TABLE property_facts ADD COLUMN IF NOT EXISTS cover_image TEXT;
ALTER TABLE property_facts ADD COLUMN IF NOT EXISTS gallery_images TEXT[] DEFAULT '{}';

-- 5. Add signal metadata columns to raw_signals if not present
ALTER TABLE raw_signals ADD COLUMN IF NOT EXISTS intent_type TEXT;
ALTER TABLE raw_signals ADD COLUMN IF NOT EXISTS intent_json JSONB;
ALTER TABLE raw_signals ADD COLUMN IF NOT EXISTS profile_url TEXT;
