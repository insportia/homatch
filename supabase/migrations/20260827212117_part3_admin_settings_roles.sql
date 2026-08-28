-- ── PART 3: Admin settings, roles, spend cap tracking ──────────────

-- 1. Add is_admin to users (public schema)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Admin settings key-value store
CREATE TABLE IF NOT EXISTS admin_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Provider health table
CREATE TABLE IF NOT EXISTS provider_health (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_tested_at  TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  latency_ms      INTEGER,
  last_error      TEXT,
  success_count   INTEGER NOT NULL DEFAULT 0,
  failure_count   INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Seed spend caps
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_global',       '"250"',  'Global monthly COGS cap in USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_dataforseo',   '"40"',   'DataForSEO monthly cap in USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_apify',        '"100"',  'Apify monthly cap in USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_zenrows',      '"20"',   'ZenRows monthly cap in USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_scrapingbee',  '"5"',    'ScrapingBee monthly cap in USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_brightdata',   '"10"',   'BrightData monthly cap in USD') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('spend_cap_openai',       '"15"',   'OpenAI monthly cap in USD') ON CONFLICT (key) DO NOTHING;

-- 5. Seed pricing config
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_min_credits',             '0.10', 'Minimum unlock price in credits') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_max_credits',             '10.0', 'Maximum unlock price in credits') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_base_potential',          '0.50', 'Base price POTENTIAL tier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_base_good',               '1.00', 'Base price GOOD tier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_base_strong',             '2.00', 'Base price STRONG tier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_base_very_strong',        '3.50', 'Base price VERY_STRONG tier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_base_exceptional',        '5.00', 'Base price EXCEPTIONAL tier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_multiplier_recency',      '1.3',  'Recency boost multiplier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_multiplier_source_quality','1.2', 'Source quality multiplier') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('pricing_multiplier_cogs',         '1.15', 'COGS pass-through multiplier') ON CONFLICT (key) DO NOTHING;

-- 6. Seed retention rules
INSERT INTO admin_settings (key, value, description) VALUES ('retention_noise_days',        '"7"',   'Days to keep NOISE raw signals') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('retention_rejected_days',     '"14"',  'Days to keep REJECTED signals') ON CONFLICT (key) DO NOTHING;
INSERT INTO admin_settings (key, value, description) VALUES ('retention_cost_events_days',  '"180"', 'Days to keep cost_events') ON CONFLICT (key) DO NOTHING;

-- 7. Seed provider health rows
INSERT INTO provider_health (provider, status) VALUES ('DATAFORSEO',  'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('APIFY',       'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('ZENROWS',     'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('SCRAPINGBEE', 'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('BRIGHTDATA',  'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('OPENAI',      'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('STRIPE',      'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;
INSERT INTO provider_health (provider, status) VALUES ('RESEND',      'NOT_CONFIGURED') ON CONFLICT (provider) DO NOTHING;

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_admin_settings_key ON admin_settings(key);
CREATE INDEX IF NOT EXISTS idx_provider_health_provider ON provider_health(provider);
CREATE INDEX IF NOT EXISTS idx_cost_events_provider ON cost_events(provider);
CREATE INDEX IF NOT EXISTS idx_cost_events_timestamp ON cost_events("timestamp");
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin) WHERE is_admin = true;

-- 9. RLS: admin_settings — admins only
ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_settings_admin_only" ON admin_settings;
CREATE POLICY "admin_settings_admin_only" ON admin_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true)
  );

-- 10. RLS: provider_health — admins only
ALTER TABLE provider_health ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_health_admin_only" ON provider_health;
CREATE POLICY "provider_health_admin_only" ON provider_health
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true)
  );

-- 11. cost_events admin read policy
DROP POLICY IF EXISTS "cost_events_admin_read" ON cost_events;
CREATE POLICY "cost_events_admin_read" ON cost_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true)
  );
