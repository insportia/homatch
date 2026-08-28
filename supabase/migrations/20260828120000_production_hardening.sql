-- ============================================================
-- HOMATCH Migration 00007 — Production Hardening
-- Rate limits, system health log, production settings,
-- dedup indexes, cost aggregate views
-- ============================================================

-- 1. Rate-limit tracking table
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  ip_address   text,
  operation    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_user_op ON rate_limit_events(user_id, operation, created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_ip_op   ON rate_limit_events(ip_address, operation, created_at);
CREATE INDEX IF NOT EXISTS idx_rate_limit_created ON rate_limit_events(created_at);

ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rate_limit_events' AND policyname='Service manages rate limits') THEN
    CREATE POLICY "Service manages rate limits" ON rate_limit_events
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 2. System health log table
CREATE TABLE IF NOT EXISTS system_health_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at          timestamptz NOT NULL DEFAULT now(),
  db_reachable        boolean NOT NULL DEFAULT false,
  storage_reachable   boolean NOT NULL DEFAULT false,
  supabase_reachable  boolean NOT NULL DEFAULT false,
  provider_statuses   jsonb,
  last_match_run_at   timestamptz,
  last_match_run_ok   boolean,
  last_failed_run_at  timestamptz,
  notes               text
);
CREATE INDEX IF NOT EXISTS idx_system_health_checked ON system_health_log(checked_at DESC);

ALTER TABLE system_health_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_health_log' AND policyname='Admins read health log') THEN
    CREATE POLICY "Admins read health log" ON system_health_log
      FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_health_log' AND policyname='Service manages health log') THEN
    CREATE POLICY "Service manages health log" ON system_health_log
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 3. Dedup: one active campaign per property
CREATE UNIQUE INDEX IF NOT EXISTS idx_matching_campaigns_active_property
  ON matching_campaigns(property_id)
  WHERE status IN ('ACTIVE', 'PENDING');

-- 4. Dedup: no re-import of same canonical URL for same user when already completed
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_imports_user_canonical
  ON property_imports(user_id, canonical_url)
  WHERE canonical_url IS NOT NULL AND status IN ('COMPLETED', 'PROCESSING');

-- 5. Production admin_settings
INSERT INTO admin_settings (key, value, description) VALUES
  ('spend_cap_global',              '"250"',  'Global monthly COGS hard ceiling in USD'),
  ('spend_cap_dataforseo',          '"40"',   'DataForSEO monthly cap in USD'),
  ('spend_cap_apify',               '"100"',  'Apify monthly cap in USD'),
  ('spend_cap_zenrows',             '"20"',   'ZenRows monthly cap in USD'),
  ('spend_cap_scrapingbee',         '"5"',    'ScrapingBee monthly cap in USD'),
  ('spend_cap_brightdata',          '"10"',   'BrightData monthly cap in USD'),
  ('spend_cap_openai',              '"15"',   'OpenAI monthly cap in USD'),
  ('mock_data_providers',           '"false"','MUST be false in production'),
  ('max_photos_per_property',       '"5"',    'Maximum photos per property'),
  ('rate_limit_imports_per_hour',   '"10"',   'Max property imports per user per hour'),
  ('rate_limit_matching_per_day',   '"20"',   'Max start-matching per user per day'),
  ('rate_limit_unlocks_per_hour',   '"30"',   'Max unlock attempts per user per hour'),
  ('max_import_retries',            '"3"',    'Maximum provider retry attempts per import'),
  ('circuit_breaker_threshold',     '"5"',    'Consecutive failures before circuit-break'),
  ('cache_ttl_hours',               '"24"',   'Hours to cache expensive provider results')
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;

-- 6. Daily cost aggregate view
CREATE OR REPLACE VIEW cost_events_daily AS
SELECT
  date_trunc('day', "timestamp") AS day,
  provider,
  COUNT(*)                        AS calls,
  SUM(cost_usd)                   AS total_cost_usd,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successes,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failures
FROM cost_events
GROUP BY 1, 2;

-- 7. Monthly cost aggregate view
CREATE OR REPLACE VIEW cost_events_monthly AS
SELECT
  date_trunc('month', "timestamp") AS month,
  provider,
  COUNT(*)                          AS calls,
  SUM(cost_usd)                     AS total_cost_usd,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successes,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) AS failures
FROM cost_events
GROUP BY 1, 2;

-- 8. Matching stats view
CREATE OR REPLACE VIEW admin_matching_stats AS
SELECT
  COUNT(*)                                                     AS total_matches,
  COUNT(*) FILTER (WHERE signal_strength = 'EXCEPTIONAL')      AS exceptional_count,
  COUNT(*) FILTER (WHERE signal_strength = 'VERY_STRONG')      AS very_strong_count,
  COUNT(*) FILTER (WHERE signal_strength = 'STRONG')           AS strong_count,
  COUNT(*) FILTER (WHERE signal_strength = 'GOOD')             AS good_count,
  COUNT(*) FILTER (WHERE signal_strength = 'POTENTIAL')        AS potential_count,
  ROUND(AVG(match_score)::numeric, 2)                          AS avg_match_score,
  COUNT(*) FILTER (WHERE mock_mode = false)                    AS real_matches,
  COUNT(*) FILTER (WHERE mock_mode = true)                     AS demo_matches
FROM matches;
