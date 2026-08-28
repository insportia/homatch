-- ── import-property pipeline diagnostic columns ─────────────────────────────
-- Adds rich per-import diagnostic data needed by /admin/diagnostics

-- Fallback chain attempted (JSON array of objects)
-- e.g. [{"strategy":"direct","status":403,"reason":"cloudflare"},{"strategy":"zenrows","status":200}]
ALTER TABLE property_imports
  ADD COLUMN IF NOT EXISTS fallback_chain      jsonb,
  ADD COLUMN IF NOT EXISTS extraction_provider text,   -- final provider that returned usable HTML
  ADD COLUMN IF NOT EXISTS fields_found        int4,   -- number of non-null extracted fields
  ADD COLUMN IF NOT EXISTS photos_found        int4,   -- number of real listing photos
  ADD COLUMN IF NOT EXISTS missing_critical    text[], -- array of missing critical field names
  ADD COLUMN IF NOT EXISTS provider_cost_usd   numeric(10,6), -- estimated per-call cost
  ADD COLUMN IF NOT EXISTS fetch_strategy      text,   -- DIRECT | API | ZENROWS | SCRAPINGBEE
  ADD COLUMN IF NOT EXISTS http_status         int4,   -- HTTP status from winning strategy
  ADD COLUMN IF NOT EXISTS response_size       int4,   -- bytes returned by winning strategy
  ADD COLUMN IF NOT EXISTS cloudflare_blocked  boolean NOT NULL DEFAULT false;

-- Index for diagnostics queries
CREATE INDEX IF NOT EXISTS idx_property_imports_provider ON property_imports(extraction_provider);
CREATE INDEX IF NOT EXISTS idx_property_imports_strategy ON property_imports(fetch_strategy);
