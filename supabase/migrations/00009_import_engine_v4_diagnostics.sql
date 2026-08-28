-- v4 import engine: additional diagnostic + normalized schema columns

-- property_imports: extended diagnostics
ALTER TABLE property_imports
  ADD COLUMN IF NOT EXISTS source_domain        text,
  ADD COLUMN IF NOT EXISTS source_language      text,
  ADD COLUMN IF NOT EXISTS source_listing_id    text,
  ADD COLUMN IF NOT EXISTS photos_rejected      int4 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS photos_candidates    int4 DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_sources   text[],
  ADD COLUMN IF NOT EXISTS missing_fields       text[],
  ADD COLUMN IF NOT EXISTS extraction_confidence numeric(4,3) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fallback_reason      text,
  ADD COLUMN IF NOT EXISTS duration_ms          int4,
  ADD COLUMN IF NOT EXISTS ai_used              boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_tokens_used       int4;

-- property_facts: rooms (already has bedrooms; rooms = total room count)
ALTER TABLE property_facts
  ADD COLUMN IF NOT EXISTS rooms              int,
  ADD COLUMN IF NOT EXISTS source_domain      text,
  ADD COLUMN IF NOT EXISTS source_language    text,
  ADD COLUMN IF NOT EXISTS source_listing_id  text,
  ADD COLUMN IF NOT EXISTS original_title     text,
  ADD COLUMN IF NOT EXISTS extraction_confidence numeric(4,3) DEFAULT 0;

-- index for diagnostics queries
CREATE INDEX IF NOT EXISTS idx_property_imports_domain    ON property_imports(source_domain);
CREATE INDEX IF NOT EXISTS idx_property_imports_language  ON property_imports(source_language);
CREATE INDEX IF NOT EXISTS idx_property_imports_confidence ON property_imports(extraction_confidence);