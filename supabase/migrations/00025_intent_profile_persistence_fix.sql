-- Keep classifier persistence aligned with the production Edge Function.
ALTER TABLE public.intent_profiles
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE INDEX IF NOT EXISTS idx_intent_profiles_job_dedup
  ON public.intent_profiles (job_id, dedup_hash)
  WHERE job_id IS NOT NULL AND dedup_hash IS NOT NULL;

NOTIFY pgrst, 'reload schema';