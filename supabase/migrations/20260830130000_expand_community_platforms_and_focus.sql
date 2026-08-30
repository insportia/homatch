-- Widen community_directory to support more platforms (WhatsApp added; VK,
-- Reddit, LinkedIn, Threads were already allowed) and add a housing_focus
-- column so ranking/UI can tell a dedicated real-estate community apart from
-- a general expat/classifieds community where housing posts appear
-- occasionally alongside other topics. Per user feedback: indirect/expat
-- groups should still be surfaced, just distinguishable from dedicated ones.
ALTER TABLE public.community_directory DROP CONSTRAINT IF EXISTS community_directory_platform_check;
ALTER TABLE public.community_directory ADD CONSTRAINT community_directory_platform_check
  CHECK (platform IN ('TELEGRAM','FACEBOOK','VK','REDDIT','LINKEDIN','THREADS','WHATSAPP','OTHER'));

ALTER TABLE public.community_directory
  ADD COLUMN IF NOT EXISTS housing_focus text NOT NULL DEFAULT 'primary'
    CHECK (housing_focus IN ('primary', 'secondary'));

COMMENT ON COLUMN public.community_directory.housing_focus IS
  'primary = dedicated real-estate community; secondary = general/expat/classifieds community where housing posts appear alongside other topics, not a dedicated listings group.';

-- Backfill the one previously-seeded general expat group as secondary.
UPDATE public.community_directory
SET housing_focus = 'secondary'
WHERE metadata->>'note' ILIKE '%Not a dedicated real-estate group%';

CREATE INDEX IF NOT EXISTS idx_community_directory_housing_focus ON public.community_directory(housing_focus);
