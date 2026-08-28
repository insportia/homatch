
-- ============================================================
-- HOMATCH Part 3 — Security hardening (v3)
-- Adds user_id to matches + property_imports, idempotency_key
-- to payments, then applies all RLS policies safely
-- ============================================================

-- 1. Add user_id to property_imports (per-user rate limiting)
ALTER TABLE property_imports ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_property_imports_user_id    ON property_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_property_imports_user_ts    ON property_imports(user_id, created_at);

-- 2. Add user_id to matches (denormalised for fast RLS + admin queries)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_matches_user_id ON matches(user_id);

-- 3. Idempotency key on payments (exact-once credit grants)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
  ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 4. cost_events RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cost_events' AND policyname='Service inserts cost events') THEN
    CREATE POLICY "Service inserts cost events" ON cost_events
      FOR INSERT WITH CHECK (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cost_events' AND policyname='Admins can view cost events') THEN
    CREATE POLICY "Admins can view cost events" ON cost_events
      FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
END $$;

-- 5. admin_settings RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_settings' AND policyname='Admins read settings') THEN
    CREATE POLICY "Admins read settings" ON admin_settings
      FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_settings' AND policyname='Admins write settings') THEN
    CREATE POLICY "Admins write settings" ON admin_settings
      FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='admin_settings' AND policyname='Service manages settings') THEN
    CREATE POLICY "Service manages settings" ON admin_settings
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 6. provider_health RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='provider_health' AND policyname='Admins view provider health') THEN
    CREATE POLICY "Admins view provider health" ON provider_health
      FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='provider_health' AND policyname='Service manages provider health') THEN
    CREATE POLICY "Service manages provider health" ON provider_health
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 7. match_unlocks RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_unlocks' AND policyname='Users view own unlocks') THEN
    CREATE POLICY "Users view own unlocks" ON match_unlocks
      FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='match_unlocks' AND policyname='Service manages unlocks') THEN
    CREATE POLICY "Service manages unlocks" ON match_unlocks
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 8. credit_accounts RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_accounts' AND policyname='Users view own credit account') THEN
    CREATE POLICY "Users view own credit account" ON credit_accounts
      FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_accounts' AND policyname='Service manages credit accounts') THEN
    CREATE POLICY "Service manages credit accounts" ON credit_accounts
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 9. credit_ledger RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_ledger' AND policyname='Users view own ledger') THEN
    CREATE POLICY "Users view own ledger" ON credit_ledger
      FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='credit_ledger' AND policyname='Service inserts ledger entries') THEN
    CREATE POLICY "Service inserts ledger entries" ON credit_ledger
      FOR INSERT WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 10. payments RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='Users view own payments') THEN
    CREATE POLICY "Users view own payments" ON payments
      FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payments' AND policyname='Service manages payments') THEN
    CREATE POLICY "Service manages payments" ON payments
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 11. matches RLS (uses new user_id column)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='Users view own matches') THEN
    CREATE POLICY "Users view own matches" ON matches
      FOR SELECT USING (user_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='matches' AND policyname='Service manages matches') THEN
    CREATE POLICY "Service manages matches" ON matches
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 12. raw_signals & intent_profiles RLS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='raw_signals' AND policyname='Service manages signals') THEN
    CREATE POLICY "Service manages signals" ON raw_signals
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='raw_signals' AND policyname='Admins read signals') THEN
    CREATE POLICY "Admins read signals" ON raw_signals
      FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intent_profiles' AND policyname='Service manages intent profiles') THEN
    CREATE POLICY "Service manages intent profiles" ON intent_profiles
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='intent_profiles' AND policyname='Admins read intent profiles') THEN
    CREATE POLICY "Admins read intent profiles" ON intent_profiles
      FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND is_admin = true));
  END IF;
END $$;
