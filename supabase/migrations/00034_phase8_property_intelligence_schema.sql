
-- ═══════════════════════════════════════════════════════════════
-- PHASE 8: Property Intelligence Schema
-- research_jobs · research_sources · research_entities
-- evidence_claims · research_conflicts
-- ═══════════════════════════════════════════════════════════════

-- ── research_jobs ─────────────────────────────────────────────
CREATE TABLE research_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  input_raw      text NOT NULL,
  input_type     text NOT NULL CHECK (input_type IN ('PROPERTY','CADASTRAL')),
  status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','IDENTIFYING','PLANNING','DISCOVERING','EXPANDING',
                                     'READING','NORMALIZING','CROSS_CHECKING','SYNTHESIZING',
                                     'COMPLETED','FAILED','PARTIAL')),
  phase_detail   text,
  -- parsed entities from input
  cadastral_code text,
  address_raw    text,
  project_name   text,
  developer_name text,
  url_input      text,
  -- progress counters
  sources_found    int NOT NULL DEFAULT 0,
  sources_read     int NOT NULL DEFAULT 0,
  entities_found   int NOT NULL DEFAULT 0,
  claims_extracted int NOT NULL DEFAULT 0,
  -- cost tracking
  gemini_calls   int NOT NULL DEFAULT 0,
  cost_usd       numeric(10,6) NOT NULL DEFAULT 0,
  -- timing
  started_at     timestamptz,
  completed_at   timestamptz,
  duration_ms    int,
  -- final report (structured JSON)
  report         jsonb,
  error_message  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── research_sources ─────────────────────────────────────────
CREATE TABLE research_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  url           text,
  title         text,
  domain        text,
  query_used    text,
  source_type   text NOT NULL DEFAULT 'OTHER'
                  CHECK (source_type IN (
                    'OFFICIAL_GOVERNMENT','OFFICIAL_REGISTRY','OFFICIAL_COMPANY',
                    'DEVELOPER','PROPERTY_PORTAL','AGENCY','NEWS_MEDIA',
                    'MAP','SOCIAL_PUBLIC','REVIEW','FORUM','OTHER'
                  )),
  access_method text NOT NULL DEFAULT 'SEARCH_SNIPPET_ONLY'
                  CHECK (access_method IN (
                    'SEARCH_SNIPPET_ONLY','URL_CONTEXT_RETRIEVED',
                    'DIRECT_PAGE_RETRIEVED','OFFICIAL_FORM_RESULT','DOCUMENT_RETRIEVED'
                  )),
  snippet       text,
  full_content  text,
  grounding_chunk jsonb,           -- raw Gemini grounding metadata
  retrieved_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ── research_entities ────────────────────────────────────────
CREATE TABLE research_entities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  entity_type     text NOT NULL
                    CHECK (entity_type IN (
                      'PROPERTY','CADASTRAL_PARCEL','ADDRESS','BUILDING',
                      'PROJECT','DEVELOPER','LEGAL_COMPANY','PERSON','DOCUMENT','LISTING'
                    )),
  name_raw        text NOT NULL,
  name_normalized text,
  identifiers     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {cadastral, company_id, address, url, ...}
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {area, floor, rooms, price, ...}
  discovery_depth int  NOT NULL DEFAULT 0,             -- 0=input, 1=first expansion, etc.
  source_ids      uuid[] NOT NULL DEFAULT '{}',
  confidence      numeric(4,3) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── evidence_claims ──────────────────────────────────────────
CREATE TABLE evidence_claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  entity_id       uuid REFERENCES research_entities(id) ON DELETE SET NULL,
  source_id       uuid REFERENCES research_sources(id) ON DELETE SET NULL,
  claim_type      text NOT NULL,   -- CADASTRAL_NUMBER, AREA, OWNER, PRICE, PERMIT, COMPANY_ID, …
  claim_value     text,
  claim_raw       text,            -- exact excerpt
  status          text NOT NULL DEFAULT 'UNVERIFIED'
                    CHECK (status IN (
                      'CONFIRMED','PARTIAL','UNVERIFIED','NOT_FOUND',
                      'CONFLICTED','INSUFFICIENT_EVIDENCE'
                    )),
  confidence      numeric(4,3) NOT NULL DEFAULT 0,
  source_authority int NOT NULL DEFAULT 0, -- 0-100 authority weight of source
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── research_conflicts ───────────────────────────────────────
CREATE TABLE research_conflicts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  claim_type      text NOT NULL,
  claim_a_id      uuid REFERENCES evidence_claims(id) ON DELETE SET NULL,
  claim_b_id      uuid REFERENCES evidence_claims(id) ON DELETE SET NULL,
  value_a         text,
  value_b         text,
  conflict_type   text NOT NULL DEFAULT 'MATERIAL_CONFLICT'
                    CHECK (conflict_type IN (
                      'MATCH','MINOR_VARIATION','MATERIAL_CONFLICT','INSUFFICIENT_EVIDENCE'
                    )),
  resolution      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX research_jobs_user_id_idx      ON research_jobs(user_id);
CREATE INDEX research_jobs_status_idx       ON research_jobs(status);
CREATE INDEX research_jobs_created_at_idx   ON research_jobs(created_at DESC);
CREATE INDEX research_sources_job_id_idx    ON research_sources(job_id);
CREATE INDEX research_entities_job_id_idx   ON research_entities(job_id);
CREATE INDEX evidence_claims_job_id_idx     ON evidence_claims(job_id);
CREATE INDEX research_conflicts_job_id_idx  ON research_conflicts(job_id);

-- ── updated_at trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER research_jobs_updated_at
  BEFORE UPDATE ON research_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE research_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_sources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_entities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_claims     ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_conflicts  ENABLE ROW LEVEL SECURITY;

-- Helper: get homatch user id from auth.uid()
CREATE OR REPLACE FUNCTION get_homatch_user_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- research_jobs: owner can CRUD; anon blocked
CREATE POLICY "rj_select_owner" ON research_jobs FOR SELECT
  USING (user_id = get_homatch_user_id());
CREATE POLICY "rj_insert_owner" ON research_jobs FOR INSERT
  WITH CHECK (user_id = get_homatch_user_id());
CREATE POLICY "rj_update_owner" ON research_jobs FOR UPDATE
  USING (user_id = get_homatch_user_id());
CREATE POLICY "rj_delete_owner" ON research_jobs FOR DELETE
  USING (user_id = get_homatch_user_id());

-- related tables: owner via job
CREATE POLICY "rs_select_owner" ON research_sources FOR SELECT
  USING (EXISTS (SELECT 1 FROM research_jobs rj WHERE rj.id = job_id AND rj.user_id = get_homatch_user_id()));
CREATE POLICY "rs_insert_svc"   ON research_sources FOR INSERT WITH CHECK (true); -- service role only via EF
CREATE POLICY "re_select_owner" ON research_entities FOR SELECT
  USING (EXISTS (SELECT 1 FROM research_jobs rj WHERE rj.id = job_id AND rj.user_id = get_homatch_user_id()));
CREATE POLICY "re_insert_svc"   ON research_entities FOR INSERT WITH CHECK (true);
CREATE POLICY "ec_select_owner" ON evidence_claims FOR SELECT
  USING (EXISTS (SELECT 1 FROM research_jobs rj WHERE rj.id = job_id AND rj.user_id = get_homatch_user_id()));
CREATE POLICY "ec_insert_svc"   ON evidence_claims FOR INSERT WITH CHECK (true);
CREATE POLICY "rc_select_owner" ON research_conflicts FOR SELECT
  USING (EXISTS (SELECT 1 FROM research_jobs rj WHERE rj.id = job_id AND rj.user_id = get_homatch_user_id()));
CREATE POLICY "rc_insert_svc"   ON research_conflicts FOR INSERT WITH CHECK (true);

-- ── Realtime publication ─────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE research_jobs;
